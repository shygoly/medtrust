import { parseAnchorRecord, type AnchorRecord } from "../schema/artifact";

/**
 * 回执链头的锚定接缝（协议 §10 追溯：链头锚定到存证链）。
 *
 * 为什么这条规则要收进协议核、而不是各调用方各写一遍：**协议给它的判据只有一句，
 * 却有三个容易各自漂移的点**——
 *  1. 「锚定失败进补偿队列」：链不可达在部署上是常态（未接、抖动、证书过期），
 *     因此写失败 **MUST NOT** 变成作业失败，也 **MUST NOT** 被静默吞掉不留痕；
 *  2. 「不得伪造交易号」（协议 §10 原文）：失败时记录里**不能出现 `tx_id` 键**，
 *     空串/占位符/`pending` 都不许当交易号——否则「核验锚定」这一步从根上失去意义；
 *  3. 锚定记录本身要有稳定形状（`anchorRecord`），第三方离线核验才有东西可读。
 *
 * 分工：平台侧「哪些作业/节点还没锚」的调度与落库归回执链服务
 * （`apps/api/src/mdop/mdop-receipt-chain.service.ts`）；本函数只管「一次锚定怎么写、
 * 写不成记什么」，两侧共用同一份判据。
 */

/** 存证链写入端（真实实现：存证适配器）。 */
export interface ChainAnchorSink {
  anchor(input: { job_id: string; node: string; chain_head: string }): Promise<{ tx_id: string }>;
}

export interface AnchorChainHeadInput {
  job_id: string;
  /** 链头所属节点（回执链是逐节点的，锚定记录也逐节点）。 */
  node: string;
  /** 回执链头：`sm3:<64hex>`（形状由 `parseAnchorRecord` 的同一份判据强制）。 */
  chain_head: string;
  /** 未注入 = 存证链未部署/不可达 → 记 `pending`（进补偿队列）。 */
  sink?: ChainAnchorSink;
  /** 注入时钟（确定性测试用）；缺省取系统时间。 */
  now?: () => Date;
}

/**
 * 锚定一条链头，产出**可被 `parseAnchorRecord` 读回**的锚定记录。三条规则：
 *  1. 链头形状非法 → **抛错**（这是调用方的 bug，不是「链不可达」，不得静默降级成 pending）；
 *  2. 未注入写入端、写入端抛错、或写入端**没给出交易号** → `status=pending`，
 *     且记录里**不存在 `tx_id` 键**（fail-closed，不伪造交易号）；
 *  3. 写入成功 → `status=anchored` + `tx_id` + `anchored_at`（来自注入时钟）。
 */
export async function anchorChainHead(input: AnchorChainHeadInput): Promise<AnchorRecord> {
  const now = input.now ?? (() => new Date());
  // 先过一遍 schema：链头与节点字段的形状由同一份判据强制，错误信息也由它指名字段
  parseAnchorRecord({ node: input.node, chain_head: input.chain_head, status: "pending" });

  if (!input.sink)
    return parseAnchorRecord({ node: input.node, chain_head: input.chain_head, status: "pending" });

  let txId: string | undefined;
  try {
    const result = await input.sink.anchor({
      job_id: input.job_id,
      node: input.node,
      chain_head: input.chain_head,
    });
    const candidate = typeof result?.tx_id === "string" ? result.tx_id.trim() : "";
    txId = candidate === "" ? undefined : candidate;
  } catch {
    // 链不可达 → 进补偿队列；异常不冒给作业（协议 §10：失败重试，不得伪造交易号）
    txId = undefined;
  }

  if (txId === undefined)
    return parseAnchorRecord({ node: input.node, chain_head: input.chain_head, status: "pending" });

  return parseAnchorRecord({
    node: input.node,
    chain_head: input.chain_head,
    status: "anchored",
    tx_id: txId,
    anchored_at: now().toISOString(),
  });
}
