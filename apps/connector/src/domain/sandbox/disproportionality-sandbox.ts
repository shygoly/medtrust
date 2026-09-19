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
 * 最小列投影。`isIncluded` 对应 TTE 纳入/排除(缺省全部入组);
 * 未入组行的 exposed/事件位一律写 0 —— 模块本身也会跳过未入组行。
 */
export function projectDisproportionality(
  rows: readonly InternalRecord[],
  drug: string | undefined,
  isIncluded: (row: InternalRecord) => boolean = () => true,
): DisproportionalityProjection {
  if (!drug) {
    throw new Error('disproportionality 需指定 drug of interest');
  }
  const n = rows.length;
  const onDrug = rows.map((r) => matchesMedication(r.medications, drug));
  const included = rows.map((r) => isIncluded(r));

  // 词条集合只来自入组行 —— 与 TS 实现在过滤后的队列上收集 Set 一致。
  const termIndex = new Map<string, number>();
  const terms: string[] = [];
  for (let i = 0; i < n; i++) {
    if (!included[i]) continue;
    for (const e of rows[i].adverseEvents) {
      if (!termIndex.has(e.term)) {
        termIndex.set(e.term, terms.length);
        terms.push(e.term);
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
    if (onDrug[i]) {
      input[exposedOff + i] = 1;
      nDrug++;
    }
    for (const e of rows[i].adverseEvents) {
      const j = termIndex.get(e.term);
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
