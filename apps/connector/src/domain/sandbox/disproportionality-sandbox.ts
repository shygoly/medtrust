// algorithm-sandbox — 失衡检测宿主适配(design D3)。
//
// 宿主在本地库守卫(aggregateInternal)内把行数据投影成最少的 0/1 标记列:
// 是否入组、是否暴露(用药)、每个事件词条是否发生。词条文本按首次出现顺序
// 建立 词条→下标 映射并**留在宿主一侧**;沙箱只回 a/b/c/d 计数。
//
// 输出回填 key/rate、按 a 降序稳定排序,并校验不变量 —— 与内置 TS 实现
// (rws-executor.disproportionalityTables)逐字段一致。
import { InternalRecord } from '../types';
import { matchesMedication } from '../clinical-matching';
import { isSupportedCohortRule, passesCohortDefinition } from '../cohort-definition';
import {
  applyMissingness,
  type MissingnessDeclarationLike,
  type MissingnessLog,
} from '../missingness';

export type TemporalMode = 'drug-before-event' | 'mixed' | 'undated-cooccurrence';

export interface TemporalWindowOptions {
  /** 用药起始后允许归因的最大天数（仅当暴露与事件均带日期时参与截断）。 */
  maxDaysAfterStart?: number;
  /** 是否允许事件发生于用药当日（默认 true）。 */
  allowSameDay?: boolean;
  /** 为 true 时，一旦暴露患者存在缺少日期的暴露/事件记录即 fail-closed 报错；默认 false 允许回退。 */
  requireTemporalOrder?: boolean;
}

export interface DisproportionalityProjection {
  /** 输入行数(含未入组行)。 */
  n: number;
  /** 事件词条数。 */
  k: number;
  /** 词条文本,首次出现顺序 —— 只在宿主一侧使用,不进入沙箱。 */
  terms: string[];
  /** 打包好的输入载荷(见 design D3 布局)。 */
  input: Uint8Array;
  /** 输出区偏移(4 字节对齐)。 */
  outOff: number;
  /** 输出区字节数 = 4 + 16k。 */
  outBytes: number;
  /** 入组行数(宿主侧口径,用于不变量对拍)。 */
  cohortSize: number;
  /** 入组内用药人数 a+b。 */
  nDrug: number;
  /** 入组内未用药人数 c+d。 */
  nNoDrug: number;
  /** 时间先后校验模式（用于审计与结果面板提示）。 */
  temporalMode?: TemporalMode;
}

export interface SandboxBucket {
  key: string;
  count: number;
  rate: number;
  b: number;
  c: number;
  d: number;
}

export function projectionRequiredBytes(n: number, k: number): number {
  const inBytes = 2 * n + n * k;
  return roundUp4(inBytes) + 4 + 16 * k;
}

/**
 * 生产/本地共享的 L1.5 队列与缺失准备阶段（必须在投影前应用）。
 * 含未知队列文法 fail-closed 校验与 `applyMissingness`。
 */
export function prepareDisproportionalityRows(
  rows: readonly InternalRecord[],
  params: Record<string, unknown> = {},
): { rows: readonly InternalRecord[]; missingnessLog?: MissingnessLog } {
  let prepared = rows;
  const cohortDef = params.cohortDefinition as
    | { inclusion?: string[]; exclusion?: string[] }
    | undefined;
  if (cohortDef) {
    const inclusion = cohortDef.inclusion ?? [];
    const exclusion = cohortDef.exclusion ?? [];
    for (const rule of [...inclusion, ...exclusion]) {
      if (!isSupportedCohortRule(rule)) {
        throw new Error(`队列规则不受支持（fail-closed）：${rule}`);
      }
    }
    prepared = prepared.filter((r) =>
      passesCohortDefinition(r, { inclusion, exclusion }),
    );
  }
  const declaration = params.missingnessDeclaration as
    | MissingnessDeclarationLike
    | undefined;
  if (declaration) {
    const stratifyBy = Array.isArray(params.stratifyBy)
      ? (params.stratifyBy as Array<'ageBand' | 'sex'>)
      : (['ageBand'] as Array<'ageBand' | 'sex'>);
    const applied = applyMissingness(prepared, declaration, stratifyBy);
    return { rows: applied.rows, missingnessLog: applied.log };
  }
  return { rows: prepared };
}

const MS_PER_DAY = 86_400_000;

function parseIsoDayMs(dateStr: string | undefined): number | undefined {
  if (!dateStr || typeof dateStr !== 'string') return undefined;
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : undefined;
}

function rowExposedToDrug(row: InternalRecord, drug: string): boolean {
  if (matchesMedication(row.medications, drug)) return true;
  if (row.medicationExposures?.length) {
    return row.medicationExposures.some((e) => matchesMedication([e.name], drug));
  }
  return false;
}

/**
 * 最小列投影。`isIncluded` 对应 TTE 纳入/排除(缺省全部入组);
 * 未入组行的 exposed/事件位一律写 0 —— 模块本身也会跳过未入组行。
 * 在宿主侧执行患者内重复词条去重，并在带日期时执行 Drug-before-Event 过滤
 * （默认允许无日期记录回退并标注 temporalMode）。
 */
export function projectDisproportionality(
  rows: readonly InternalRecord[],
  drug: string | undefined,
  isIncluded: (row: InternalRecord) => boolean = () => true,
  temporalOpts?: TemporalWindowOptions,
): DisproportionalityProjection {
  if (!drug) {
    throw new Error('disproportionality 需指定 drug of interest');
  }
  const included = rows.map((r) => isIncluded(r));
  const exposed = rows.map((r) => rowExposedToDrug(r, drug));

  let sawDated = false;
  let sawUndated = false;
  let sawExposedWithEvent = false;
  const allowSameDay = temporalOpts?.allowSameDay ?? true;
  const maxDaysAfterStart = temporalOpts?.maxDaysAfterStart;

  const rowTerms = rows.map((r, idx) => {
    const unique = new Set<string>();
    const isRowIncluded = included[idx];
    const isRowExposed = exposed[idx];

    let minStartMs: number | undefined;
    if (isRowIncluded && isRowExposed && r.medicationExposures?.length) {
      for (const exp of r.medicationExposures) {
        if (!matchesMedication([exp.name], drug)) continue;
        const ms = parseIsoDayMs(exp.startDate);
        if (ms !== undefined && (minStartMs === undefined || ms < minStartMs)) {
          minStartMs = ms;
        }
      }
    }

    for (const ev of r.adverseEvents) {
      if (!isRowIncluded) continue;
      if (isRowExposed) {
        sawExposedWithEvent = true;
        const onsetMs = parseIsoDayMs(ev.onsetDate);
        if (minStartMs !== undefined && onsetMs !== undefined) {
          sawDated = true;
          const afterStart = allowSameDay ? onsetMs >= minStartMs : onsetMs > minStartMs;
          if (!afterStart) continue;
          if (
            maxDaysAfterStart !== undefined &&
            (onsetMs - minStartMs) / MS_PER_DAY > maxDaysAfterStart
          ) {
            continue;
          }
        } else {
          sawUndated = true;
        }
      }
      unique.add(ev.term);
    }
    return [...unique];
  });

  if (temporalOpts?.requireTemporalOrder && sawExposedWithEvent && (sawUndated || !sawDated)) {
    throw new Error('L1.5 严格时间序模式要求暴露与不良事件均具备有效日期（fail-closed）');
  }

  const temporalMode: TemporalMode =
    sawDated && !sawUndated
      ? 'drug-before-event'
      : sawDated && sawUndated
        ? 'mixed'
        : 'undated-cooccurrence';

  const proj = buildDisproportionalityProjection(included, exposed, rowTerms);
  return { ...proj, temporalMode };
}

/**
 * 投影载荷的**唯一**构造点：文件路径与 CDM 数据库路径都走这里
 * （omop-data-source-access D4b：两条数据路径在投影载荷汇合）。
 * 只有一个实现，两条路径的字节布局就不可能漂移。
 *
 * @param included  每行是否入组
 * @param exposed   每行是否暴露（用药）
 * @param rowTerms  每行发生的事件词条（按出现顺序；词条下标按首次出现分配）
 */
export function buildDisproportionalityProjection(
  included: readonly boolean[],
  exposed: readonly boolean[],
  rowTerms: readonly (readonly string[])[],
): DisproportionalityProjection {
  const n = included.length;
  if (exposed.length !== n || rowTerms.length !== n) {
    throw new Error(
      `投影输入长度不一致：included=${n} exposed=${exposed.length} rowTerms=${rowTerms.length}`,
    );
  }

  // 词条集合只来自入组行 —— 与 TS 实现在过滤后的队列上收集 Set 一致，且按患者内去重。
  const dedupedTerms = rowTerms.map((list) => [...new Set(list)]);
  const termIndex = new Map<string, number>();
  const terms: string[] = [];
  for (let i = 0; i < n; i++) {
    if (!included[i]) continue;
    for (const term of dedupedTerms[i]) {
      if (!termIndex.has(term)) {
        termIndex.set(term, terms.length);
        terms.push(term);
      }
    }
  }
  const k = terms.length;

  const input = new Uint8Array(2 * n + n * k);
  const exposedOff = n;
  const eventsOff = 2 * n;
  let cohortSize = 0;
  let nDrug = 0;
  for (let i = 0; i < n; i++) {
    if (!included[i]) continue;
    cohortSize++;
    input[i] = 1;
    if (exposed[i]) {
      input[exposedOff + i] = 1;
      nDrug++;
    }
    for (const term of dedupedTerms[i]) {
      const j = termIndex.get(term);
      if (j !== undefined) input[eventsOff + i * k + j] = 1;
    }
  }
  const outOff = roundUp4(input.length);
  return {
    n,
    k,
    terms,
    input,
    outOff,
    outBytes: 4 + 16 * k,
    cohortSize,
    nDrug,
    nNoDrug: cohortSize - nDrug,
  };
}

/**
 * 读回沙箱输出并校验不变量,回填 key/rate 后按 count 降序稳定排序。
 * 任何不变量违反即抛错 → 任务失败(不回退到 TS 实现)。
 */
export function bucketsFromSandboxOutput(
  output: Uint8Array,
  projection: DisproportionalityProjection,
): SandboxBucket[] {
  const { k, terms, cohortSize, nDrug, nNoDrug, n } = projection;
  if (output.length < 4 + 16 * k) {
    throw new Error(
      `沙箱输出长度不足:${output.length} < ${4 + 16 * k}(词条数 ${k})`,
    );
  }
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const reportedCohortSize = view.getUint32(0, true);
  if (reportedCohortSize > n) {
    throw new Error(
      `沙箱输出不变量违反:cohortSize=${reportedCohortSize} > 输入行数 ${n}`,
    );
  }
  if (reportedCohortSize !== cohortSize) {
    throw new Error(
      `沙箱输出不变量违反:cohortSize=${reportedCohortSize} ≠ 入组行数 ${cohortSize}`,
    );
  }

  const buckets: SandboxBucket[] = [];
  for (let j = 0; j < k; j++) {
    const base = 4 + j * 16;
    const a = view.getUint32(base, true);
    const b = view.getUint32(base + 4, true);
    const c = view.getUint32(base + 8, true);
    const d = view.getUint32(base + 12, true);
    if (a + b !== nDrug) {
      throw new Error(
        `沙箱输出不变量违反:词条「${terms[j]}」a+b=${a + b} ≠ 入组内用药人数 ${nDrug}`,
      );
    }
    if (c + d !== nNoDrug) {
      throw new Error(
        `沙箱输出不变量违反:词条「${terms[j]}」c+d=${c + d} ≠ 入组内未用药人数 ${nNoDrug}`,
      );
    }
    buckets.push({
      key: terms[j],
      count: a,
      rate: +(a / (cohortSize || 1)).toFixed(4),
      b,
      c,
      d,
    });
  }
  // 与 TS 实现同一排序口径(Array#sort 稳定 → 并列保持首次出现顺序)。
  return buckets.sort((x, y) => y.count - x.count);
}

function roundUp4(value: number): number {
  return value + ((4 - (value % 4)) % 4);
}
