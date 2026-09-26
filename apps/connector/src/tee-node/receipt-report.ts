import type { Envelope } from '@medtrust/mdop';
import type { MdopOutboundClient } from '../mdop/mdop-client';
import type { NodeReceipt, NodeReceiptChain } from '../mdop/node/node-receipts';

/**
 * 节点回执链的**上报端**（任务 3.9 / 8.5 的「回执链锚定」那一半）。
 *
 * 节点回执**就是 `AuditReceipt`**（见 `node-receipts.ts`），所以上报走的是与连接器完全相同的
 * 控制面通道与消息类型：平台按「节点 + 作业」收链、逐条验连续性、终态时把**链头**上链锚定。
 * 这样「在什么代码下处理过这份数据」可以只凭链 + 证明摘要事后核验，不必信任任何一方的转述。
 *
 * 幂等：`audit:${receipt_id}`。至少一次投递下重复上报同一份回执只会被平台去重（同 id 落一行），
 * 也不会在本地重复发第二条。
 */

export class NodeReceiptReporter {
  private readonly reported = new Set<string>();

  constructor(
    private readonly deps: {
      receipts: NodeReceiptChain;
      outbound: MdopOutboundClient;
      /** 回执的收件方（本设计中是平台）。 */
      platform: string;
    },
  ) {}

  /** 上报该作业**尚未上报**的回执，返回本次发出的条数。 */
  async report(jobId: string): Promise<number> {
    let sent = 0;
    for (const receipt of this.deps.receipts.list(jobId)) {
      if (this.reported.has(receipt.receipt_id)) continue;
      const envelope: Envelope = this.deps.outbound.buildEnvelope({
        msgType: 'AuditReceipt',
        jobId,
        receiver: this.deps.platform,
        idempotencyKey: `audit:${receipt.receipt_id}`,
        body: receipt as unknown as Record<string, unknown>,
      });
      await this.deps.outbound.sendMessage(envelope);
      this.reported.add(receipt.receipt_id);
      sent += 1;
    }
    return sent;
  }

  /** 已上报的条数（审计导出用）。 */
  reportedCount(): number {
    return this.reported.size;
  }

  /** 该作业已上报的回执（按链序）。 */
  reportedOf(jobId: string): NodeReceipt[] {
    return this.deps.receipts.list(jobId).filter((r) => this.reported.has(r.receipt_id));
  }
}
