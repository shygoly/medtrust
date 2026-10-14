import { Injectable, Logger } from '@nestjs/common';
import { MdopError } from '@medtrust/mdop';
import { OutputBlocked, OutputGate } from '../../domain/output-gate';

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
  /**
   * 罕见病列的发布阈值（只对带 `rareBuckets` 的载荷生效）。它只能比 `minCell` **更严**：
   * 显式给出且小于 `minCell` 即拒；不给时取 `max(10, minCell)`。
   */
  minCellRare?: number;
  contractId: string;
  /** DP 声明（缺省 none；本期节点内不施加噪声，只如实记录声明）。 */
  dp?: { mode: 'none' } | { mode: 'epsilon'; epsilon: number };
}

export interface PublicationReviewRecord {
  contractId: string;
  minCell: number;
  /** 罕见病列的更严阈值（D-RWS-7；缺省 = minCell）。两个阈值都要记进审计记录。 */
  minCellRare: number;
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

/** 罕见病列的缺省发布阈值（D-RWS-7）。 */
export const DEFAULT_MIN_CELL_RARE = 10;

/**
 * 罕见病阈值的取值：显式给出的不得**小于**常规阈值（罕见病小细胞重识别风险更高，放宽即拒）；
 * 没给时取 `max(10, minCell)`——合约把常规阈值定到 10 以上时，缺省值跟着抬高，而不是反过来
 * 让所有不涉及罕见病的发布也因为「10 < minCell」被拒。
 */
function resolveMinCellRare(minCell: number, configured: number | undefined): number {
  if (configured === undefined || !Number.isFinite(configured) || configured <= 0)
    return Math.max(DEFAULT_MIN_CELL_RARE, minCell);
  if (configured < minCell)
    throw new MdopError(
      'E_RUNTIME',
      {},
      `罕见病阈值 ${configured} 不得小于常规阈值 ${minCell}（罕见病小细胞重识别风险更高）`,
    );
  return configured;
}

/**
 * 罕见病列的**单独抑制**：`0 < 计数 < minCellRare` 的层，把该层 `rareCases` 置零并标
 * `rareSuppressed: true`（其余列照常发布——罕见病小细胞不该把整层常规结果也砍掉）。
 *
 * 只有载荷里带 `rareBuckets`（跨院去重场景）时才生效；其它分析类型原样返回。
 */
function applyRareThreshold(
  payload: Record<string, unknown>,
  minCellRare: number,
): Record<string, unknown> {
  const rareBuckets = payload.rareBuckets;
  const strata = payload.strata;
  if (!Array.isArray(rareBuckets) || !Array.isArray(strata)) return payload;
  const suppressed = new Set(
    (rareBuckets as Array<{ key?: unknown; count?: unknown }>)
      .filter((b) => {
        const count = Number(b?.count ?? 0);
        return count > 0 && count < minCellRare;
      })
      .map((b) => String(b?.key ?? '')),
  );
  if (suppressed.size === 0) return payload;
  return {
    ...payload,
    strata: (strata as Array<Record<string, unknown>>).map((cell) =>
      suppressed.has(String(cell.key ?? ''))
        ? { ...cell, rareCases: 0, rareSuppressed: true }
        : cell,
    ),
    rareBuckets: (rareBuckets as Array<Record<string, unknown>>).map((bucket) =>
      suppressed.has(String(bucket?.key ?? ''))
        ? { ...bucket, count: 0, suppressed: true }
        : bucket,
    ),
  };
}

/** 被抑制的分层：所有数值字段清零（不论分析类型有哪些计数列），只留键与抑制标记。 */
function zeroCell(cell: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { key: cell.key };
  for (const [name, value] of Object.entries(cell)) if (typeof value === 'number') out[name] = 0;
  out.suppressed = true;
  return out;
}

/**
 * 让 `strata` 与过闸门后的 `buckets` 对齐：
 *  - 被抑制（`suppressed === true`）或计数为 0 的分层 → 整格清零并标 `suppressed: true`；
 *  - 其余分层原样保留。
 *
 * 「计数本来就是 0」也一并视为不可发布：那是**保守口径**（fail-closed），
 * 宁可少发一个空分层，也不让一个可能被抑制过的格子以「恰好为 0」的样子留在结果里。
 */
function alignStrata(payload: Record<string, unknown>): Record<string, unknown> {
  const buckets = payload.buckets;
  const strata = payload.strata;
  if (!Array.isArray(buckets) || !Array.isArray(strata)) return payload;
  const unpublished = new Set(
    (buckets as Array<{ key?: unknown; count?: unknown; suppressed?: unknown }>)
      .filter((b) => b?.suppressed === true || Number(b?.count ?? 0) === 0)
      .map((b) => String(b?.key ?? '')),
  );
  return {
    ...payload,
    strata: (strata as Array<Record<string, unknown>>).map((cell) =>
      unpublished.has(String(cell.key ?? '')) ? zeroCell(cell) : cell,
    ),
  };
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
    const minCellRare = resolveMinCellRare(input.minCell, input.minCellRare);

    let published: Record<string, unknown>;
    try {
      published = this.gate.pass(input.candidate, input.minCell, {
        contractId: input.contractId,
      }) as unknown as Record<string, unknown>;
    } catch (err) {
      // 闸门拒放（含行级/可识别内容）→ 直接失败，不做任何降级。
      // 这条说明会随阶段失败状态上报给平台，所以只放**闸门自己的固定拒放原因**
      // （`OutputBlocked` 的文案是常量，不带候选内容）；其它异常（候选形状异常引出的运行时错误等）
      // 的文案不受控、可能带出候选里的值，只写节点本地日志。
      if (err instanceof OutputBlocked)
        throw new MdopError('E_RELEASE_CHECK_FAILED', {}, `发布审查未通过：${err.message}`);
      this.logger.error(
        `发布审查异常 contract=${input.contractId}：${err instanceof Error ? err.message : String(err)}`,
      );
      throw new MdopError(
        'E_RELEASE_CHECK_FAILED',
        {},
        '发布审查未通过：候选结果无法完成审查（详情只留在节点本地日志）',
      );
    }
    // 闸门是按 `buckets` 做小单元格抑制的，而平台侧的收集方读的是 `strata`：两者不一致就会出现
    // 「平台拿到未抑制的分层计数」（差一个格子就是可识别性泄露）。分层对齐与罕见病列的单独抑制
    // 放在审查里做，而不是放在某一个出口——**所有**出口（独立降密阶段、单阶段会话出口）走的都是这里。
    published = alignStrata(applyRareThreshold(published, minCellRare));

    const record: PublicationReviewRecord = {
      contractId: input.contractId,
      minCell: input.minCell,
      minCellRare,
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
