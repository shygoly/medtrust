import { Injectable, Logger } from '@nestjs/common';
import {
  MdopError,
  canonicalSm3,
  canonicalize,
  parseAuditReceipt,
  signCanonicalObject,
  verifyCanonicalObject,
  type AuditReceipt,
  type FlowLabel,
} from '@medtrust/mdop';
import { connectorPublicKey } from '../../domain/connector-key';

/**
 * 节点侧审计回执链（任务 3.9、协议 §10.3）。
 *
 * 每类事件（**解封 / 执行 / 出口 / 销毁**）出一条**签名**回执，`prev_receipt_hash` 指向上一条的哈希，
 * 因此链一断就能被发现。回执里带上证明摘要与度量（至少解封与执行两类）——这样「在什么代码下处理过
 * 这份数据」可被第三方离线核验，而不必相信节点运营方或平台的转述。
 *
 * 与数据持有方一侧的回执链同一套判据（`canonicalSm3` 成链 + SM2 签名），但**节点自己签**：
 * 平台侧逐节点校验连续性，链头由平台锚定。
 */

export type NodeReceiptEvent = Extract<
  AuditReceipt['event'],
  'UNSEALED' | 'EXECUTED' | 'EXITED' | 'PURGED' | 'STAGE_FAILED'
>;

/**
 * 节点回执**就是协议里的 `AuditReceipt`**（任务 3.9）。
 *
 * 为什么不另立一种对象：平台已有的「按节点 + 作业收链接、逐条验连续性、终态锚定链头」
 * 都是围绕 `AuditReceipt` 建的；节点直接产出同一形状，就能走同一条通道被核验与锚定，
 * 不必再写一遍（`parseAuditReceipt` 也就能直接校验平台收到的内容）。
 */
export type NodeReceipt = AuditReceipt;

export interface NodeReceiptDeps {
  /** 本节点身份（URN）。 */
  node: string;
  /** 覆盖私钥来源（测试用）。 */
  privateKey?: string;
}

@Injectable()
export class NodeReceiptChain {
  private readonly logger = new Logger(NodeReceiptChain.name);
  private readonly byJob = new Map<string, NodeReceipt[]>();

  constructor(private readonly deps: NodeReceiptDeps) {}

  /** 追加一条签名回执，返回其哈希（链头）。 */
  append(input: {
    jobId: string;
    /** 事件发生的阶段（节点级事件用 `__node__`）。 */
    stage: string;
    event: NodeReceiptEvent;
    opDigest: string;
    outputDigest?: string | null;
    label?: FlowLabel | null;
    inputDigests?: string[];
    attestation?: NodeReceipt['attestation'];
    detail?: Record<string, unknown>;
  }): { receipt: NodeReceipt; entryHash: string } {
    const chain = this.byJob.get(input.jobId) ?? [];
    const prev = chain.length ? canonicalSm3(chain[chain.length - 1]) : null;
    const payload = {
      receipt_id: `${input.jobId}:${input.event}:${chain.length}`,
      job_id: input.jobId,
      stage: input.stage,
      event: input.event,
      input_digests: input.inputDigests ?? [],
      op_digest: input.opDigest,
      output_digest: input.outputDigest ?? null,
      label: input.label ?? null,
      ...(input.attestation ? { attestation: input.attestation } : {}),
      // 细节进 `detail` 子对象：`AuditReceipt` 对**顶层**未知字段是拒收的，
      // 把句柄/目标/密钥摘要摊在顶层会让平台解析器直接拒掉这条回执。
      ...(input.detail ? { detail: input.detail } : {}),
      prev_receipt_hash: prev,
      signer: this.deps.node,
      at: new Date().toISOString(),
    };
    const privateKey = this.privateKey();
    // 自检：产出的回执必须能被协议解析器读回（平台侧收到的就是这条形状，不能「本地自洽、对外不合法」）
    // 签名口径与仓库其它签名对象**一致**（`signCanonicalObject` = 对 JCS 规范化串的 SM3 摘要做国标签名）：
    // 否则离线核验工具（用 `verifyCanonicalObject`）在这条链上会一律判「签名验证失败」——
    // 这一条是**实测踩到的**：节点链原先签的是规范化串本身，离线工具验不过。
    const receipt = parseAuditReceipt({
      ...payload,
      sig: signCanonicalObject(payload, privateKey, { publicKey: connectorPublicKey(privateKey) }),
    });
    chain.push(receipt);
    this.byJob.set(input.jobId, chain);
    return { receipt, entryHash: canonicalSm3(receipt) };
  }

  /** 链头（平台锚定用）。 */
  head(jobId: string): string | null {
    const chain = this.byJob.get(jobId) ?? [];
    return chain.length ? canonicalSm3(chain[chain.length - 1]) : null;
  }

  list(jobId: string): readonly NodeReceipt[] {
    return this.byJob.get(jobId) ?? [];
  }

  /**
   * 导出全部链（落盘用；任务 3.16）。
   * 脱敏边界：回执里只有摘要与标识，**没有载荷内容**，因此落盘不引入新的数据面。
   */
  dump(): Array<{ jobId: string; receipts: NodeReceipt[] }> {
    return [...this.byJob.entries()].map(([jobId, receipts]) => ({ jobId, receipts: [...receipts] }));
  }

  /**
   * 从落盘快照恢复（重启后链仍在、且**逐条验签仍通过**）。
   * 恢复时按原顺序写入，不重签、不重算——链的哈希就是回执自身的哈希。
   */
  import(snapshot: ReadonlyArray<{ jobId: string; receipts: readonly NodeReceipt[] }>): number {
    let loaded = 0;
    for (const item of snapshot) {
      const chain = item.receipts.map((r) => parseAuditReceipt(r));
      this.byJob.set(item.jobId, chain);
      loaded += chain.length;
    }
    return loaded;
  }

  /**
   * 逐条校验：① `prev_receipt_hash` 与上一条哈希一致；② 本条签名在**给定公钥**下有效。
   * 断链或验签失败都要**指出位置**（平台侧与离线工具同判据）。
   */
  verify(jobId: string, publicKey: string): { valid: boolean; brokenAt?: string; reason?: string } {
    const chain = this.byJob.get(jobId) ?? [];
    let prev: string | null = null;
    for (const [i, receipt] of chain.entries()) {
      if ((receipt.prev_receipt_hash ?? null) !== prev)
        return {
          valid: false,
          brokenAt: receipt.receipt_id,
          reason: `第 ${i + 1} 条回执的前序哈希对不上（声明 ${receipt.prev_receipt_hash ?? 'null'}，实际 ${prev ?? 'null'}）`,
        };
      const { sig, ...payload } = receipt;
      if (!verifyCanonicalObject(payload, sig, publicKey))
        return { valid: false, brokenAt: receipt.receipt_id, reason: `第 ${i + 1} 条回执验签失败` };
      prev = canonicalSm3(receipt);
    }
    return { valid: true };
  }

  private privateKey(): string {
    const key = this.deps.privateKey ?? process.env.CONNECTOR_SM2_PRIVATE_KEY ?? '';
    if (!key) throw new MdopError('E_RUNTIME', {}, '节点未配置私钥，无法签审计回执');
    return key;
  }

}
