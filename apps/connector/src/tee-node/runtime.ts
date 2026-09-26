import { Logger } from '@nestjs/common';
import type { NodeArtifactStore } from '../mdop/node/node-artifacts';
import type { NodeReceiptChain } from '../mdop/node/node-receipts';
import type { TrustedNodeSession } from '../mdop/node/node-session';
import { NodeMessageRouter, type NodeStageDeploymentContext } from './node-messages';
import type { NodeOperatorStore } from './operator-store';
import type { PollOutcome } from './poller';

/**
 * 可信空间节点的**运行进程**（任务 3.18）：把已经落地的各部件装成一条能跑的长驻循环。
 *
 * 之前每一步都有判据与用例，但**没有进程把它们串起来**：心跳没人发、探针没人跑、长轮询没人驱动、
 * 清单与吊销没人应用、消息没人派给路由器。结果就是「每块都对，整条不通」——真实部署里节点
 * 收不到要约、拿不到凭证、也不会应答销毁指令。
 *
 * 一个 tick 做四件事（顺序有讲究）：
 *  ① **到点才做**：心跳（缺省 60s）与证明探针（缺省 5min，**必须短于校验方给的背书有效期**）；
 *  ② **拉一次批次**（长轮询，本身会阻塞到有消息或超时）；
 *  ③ **先应用清单与吊销**再处置消息——否则同一批里刚到的新清单会赶不上这一批的要约复核
 *     （复核判「算子在不在清单、有没有被吊销」，用的是本地状态）；
 *  ④ **逐条交给 `NodeMessageRouter`**：一条失败不影响其余（错误逐条记下并留痕，由平台按至少一次
 *     投递重发）。
 *
 * 失败策略：`runOnce()` 把**轮询失败**抛给调用方（单次可见，便于测试与运维），而 `start()` 的循环
 * 把它降级为告警继续下一轮——网络抖动不该让节点进程退出。心跳与探针的失败只告警：
 * 它们坏了会让**新作业**在编译期被拒（登记过期），但不该影响在途作业。
 */

export interface NodeRuntimeOptions {
  /** 心跳间隔（毫秒，缺省 60s）。 */
  heartbeatIntervalMs?: number;
  /** 证明探针间隔（毫秒，缺省 5min；**必须短于**校验方给的背书有效期）。 */
  probeIntervalMs?: number;
  /** 轮询等待上限（毫秒，缺省 25s；平台硬上限 25s）。 */
  pollWaitMs?: number;
  /** 循环连续失败时的退避下限（毫秒，缺省 5s）。 */
  failureBackoffMs?: number;
}

export interface TrustedNodeRuntimeDeps {
  node: string;
  router: NodeMessageRouter;
  operators: NodeOperatorStore;
  session: TrustedNodeSession;
  artifacts: NodeArtifactStore;
  receipts: NodeReceiptChain;
  /** 本地状态（回执链/制品/去重表）：构造时 `hydrate()`、每个 tick 末 `persist()`。 */
  state: { hydrate?(): unknown; persist(): unknown };
  /** 拉一次批次（生产实现是 `pollNodeMessages`）。 */
  poll(input: { waitMs: number; now?: Date }): Promise<PollOutcome>;
  /** 上报能力通告（可选；不给则跳过心跳）。 */
  heartbeat?(): Promise<void>;
  /** 跑一次证明探针（可选；不给则跳过探针）。 */
  probe?(): Promise<unknown>;
  now?: () => Date;
  logger?: Logger;
}

export interface NodeRuntimeTick {
  at: string;
  heartbeat: boolean;
  probe: boolean;
  /** 本批拉到的消息条数（含被 `msg_id` 去重跳过的）。 */
  polled: number;
  duplicates: number;
  /** 采纳的算子清单条数 / 吊销名单是否采纳。 */
  manifests: number;
  revocations: boolean;
  handled: Array<{ msgType: string; status: string; detail?: string }>;
  failed: Array<{ msgId: string; reason: string }>;
  warnings: string[];
}

export class TrustedNodeRuntime {
  private readonly logger: Logger;
  private running = false;
  private lastHeartbeat = 0;
  private lastProbe = 0;
  private loopPromise?: Promise<void>;

  constructor(
    private readonly deps: TrustedNodeRuntimeDeps,
    private readonly options: NodeRuntimeOptions = {},
  ) {
    this.logger = deps.logger ?? new Logger(TrustedNodeRuntime.name);
    this.deps.state.hydrate?.();
  }

  /** 跑一个 tick（不阻塞在睡眠上，便于测试与「运维手工触发一次」）。 */
  async runOnce(input: { now?: Date; waitMs?: number } = {}): Promise<NodeRuntimeTick> {
    const now = input.now ?? this.deps.now?.() ?? new Date();
    const tick: NodeRuntimeTick = {
      at: now.toISOString(),
      heartbeat: false,
      probe: false,
      polled: 0,
      duplicates: 0,
      manifests: 0,
      revocations: false,
      handled: [],
      failed: [],
      warnings: [],
    };

    // ① 到点才做的心跳与探针：失败只告警（它们坏了影响的是**新作业**，不该拖住在途作业）
    if (this.deps.heartbeat && this.due(this.lastHeartbeat, now, this.options.heartbeatIntervalMs ?? 60_000)) {
      try {
        await this.deps.heartbeat();
        this.lastHeartbeat = now.getTime();
        tick.heartbeat = true;
      } catch (err) {
        tick.warnings.push(`心跳失败：${(err as Error).message}`);
      }
    }
    if (this.deps.probe && this.due(this.lastProbe, now, this.options.probeIntervalMs ?? 300_000)) {
      try {
        await this.deps.probe();
        this.lastProbe = now.getTime();
        tick.probe = true;
      } catch (err) {
        tick.warnings.push(`证明探针失败：${(err as Error).message}`);
      }
    }

    // ② 拉批次（长轮询；失败抛给调用方）
    const outcome = await this.deps.poll({
      waitMs: input.waitMs ?? this.options.pollWaitMs ?? 25_000,
      ...(input.now ? { now: input.now } : {}),
    });
    tick.duplicates = outcome.duplicates;

    // ③ **先应用清单与吊销**：同一批里的要约复核要用到它们
    tick.manifests = this.deps.operators.applyManifests(outcome.mdopOperators);
    tick.revocations = this.deps.operators.applyRevocations(outcome.mdopRevocations);
    for (const rejected of outcome.rejected)
      tick.warnings.push(`消息验签未过（${rejected.msgId}）：${rejected.reason}`);

    // ④ 逐条处置：一条失败不影响其余
    tick.polled = outcome.messages.length;
    for (const message of outcome.messages) {
      try {
        const result = await this.deps.router.handle(message.envelope);
        tick.handled.push({
          msgType: result.msgType,
          status: result.status,
          ...(result.detail ? { detail: result.detail } : {}),
        });
      } catch (err) {
        const reason = (err as Error).message;
        tick.failed.push({ msgId: message.envelope.msg_id, reason });
        this.logger.warn(`消息处置失败 msg=${message.envelope.msg_id}：${reason}`);
      }
    }

    // 落盘：回执链/制品/去重表不随重启丢
    this.deps.state.persist();
    return tick;
  }

  /** 启动长驻循环（幂等）。 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop();
    this.logger.log(`可信空间节点运行中 node=${this.deps.node}`);
  }

  /** 停止循环（等在途的一轮结束，避免半途停在下发/投递之间）。 */
  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise?.catch(() => undefined);
    this.loopPromise = undefined;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** 等循环结束（`serve` 用它挂着等信号，而不是自旋）。 */
  async waitUntilStopped(): Promise<void> {
    await this.loopPromise?.catch(() => undefined);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.runOnce();
      } catch (err) {
        // 轮询失败：告警 + 退避，绝不因为一次网络抖动退出（退出等于节点静默离线）
        const backoff = this.options.failureBackoffMs ?? 5_000;
        this.logger.warn(`节点轮询失败，${backoff}ms 后重试：${(err as Error).message}`);
        await sleep(backoff);
      }
    }
  }

  private due(last: number, now: Date, intervalMs: number): boolean {
    if (intervalMs <= 0) return true;
    return last === 0 || now.getTime() - last >= intervalMs;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref?.());
}
