import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { ConnectorContractPayload } from "../rws-orchestrator/types";
import { ConnectorTaskNotifier } from "../connector-tasks/connector-task-notifier.service";
import { NodePlan } from "./types";

/** 一院一轮的训练任务（经连接器长轮询下发，design D3）。 */
export interface ConnectorFlRoundTask {
  roundTaskId: string;
  /** 编排任务 id（同一次联邦训练的所有轮次共用）。 */
  taskId: string;
  round: number;
  participantId: string;
  /** 本轮任务的用途声明（连接器 PEP 用它比对合约目的，不能用合约自己的目的自证）。 */
  purpose: string;
  specYaml: string;
  globalAdapterJson: string;
  nodePlan: NodePlan[];
  /** 该院合约快照：连接器据此做 PEP 校验后再调用本院 agent。 */
  contract: ConnectorContractPayload;
}

export interface FlRoundResult {
  adapterDeltaJson: string;
  sampleCount: number;
  localLoss: number;
  message?: string;
}

interface PendingRound {
  task: ConnectorFlRoundTask;
  status: "pending" | "running";
  issuedAt?: string;
  resolve: (result: FlRoundResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const DEFAULT_ROUND_TIMEOUT_MS = 120_000;

/**
 * 联邦训练轮次队列（design D1/D3）。
 *
 * 取代「控制面主动 gRPC 调用各院 agent」：编排器把每院每轮的任务放进队列并唤醒
 * 该院在途的长轮询；连接器领到后在院内调用本院 agent，再把结果回传。
 *
 * 队列在进程内存里（与 OrchestratorFsmService 同生命周期），单实例部署。
 */
@Injectable()
export class FlRoundQueueService {
  private readonly logger = new Logger(FlRoundQueueService.name);
  private readonly rounds = new Map<string, PendingRound>();

  constructor(private readonly notifier: ConnectorTaskNotifier) {}

  roundTimeoutMs(): number {
    const raw = Number(
      process.env.SF_ROUND_TIMEOUT_MS ?? DEFAULT_ROUND_TIMEOUT_MS,
    );
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ROUND_TIMEOUT_MS;
  }

  /** 入队一院一轮，返回 Promise：连接器回传结果即 resolve，超时 reject。 */
  enqueue(input: {
    taskId: string;
    participantId: string;
    round: number;
    purpose: string;
    specYaml: string;
    globalAdapterJson: string;
    nodePlan: NodePlan[];
    contract: ConnectorContractPayload;
    timeoutMs?: number;
  }): Promise<FlRoundResult> {
    const roundTaskId = randomUUID();
    const timeoutMs = input.timeoutMs ?? this.roundTimeoutMs();
    return new Promise<FlRoundResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rounds.delete(roundTaskId);
        reject(
          new Error(
            `训练轮次超时:${input.participantId} 第 ${input.round + 1} 轮(${timeoutMs}ms 未回传)`,
          ),
        );
      }, timeoutMs);
      timer.unref?.();
      this.rounds.set(roundTaskId, {
        task: {
          roundTaskId,
          taskId: input.taskId,
          round: input.round,
          participantId: input.participantId,
          purpose: input.purpose,
          specYaml: input.specYaml,
          globalAdapterJson: input.globalAdapterJson,
          nodePlan: input.nodePlan,
          contract: input.contract,
        },
        status: "pending",
        resolve,
        reject,
        timer,
      });
      // 唤醒该院在途的长轮询（先登记等待者再查待办，见 ConnectorTaskNotifier）。
      this.notifier.notify(input.participantId);
      this.logger.log(
        `轮次入队 roundTaskId=${roundTaskId.slice(0, 8)} task=${input.taskId.slice(0, 8)} round=${input.round + 1} provider=${input.participantId}`,
      );
    });
  }

  /** 连接器领取该院的待办轮次（领取即置 running，超时仍由轮次时限兜底）。 */
  pullPendingRounds(participantId: string): ConnectorFlRoundTask[] {
    const out: ConnectorFlRoundTask[] = [];
    for (const entry of this.rounds.values()) {
      if (entry.status !== "pending") continue;
      if (entry.task.participantId !== participantId) continue;
      entry.status = "running";
      entry.issuedAt = new Date().toISOString();
      out.push(entry.task);
    }
    return out;
  }

  complete(
    roundTaskId: string,
    participantId: string,
    result: FlRoundResult,
  ): void {
    const entry = this.require(roundTaskId, participantId);
    this.rounds.delete(roundTaskId);
    clearTimeout(entry.timer);
    entry.resolve(result);
  }

  /** 连接器侧失败（验签失败、agent 调用失败…）：让编排器立刻知道，不必空等超时。 */
  fail(roundTaskId: string, participantId: string, message: string): void {
    const entry = this.require(roundTaskId, participantId);
    this.rounds.delete(roundTaskId);
    clearTimeout(entry.timer);
    entry.reject(new Error(message));
  }

  pendingCount(participantId?: string): number {
    let n = 0;
    for (const entry of this.rounds.values()) {
      if (!participantId || entry.task.participantId === participantId) n += 1;
    }
    return n;
  }

  private require(roundTaskId: string, participantId: string): PendingRound {
    const entry = this.rounds.get(roundTaskId);
    if (!entry) {
      throw new NotFoundException("训练轮次任务不存在或已完成");
    }
    if (entry.task.participantId !== participantId) {
      throw new ForbiddenException("训练轮次任务不属于该参与方");
    }
    return entry;
  }
}
