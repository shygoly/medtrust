import type { FlowLabel } from '@medtrust/mdop';
import type { MdopOutboundClient } from '../mdop/mdop-client';

/**
 * 节点侧的**阶段状态上报**（协议 §7.2 / §8.2，任务 3.12e）。
 *
 * 为什么可信空间节点也必须上报这件事：平台是**按阶段状态推进计划**的——
 * `StageStatus(SUCCEEDED)` 到达后，平台才会把下游阶段置为就绪并下发；
 * 失败则按错误码决定退避重试（30/60/120 秒、最多 3 次）还是把作业打成 FAILED。
 * 节点不报，作业就**卡在第一个节点阶段**：平台一直等一条永远不会来的状态（实测语义如此）。
 *
 * 与数据持有方同一套形状（`job_id` / `stage_id` / `ticket_id` / `attempt` / `status` / `code` / `message`），
 * 幂等键也是同一个口径 `status:<job>:<stage>:<attempt>`——平台侧因此不需要为节点开特例。
 * 状态里**不带任何制品内容**：只有摘要与等级（它们是可出域的元数据）。
 */

export interface StageStatusDeps {
  /** 以**节点身份**签名的出站客户端。 */
  outbound: MdopOutboundClient;
  /** 收件方（本设计中是平台）。 */
  platform: string;
}

export interface NodeStageStatusInput {
  jobId: string;
  stageId: string;
  credentialId: string;
  /** 平台下发该阶段时用的 attempt：幂等键与退避重试都以它为准。 */
  attempt: number;
  status: 'SUCCEEDED' | 'FAILED';
  /** 失败时的错误码（决定平台是否重试；缺省 `E_RUNTIME`）。 */
  code?: string;
  message?: string;
  /** 成功时的产物摘要与等级（元数据，不含载荷）。 */
  digest?: string;
  label?: FlowLabel;
}

export async function reportNodeStageStatus(
  deps: StageStatusDeps,
  input: NodeStageStatusInput,
): Promise<void> {
  await deps.outbound.sendMessage(
    deps.outbound.buildEnvelope({
      msgType: 'StageStatus',
      jobId: input.jobId,
      receiver: deps.platform,
      idempotencyKey: `status:${input.jobId}:${input.stageId}:${input.attempt}`,
      body: {
        job_id: input.jobId,
        stage_id: input.stageId,
        ticket_id: input.credentialId,
        attempt: input.attempt,
        status: input.status,
        ...(input.code ? { code: input.code } : {}),
        ...(input.message ? { message: input.message } : {}),
        ...(input.digest ? { digest: input.digest } : {}),
        ...(input.label ? { label: input.label } : {}),
      },
    }),
  );
}
