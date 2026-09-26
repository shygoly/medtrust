// omop-data-source-access —— 覆盖元数据的库内统计（task 5.1，spec: 覆盖元数据由库内统计自动产出）。
//
// 目录上「这家医院的 CDM 有什么」不该靠人填：连接器直接从视图里数出来。
// 产出的只有统计量——表的**数量级**（不报精确行数）与观察期的**月粒度**跨度；
// 格式由共享校验器（validateCoverageReport）钉死，报文里没有能放行级数据的位置。
import {
  CDM_COVERAGE_TABLES,
  recordMagnitude,
  type CdmCoverageStats,
} from '@medtrust/database';
import { CdmExecutor, DataSourceError } from './cdm-executor';

/** 这几类错误表示「这张表医院没给（或没给我们看）」，不算统计失败。 */
function tableNotProvided(err: unknown): boolean {
  return (
    err instanceof DataSourceError &&
    (err.kind === 'undefined-object' || err.kind === 'permission-denied')
  );
}

/** 这几类错误表示整个数据源出了问题——统计整体作废，而不是给每张表记一个 null。 */
function sourceBroken(err: unknown): boolean {
  return err instanceof DataSourceError && (err.kind === 'unavailable' || err.kind === 'auth-failed');
}

export async function computeCdmCoverage(
  executor: CdmExecutor,
  clock: () => Date = () => new Date(),
): Promise<CdmCoverageStats> {
  const d = executor.dialect;
  const { cdm } = executor.config.schemas;

  const tables: CdmCoverageStats['tables'] = [];
  for (const table of CDM_COVERAGE_TABLES) {
    try {
      const [row] = await executor.query<{ n: string | number }>({
        text: `SELECT count(*) AS n FROM ${d.qualify(cdm, table)}`,
      });
      const n = Number(row?.n ?? 0);
      if (n > 0) tables.push({ table, magnitude: recordMagnitude(n) });
    } catch (err) {
      if (tableNotProvided(err)) continue;
      if (sourceBroken(err)) throw err;
      // 超时等：如实记「统计失败」，不能当成「没有数据」。
      tables.push({ table, magnitude: null });
    }
  }

  const [span] = await executor.query<{ from_month: string | null; to_month: string | null }>({
    text: `SELECT ${d.yearMonth('min(observation_period_start_date)')} AS from_month,
                  ${d.yearMonth('max(observation_period_end_date)')} AS to_month
           FROM ${d.qualify(cdm, 'observation_period')}`,
  });
  const timeSpan =
    span?.from_month && span?.to_month ? { from: span.from_month, to: span.to_month } : null;

  return { tables, timeSpan, computedAt: clock().toISOString() };
}
