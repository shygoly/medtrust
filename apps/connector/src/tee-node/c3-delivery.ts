import type { FlowLabel } from '@medtrust/mdop';
import type { MdopOutboundClient } from '../mdop/mdop-client';
import type { NodeReceiptReporter } from './receipt-report';

/**
 * 节点产物的**出站登记与投递**（任务 3.12d 抽出来的公共一段）。
 *
 * 两条规则在两种路径上完全一致，所以只留一份实现：
 *  ① **句柄走控制面**（`ArtifactReady`，只登记句柄与规模元数据，**不含载荷**）；
 *  ② **只有 C3 走数据面**（`ResultDeliver` 连载荷一起投）——C2 是入口形态，制品留在节点本地，
 *     出口守卫与协议 R5 都不允许它出去。
 *
 * 两条都可以**原样重发**（平台侧同句柄登记是覆盖写、同节点同作业的已接受投递是更新同一行），
 * 所以它们没送达时节点只需补发、不需重跑——由 `stage-reports.ts` 按已执行登记里的欠账清单去补。
 * 幂等键由「作业 + 阶段 + 凭证（投递）/ 阶段（登记）」决定。
 */

export interface ArtifactDeliveryDeps {
  /** 以**节点身份**签名的出站客户端。 */
  outbound: MdopOutboundClient;
  /** 接收方（本设计中是平台）。 */
  platform: string;
  /** 回执链上报（可选：给了就在投递后上报一次）。 */
  receipts?: NodeReceiptReporter;
  /** 本地状态落盘（可选）。 */
  state?: { persist(): unknown };
}

export interface ArtifactRef {
  jobId: string;
  credentialId: string;
  stage: { id: string; op: string; op_digest: string; output_schema: string };
  handle: string;
  /** 制品等级：`C3` 会被投递载荷，其余（C2）只登记句柄。 */
  label: FlowLabel;
  /** 载荷摘要（`sm3:<64hex>`）。 */
  digest: string;
  /**
   * 句柄的过期时刻（RFC3339）。**必填**：平台侧的句柄解析器把它列为必填字段——
   * 早先这里漏了它，节点发出的 `ArtifactReady` 会被平台直接判 schema 非法
   * （`schema handle: 缺少必填字段 expires_at`），只是分块用例看不出来（2026-09-25 由 C2 端到端用例抓到）。
   */
  expiresAt: string;
  /** 载荷本体：只有 C3 需要（也是唯一被投递出去的那一类）。 */
  payload?: Record<string, unknown>;
}

/** 登记句柄（控制面；**不含载荷**）。 */
export async function registerArtifactHandle(
  deps: ArtifactDeliveryDeps,
  ref: ArtifactRef,
): Promise<void> {
  await deps.outbound.sendMessage(
    deps.outbound.buildEnvelope({
      msgType: 'ArtifactReady',
      jobId: ref.jobId,
      receiver: deps.platform,
      idempotencyKey: `ready:${ref.jobId}:${ref.stage.id}:1`,
      body: {
        handle: {
          handle: ref.handle,
          label: ref.label,
          schema: ref.stage.output_schema,
          digest: ref.digest,
          producer: {
            stage: ref.stage.id,
            op: ref.stage.op,
            op_digest: ref.stage.op_digest,
          },
          ticket_id: ref.credentialId,
          expires_at: ref.expiresAt,
          stats: null,
        },
      },
    }),
  );
}

/** 句柄过期时刻（与连接器同口径：72 小时）——调用方按自己的时钟算，别各写一个魔数。 */
export function handleExpiry(now: Date): string {
  return new Date(now.getTime() + 72 * 3_600_000).toISOString();
}

/** 投递 C3 载荷（数据面）。只接受 C3 —— 其它等级一律拒（与出口守卫同口径）。 */
export async function deliverC3Payload(
  deps: ArtifactDeliveryDeps,
  ref: ArtifactRef,
): Promise<void> {
  if (ref.label !== 'C3')
    throw new Error(`数据面只投递 C3：收到 ${ref.label}`);
  if (!ref.payload) throw new Error('C3 投递缺载荷');
  await deps.outbound.sendDelivery(
    deps.outbound.buildEnvelope({
      msgType: 'ResultDeliver',
      jobId: ref.jobId,
      receiver: deps.platform,
      idempotencyKey: `deliver:${ref.jobId}:${ref.stage.id}:${ref.credentialId}`,
      body: { handle: ref.handle, digest: ref.digest, label: 'C3' },
    }),
    { handle: ref.handle, label: 'C3', digest: ref.digest },
    ref.payload,
  );
}
