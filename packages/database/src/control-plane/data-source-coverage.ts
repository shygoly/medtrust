/**
 * omop-data-source-access —— CDM 数据产品的覆盖元数据（tasks 5.1–5.4）。
 *
 * 连接器从库内统计产出、控制面目录登记；两端用同一个校验器，所以「上报的只是统计量」
 * 不是约定而是格式：报文里没有任何一个位置能放行级数据——
 *
 *   · 表只报**数量级**（magnitude=k 表示 [10^k, 10^(k+1)) 行），不报精确行数；
 *   · 时间跨度只到**月**；
 *   · 表名只能取自固定清单，版本串限长、禁控制字符；
 *   · 任何多余字段一律拒收（白名单，不是黑名单）。
 */

/** 覆盖统计涉及的 CDM v5.4 临床数据表。 */
export const CDM_COVERAGE_TABLES = [
  'person',
  'observation_period',
  'visit_occurrence',
  'condition_occurrence',
  'drug_exposure',
  'procedure_occurrence',
  'measurement',
  'observation',
  'death',
  'device_exposure',
] as const;
export type CdmCoverageTable = (typeof CDM_COVERAGE_TABLES)[number];

export interface CdmCoverageStats {
  /** 含数据的表及其记录数量级；magnitude=null 表示该表统计失败（如超时），不是「没有数据」。 */
  tables: Array<{ table: CdmCoverageTable; magnitude: number | null }>;
  /** 观察期覆盖的时间跨度（YYYY-MM）；库里没有观察期数据时为 null。 */
  timeSpan: { from: string; to: string } | null;
  computedAt: string;
}

/**
 * 连接器每次接入校验后的上报。校验没过只报一个布尔——失败细节留在院内审计里。
 * coverage=null 表示校验通过但统计没算出来（版本仍然是新鲜的事实）。
 */
export type CdmCoverageReport =
  | { passed: false }
  | {
      passed: true;
      cdmVersion: string;
      vocabularyVersion: string;
      coverage: CdmCoverageStats | null;
    };

/** 控制面目录上登记的覆盖元数据（DataProduct.coverage）。 */
export interface DataProductCoverage {
  label: string;
  cdmVersion: string | null;
  vocabularyVersion: string | null;
  tables: CdmCoverageStats['tables'];
  timeSpan: CdmCoverageStats['timeSpan'];
  computedAt: string | null;
  reportedAt: string;
  /** 待刷新：版本变了而统计没跟上，或数据源最近一次接入校验未通过。 */
  stale: boolean;
  staleReason: string | null;
}

export class CoverageReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoverageReportError';
  }
}

const MAX_MAGNITUDE = 12;
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
// 版本串形如「5.4」「v5.0 31-AUG-24」：限长、可打印、无控制字符。
const VERSION = /^[\x20-\x7e一-鿿]{1,64}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function onlyKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    throw new CoverageReportError(`${where} 含不允许的字段：${extra.join(', ')}（覆盖上报只收统计量）`);
  }
}

function version(v: unknown, name: string): string {
  if (typeof v !== 'string' || !VERSION.test(v)) {
    throw new CoverageReportError(`${name} 须为 1–64 位可打印字符串`);
  }
  return v;
}

function validateStats(raw: unknown): CdmCoverageStats {
  if (!isRecord(raw)) throw new CoverageReportError('coverage 须为对象或 null');
  onlyKeys(raw, ['tables', 'timeSpan', 'computedAt'], 'coverage');

  if (!Array.isArray(raw.tables) || raw.tables.length > CDM_COVERAGE_TABLES.length) {
    throw new CoverageReportError('coverage.tables 须为数组，且不超过固定表清单长度');
  }
  const seen = new Set<string>();
  const tables = raw.tables.map((t) => {
    if (!isRecord(t)) throw new CoverageReportError('coverage.tables 的元素须为对象');
    onlyKeys(t, ['table', 'magnitude'], 'coverage.tables[]');
    if (typeof t.table !== 'string' || !(CDM_COVERAGE_TABLES as readonly string[]).includes(t.table)) {
      throw new CoverageReportError(`coverage.tables 含清单外的表：${String(t.table)}`);
    }
    if (seen.has(t.table)) throw new CoverageReportError(`coverage.tables 重复：${t.table}`);
    seen.add(t.table);
    const m = t.magnitude;
    if (m !== null && !(Number.isInteger(m) && (m as number) >= 0 && (m as number) <= MAX_MAGNITUDE)) {
      throw new CoverageReportError(`coverage.tables[${t.table}].magnitude 须为 0–${MAX_MAGNITUDE} 的整数或 null（只报数量级）`);
    }
    return { table: t.table as CdmCoverageTable, magnitude: m as number | null };
  });

  let timeSpan: CdmCoverageStats['timeSpan'] = null;
  if (raw.timeSpan !== null) {
    if (!isRecord(raw.timeSpan)) throw new CoverageReportError('coverage.timeSpan 须为对象或 null');
    onlyKeys(raw.timeSpan, ['from', 'to'], 'coverage.timeSpan');
    const { from, to } = raw.timeSpan;
    if (typeof from !== 'string' || typeof to !== 'string' || !YEAR_MONTH.test(from) || !YEAR_MONTH.test(to)) {
      throw new CoverageReportError('coverage.timeSpan 只收 YYYY-MM（月粒度）');
    }
    if (from > to) throw new CoverageReportError('coverage.timeSpan 起点晚于终点');
    timeSpan = { from, to };
  }

  if (typeof raw.computedAt !== 'string' || !ISO_DATETIME.test(raw.computedAt)) {
    throw new CoverageReportError('coverage.computedAt 须为 ISO 8601 UTC 时间');
  }
  return { tables, timeSpan, computedAt: raw.computedAt };
}

/** 严格校验一份覆盖上报；连接器发出前自检、控制面收到后复检，用的是同一个函数。 */
export function validateCoverageReport(raw: unknown): CdmCoverageReport {
  if (!isRecord(raw)) throw new CoverageReportError('覆盖上报须为对象');
  if (raw.passed === false) {
    onlyKeys(raw, ['passed'], '覆盖上报（校验未通过）');
    return { passed: false };
  }
  if (raw.passed !== true) throw new CoverageReportError('passed 须为布尔');
  onlyKeys(raw, ['passed', 'cdmVersion', 'vocabularyVersion', 'coverage'], '覆盖上报');
  return {
    passed: true,
    cdmVersion: version(raw.cdmVersion, 'cdmVersion'),
    vocabularyVersion: version(raw.vocabularyVersion, 'vocabularyVersion'),
    coverage: raw.coverage === null || raw.coverage === undefined ? null : validateStats(raw.coverage),
  };
}

/** 行数 → 数量级（0 行不算「含数据」，由调用方剔除）。 */
export function recordMagnitude(count: number): number {
  if (!Number.isFinite(count) || count < 1) {
    throw new CoverageReportError(`数量级只对正行数有意义：${count}`);
  }
  return Math.min(MAX_MAGNITUDE, Math.floor(Math.log10(count)));
}

/**
 * 把一份上报合并进目录现有的覆盖元数据（task 5.4：陈旧可识别）。
 * 返回 undefined 表示不需要改动目录。
 */
export function mergeCoverage(
  existing: DataProductCoverage | null | undefined,
  label: string,
  report: CdmCoverageReport,
  now: Date,
): DataProductCoverage | undefined {
  const reportedAt = now.toISOString();
  const current = existing && existing.label === label ? existing : null;

  if (!report.passed) {
    if (!current) return undefined;
    return {
      ...current,
      stale: true,
      staleReason: '数据源最近一次接入校验未通过，覆盖元数据待刷新',
    };
  }

  if (report.coverage) {
    return {
      label,
      cdmVersion: report.cdmVersion,
      vocabularyVersion: report.vocabularyVersion,
      tables: report.coverage.tables,
      timeSpan: report.coverage.timeSpan,
      computedAt: report.coverage.computedAt,
      reportedAt,
      stale: false,
      staleReason: null,
    };
  }

  // 校验过了、版本是新鲜的，但统计没算出来。
  if (!current) {
    return {
      label,
      cdmVersion: report.cdmVersion,
      vocabularyVersion: report.vocabularyVersion,
      tables: [],
      timeSpan: null,
      computedAt: null,
      reportedAt,
      stale: true,
      staleReason: '覆盖统计尚未产出',
    };
  }
  const versionChanged =
    current.cdmVersion !== report.cdmVersion ||
    current.vocabularyVersion !== report.vocabularyVersion;
  if (!versionChanged) return undefined;
  return {
    ...current,
    // 版本是这次读到的事实，照实更新；表覆盖与时间跨度还是旧版本下的统计，标待刷新。
    cdmVersion: report.cdmVersion,
    vocabularyVersion: report.vocabularyVersion,
    reportedAt,
    stale: true,
    staleReason:
      `版本已变化（CDM ${current.cdmVersion ?? '?'}→${report.cdmVersion}，` +
      `词汇表 ${current.vocabularyVersion ?? '?'}→${report.vocabularyVersion}），表覆盖与时间跨度待刷新`,
  };
}
