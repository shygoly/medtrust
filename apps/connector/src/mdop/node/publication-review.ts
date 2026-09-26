import { Injectable, Logger } from '@nestjs/common';
import { MdopError } from '@medtrust/mdop';
import { OutputGate } from '../../domain/output-gate';

/**
 * 节点内的**发布审查**（任务 3.6、协议 §10.2）。
 *
 * 复用既有输出闸门（小单元格抑制 + 二次抑制），但**在可信空间节点内执行**——判据由被测代码强制，
 * 不依赖节点运营方自觉。审查结果只把过闸门后的 DAG 载荷作为 C3 出口；被抑制的格数留在**节点本地**
 * 的审查记录里（随审计回执上报），**不放进 C3 载荷**（放进载荷会把抑制细节也发布出去）。
 *
 * 与「平台侧合并」的关系：节点出 C3 之后平台只做合并，不再做抑制判定；因此这里的闸门是
 * 出域前的最后一道。
 */

export interface PublicationReviewInput {
  /** 待发布的候选结果（节点的算子输出）。 */
  candidate: unknown;
  /** 合约的发布条件（minCell 取本地合约副本）。 */
  minCell: number;
  contractId: string;
  /** DP 声明（缺省 none；本期节点内不施加噪声，只如实记录声明）。 */
  dp?: { mode: 'none' } | { mode: 'epsilon'; epsilon: number };
}

export interface PublicationReviewRecord {
  contractId: string;
  minCell: number;
  /** 被抑制的单元数（**只进审计，不进 C3 载荷**）。 */
  suppressed: number;
  dp: { mode: 'none' } | { mode: 'epsilon'; epsilon: number };
  at: string;
}

export interface PublicationReviewResult {
  /** 过闸门后的载荷（可发布为 C3）。 */
  payload: Record<string, unknown>;
  /** 节点本地的审查记录（随审计回执上报）。 */
  record: PublicationReviewRecord;
}

/** 计数候选里被抑制的单元：以 `suppressed` 标记或「原值 >0 且过闸门后为 0」为准。 */
function countSuppressed(candidate: unknown, published: Record<string, unknown>): number {
  const before = (candidate as { buckets?: Array<{ count?: number; suppressed?: boolean }> }).buckets;
  const after = (published as { buckets?: Array<{ count?: number; suppressed?: boolean }> }).buckets;
  if (!Array.isArray(before) || !Array.isArray(after)) return 0;
  let n = 0;
  for (let i = 0; i < before.length && i < after.length; i += 1) {
    const was = before[i];
    const now = after[i];
    const wasSuppressed = was?.suppressed === true;
    const becameZero = (was?.count ?? 0) > 0 && (after[i]?.count ?? 0) === 0;
    const nowSuppressed = now?.suppressed === true;
    if (!wasSuppressed && (becameZero || nowSuppressed)) n += 1;
  }
  return n;
}

@Injectable()
export class NodePublicationReview {
  private readonly logger = new Logger(NodePublicationReview.name);
  private readonly records: PublicationReviewRecord[] = [];

  constructor(private readonly gate: OutputGate) {}

  review(input: PublicationReviewInput): PublicationReviewResult {
    if (!Number.isFinite(input.minCell) || input.minCell <= 0)
      throw new MdopError('E_RUNTIME', {}, '发布审查缺少有效的 minCell（合约发布条件）');

    let published: Record<string, unknown>;
    try {
      published = this.gate.pass(input.candidate, input.minCell, {
        contractId: input.contractId,
      }) as unknown as Record<string, unknown>;
    } catch (err) {
      // 闸门拒放（含行级/可识别内容）→ 直接失败，不做任何降级
      throw new MdopError('E_RELEASE_CHECK_FAILED', {}, `发布审查未通过：${(err as Error).message}`);
    }

    const record: PublicationReviewRecord = {
      contractId: input.contractId,
      minCell: input.minCell,
      suppressed: countSuppressed(input.candidate, published),
      dp: input.dp ?? { mode: 'none' },
      at: new Date().toISOString(),
    };
    this.records.push(record);
    this.logger.log(
      `发布审查通过 contract=${input.contractId} minCell=${input.minCell} suppressed=${record.suppressed}`,
    );
    return { payload: published, record };
  }

  /** 本地审查记录（随审计回执上报；**不进 C3 载荷**）。 */
  recordsLog(): readonly PublicationReviewRecord[] {
    return this.records;
  }
}
