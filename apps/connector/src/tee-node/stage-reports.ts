import {
  MDOP_ERROR_CODES,
  canonicalSm3,
  type FlowLabel,
  type MdopErrorCode,
  type SessionWitness,
} from '@medtrust/mdop';
import { MdopOutboundHttpError, type MdopOutboundClient } from '../mdop/mdop-client';
import type { NodeArtifactStore } from '../mdop/node/node-artifacts';
import { deliverC3Payload, registerArtifactHandle } from './c3-delivery';
import type { NodeReceiptReporter } from './receipt-report';
import { reportNodeStageStatus } from './stage-status';
import { reportWitness } from './witness-report';

/**
 * 阶段**执行之后**的上报（句柄登记 / C3 投递 / 会话见证 / 回执链 / 阶段状态），与执行本身分开。
 *
 * 为什么必须分开：执行有不可重来的副作用——解封要向密钥保管方要钥匙、出口要扣查询预算、
 * C3 要过发布审查与出口守卫；而上报只是把「已经发生的事」告诉平台，天然可以重来。
 * 此前两者写在同一个函数里，任何一条上报抛错都被当成「阶段没跑成」：下一次重发的指令整段重跑
 * （2026-10-07 真机 job-muy1ioki-b12ae3e7：一次 `fetch failed` 之后，保管方为同一个作业把同样两把
 * 密钥放了三次）。
 *
 * 现在的次序：**执行 → 登记并落盘（带着这份「还欠着的上报」）→ 逐项上报**。
 * 每送达一项就从清单里划掉并落盘；哪一步没送达就停在哪一步，重发的指令（含进程重启之后的）
 * 从那一步接着补。清单里**没有任何制品内容**：
 *  - 句柄登记只需要句柄、等级、摘要这些元数据；
 *  - C3 载荷**不进清单**，补投时从节点制品库按句柄取（销毁即取不到，见 {@link publishedC3Source}）；
 *  - 会话见证带的是本体（证明报告 + 释放凭据）——它本来就是要交给平台并转给持有方的凭据，
 *    保管方不会为同一次释放再出一份，丢了就再也补不上，所以必须随登记留到送达为止。
 */

/** 一件已入本节点制品库的产物的对外引用（只有元数据）。 */
export interface StageArtifactRef {
  stage: { id: string; op: string; op_digest: string; output_schema: string };
  handle: string;
  label: FlowLabel;
  /** 载荷摘要（`sm3:<64hex>`）；C3 时就是出口守卫放行的那一份的摘要。 */
  digest: string;
  /** 句柄过期时刻（执行时按当时的时钟算好；补报沿用，不重算）。 */
  expiresAt: string;
}

/** 还欠着平台的上报（有这一项 = 还没送达）。上报顺序固定：句柄 → C3 → 见证 → 回执链 → 状态。 */
export interface PendingStageReports {
  /** 句柄登记（控制面 `ArtifactReady`，不含载荷）。 */
  handle?: StageArtifactRef;
  /** C3 载荷投递（数据面 `ResultDeliver`）。**只记引用**，载荷在制品库里。 */
  delivery?: StageArtifactRef;
  /** 尚未送达的会话见证（每个 `key_id` 一条；送达一条删一条）。 */
  witnesses?: SessionWitness[];
  /** 回执链上报（`AuditReceipt`；逐条去重在上报器里）。 */
  receipts?: boolean;
}

export type StageReportStep = 'handle' | 'delivery' | 'witnesses' | 'receipts' | 'status';

const STEP_NAME: Record<StageReportStep, string> = {
  handle: '句柄登记',
  delivery: 'C3 投递',
  witnesses: '会话见证',
  receipts: '回执链上报',
  status: '阶段状态',
};

/** 还欠着哪几项（按上报顺序）；阶段状态由调用方另记。 */
export function outstandingReports(pending: PendingStageReports | undefined): StageReportStep[] {
  if (!pending) return [];
  const steps: StageReportStep[] = [];
  if (pending.handle) steps.push('handle');
  if (pending.delivery) steps.push('delivery');
  if (pending.witnesses && pending.witnesses.length > 0) steps.push('witnesses');
  if (pending.receipts) steps.push('receipts');
  return steps;
}

/**
 * 本节点**自己判定**这一项不能做（不是没送到）：制品已销毁、或制品库里的那一份核不过出口记录。
 * 重试不会变好，按阶段失败如实上报。
 */
export class StageReportRefused extends Error {
  constructor(
    readonly code: MdopErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StageReportRefused';
  }
}

/** 某一步上报没完成（`reason` 是原始错误：链路不通 / 超时 / 平台拒收 / 本地拒绝）。 */
export class StageReportError extends Error {
  constructor(
    readonly step: StageReportStep,
    readonly reason: unknown,
  ) {
    super(`${STEP_NAME[step]}未完成：${(reason as Error)?.message ?? String(reason)}`);
    this.name = 'StageReportError';
  }
}

export interface StageReportDeps {
  /** 以**节点身份**签名的出站客户端。 */
  outbound: MdopOutboundClient;
  /** 上报的收件方（本设计中是平台）。 */
  platform: string;
  receipts?: NodeReceiptReporter;
  /**
   * 取回一份**已出口**的 C3 载荷（投递用）。取不到、核不过即抛 {@link StageReportRefused}。
   * 派发路径用 {@link publishedC3Source}（从节点制品库取并核对出口记录）。
   */
  c3Payload(ref: { jobId: string; stageId: string; handle: string; digest: string }): Record<
    string,
    unknown
  >;
}

export interface StageReportCounts {
  handleRegistered: boolean;
  delivered: boolean;
  /** 本次送达的会话见证条数。 */
  witnesses: number;
  /** 本次送达的回执条数。 */
  receipts: number;
}

/**
 * C3 载荷的**唯一来源**：节点制品库里、由出口那一步（`TrustedNodeSession.publish`）存下的那一份。
 *
 * 首次投递与补投走同一条路，判据也是同一份——因此「补投」不比「首投」多放行任何东西：
 *  ① 制品还在（`PurgeOrder` 销毁、或已到期的，取不到 → **不可再投**）；
 *  ② 它是 C3，且**重算的载荷摘要**等于出口时登记的摘要（制品库里的东西被换过即拒）；
 *  ③ 本地回执链上有这份产物的 `EXITED` 记录——出口守卫放行过它的签名凭据。出口发生在发布审查之后
 *     （没有审查记录到不了出口），所以这一条同时保证「未经节点内发布审查的产物不得出域」。
 * 补投**不重做**发布审查、也不需要内存里的审查记录（重启后它已经不在了）：审查全流程只做一次，
 * 再做一次抑制计数就会失真。
 */
export function publishedC3Source(deps: {
  artifacts: NodeArtifactStore;
  receipts?: NodeReceiptReporter;
  now?: () => Date;
}): StageReportDeps['c3Payload'] {
  return (ref) => {
    const record = deps.artifacts.read(ref.handle);
    const now = deps.now?.() ?? new Date();
    if (!record || record.jobId !== ref.jobId || Date.parse(record.expiresAt) <= now.getTime())
      throw new StageReportRefused(
        'E_RUNTIME',
        `C3 制品 ${ref.handle} 已不在本节点（已销毁或已到期）：不可再投递`,
      );
    if (
      record.label !== 'C3' ||
      record.digest !== ref.digest ||
      canonicalSm3(record.payload) !== ref.digest
    )
      throw new StageReportRefused(
        'E_RELEASE_CHECK_FAILED',
        `制品库里的 ${ref.handle} 与出口时登记的摘要不一致：不是出口守卫放行的那一份，拒绝投递`,
      );
    if (
      deps.receipts &&
      !deps.receipts
        .chain(ref.jobId)
        .some(
          (receipt) =>
            receipt.event === 'EXITED' &&
            receipt.stage === ref.stageId &&
            receipt.output_digest === ref.digest,
        )
    )
      throw new StageReportRefused(
        'E_RELEASE_CHECK_FAILED',
        `本地回执链上没有 ${ref.handle} 的出口（EXITED）记录：未经出口守卫放行的产物不得投递`,
      );
    return record.payload;
  };
}

/**
 * 把还欠着的上报逐项做完：做完一项就从 `pending` 里划掉并回调 `onProgress`（调用方落盘）。
 * 遇到第一处失败即停并抛 {@link StageReportError}——链路多半是整体不通，逐项硬试只会把
 * 串行的消息循环再堵上几分钟。`counts` 由调用方给出，失败时也能看到已经做完的部分。
 */
export async function completeStageReports(
  deps: StageReportDeps,
  ctx: { jobId: string; credentialId: string; stageId: string },
  pending: PendingStageReports,
  opts: { onProgress?: () => void; counts?: StageReportCounts } = {},
): Promise<StageReportCounts> {
  const counts = opts.counts ?? { handleRegistered: false, delivered: false, witnesses: 0, receipts: 0 };
  const link = { outbound: deps.outbound, platform: deps.platform };
  const step = async (name: StageReportStep, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (err) {
      throw new StageReportError(name, err);
    }
    opts.onProgress?.();
  };

  const handle = pending.handle;
  if (handle)
    await step('handle', async () => {
      await registerArtifactHandle(link, { jobId: ctx.jobId, credentialId: ctx.credentialId, ...handle });
      delete pending.handle;
      counts.handleRegistered = true;
    });

  const delivery = pending.delivery;
  if (delivery)
    await step('delivery', async () => {
      const payload = deps.c3Payload({
        jobId: ctx.jobId,
        stageId: ctx.stageId,
        handle: delivery.handle,
        digest: delivery.digest,
      });
      await deliverC3Payload(link, {
        jobId: ctx.jobId,
        credentialId: ctx.credentialId,
        ...delivery,
        label: 'C3',
        payload,
      });
      delete pending.delivery;
      counts.delivered = true;
    });

  while (pending.witnesses && pending.witnesses.length > 0) {
    const witness = pending.witnesses[0];
    await step('witnesses', async () => {
      await reportWitness(witness, { receiver: deps.platform, outbound: deps.outbound });
      pending.witnesses?.shift();
      counts.witnesses += 1;
    });
  }
  delete pending.witnesses;

  if (pending.receipts)
    await step('receipts', async () => {
      counts.receipts += deps.receipts ? await deps.receipts.report(ctx.jobId) : 0;
      delete pending.receipts;
    });

  return counts;
}

export interface StageReportingResult extends StageReportCounts {
  /** 全部上报（含成功状态）都已送达。 */
  complete: boolean;
  statusReported: boolean;
  /** 还欠着的步骤（含 `status`）。 */
  outstanding: StageReportStep[];
  /** 停在哪一步、为什么（没送到：下次重发的指令接着补）。 */
  stalled?: { step: StageReportStep; message: string };
  /**
   * 这一步**被拒**（平台明确应答了 4xx，或本节点判定不可投）：重试不会变好，已按阶段失败上报。
   * `failureReported=false` 表示这条失败状态本身也没送到——下次重发时会再试上报、再报一次。
   */
  rejected?: { step: StageReportStep; code: string; message: string; failureReported: boolean };
}

/**
 * 一次「把上报做完」的尝试：欠着的各项 → 全部送达后才报阶段成功。
 *
 * **成功状态必须最后发**：平台收下它就撤回这份指令、不再重发——那之后节点再没有机会补别的上报。
 *
 * 三种结局：
 *  - 全部送达 → `complete`；
 *  - 某一步**没送到**（链路不通 / 超时 / 5xx / 限流）→ `stalled`：什么都不报，等指令重发再补。
 *    尤其**不报阶段失败**：阶段已经执行完，报失败只会让平台退避重发、白白消耗重试次数；
 *  - 某一步**被拒** → `rejected`：如实报阶段失败，错误码沿用平台应答里的协议错误码
 *    （没有就用 `E_RUNTIME`）。平台据此让作业失败并销毁（不可重试的码）或退避后再发指令
 *    （可重试的码——节点收到后仍只是再试上报）。两种情况下**都不重跑**。
 */
export async function finishStageReporting(
  deps: StageReportDeps,
  input: {
    jobId: string;
    credentialId: string;
    stageId: string;
    /** 当前这份指令的 attempt（状态上报的幂等键与平台的陈旧判定都看它）。 */
    attempt: number;
    digest: string;
    label: FlowLabel;
    /** 还欠着的上报；**原地修改**（送达一项划掉一项）。 */
    pending: PendingStageReports;
    statusReported: boolean;
    onProgress?: () => void;
  },
): Promise<StageReportingResult> {
  const counts: StageReportCounts = { handleRegistered: false, delivered: false, witnesses: 0, receipts: 0 };
  const result: StageReportingResult = {
    ...counts,
    complete: false,
    statusReported: input.statusReported,
    outstanding: [],
  };
  const ctx = { jobId: input.jobId, credentialId: input.credentialId, stageId: input.stageId };
  const link = { outbound: deps.outbound, platform: deps.platform };
  const remaining = (): StageReportStep[] => [
    ...outstandingReports(input.pending),
    ...(result.statusReported ? [] : (['status'] as const)),
  ];

  try {
    await completeStageReports(deps, ctx, input.pending, { onProgress: input.onProgress, counts });
  } catch (err) {
    Object.assign(result, counts);
    if (!(err instanceof StageReportError)) throw err;
    result.outstanding = remaining();
    const verdict = rejectionOf(err.reason);
    if (!verdict) {
      result.stalled = { step: err.step, message: (err.reason as Error)?.message ?? String(err.reason) };
      return result;
    }
    const message = `阶段已执行完成，但${STEP_NAME[err.step]}未被接受（${verdict.detail}）；未重新执行`;
    const failureReported = await reportNodeStageStatus(link, {
      ...ctx,
      attempt: input.attempt,
      status: 'FAILED',
      code: verdict.code,
      message,
    }).then(
      () => true,
      () => false,
    );
    result.rejected = { step: err.step, code: verdict.code, message, failureReported };
    return result;
  }
  Object.assign(result, counts);

  if (!result.statusReported) {
    try {
      await reportNodeStageStatus(link, {
        ...ctx,
        attempt: input.attempt,
        status: 'SUCCEEDED',
        digest: input.digest,
        label: input.label,
      });
      result.statusReported = true;
    } catch (err) {
      result.stalled = { step: 'status', message: (err as Error)?.message ?? String(err) };
    }
  }
  result.outstanding = remaining();
  result.complete = result.statusReported;
  return result;
}

/** 这次失败是不是「被拒」（重试不会变好）；不是就返回 `null`（＝没送到，等重发再补）。 */
function rejectionOf(reason: unknown): { code: string; detail: string } | null {
  if (reason instanceof StageReportRefused) return { code: reason.code, detail: reason.message };
  if (reason instanceof MdopOutboundHttpError) {
    const { status, platformCode } = reason;
    // 408 / 425 / 429 是「稍后再试」，5xx 是平台自己的故障——都不算平台对这份内容的结论
    if (status < 400 || status >= 500 || status === 408 || status === 425 || status === 429) return null;
    const known = platformCode && (MDOP_ERROR_CODES as readonly string[]).includes(platformCode);
    return {
      code: known ? platformCode : 'E_RUNTIME',
      detail: `平台应答 HTTP ${status}${platformCode ? ` ${platformCode}` : ''}`,
    };
  }
  return null;
}
