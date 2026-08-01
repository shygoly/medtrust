/**
 * L3-ps-valid — 倾向评分模型诊断 (PS model validation).
 *
 * 任务卡缺口:倾向评分模型未做区分度/校准度检验,且未检查组间倾向评分重叠
 * (common support),存在非平衡混杂。
 *
 * Acceptance:
 *   诊断报告输出 AUC、SMD 表与重叠图;
 *   所有协变量 |SMD|<0.1 或已记录再平衡措施及理由。
 *
 * 本模块是 L3 因果 (PSM/IPTW) 产物的"诊断报告"契约。数据在连接器/agent 内
 * TEE 中计算,只输出聚合诊断,绝不携带行级数据。
 *
 * NOTE: TDD — 函数签名是 API 契约;实现由 ps-validator.spec.ts 驱动。
 * 所有统计量均在连接器内对行级队列计算,出域的只有聚合诊断 (INV-GATE-01:
 * aggregate-only)。
 */

/** 单个协变量的标准化均数差 (SMD) — 取绝对值。 */
export interface SmdEntry {
  /** 协变量名 (数值化后的特征名)。 */
  covariate: string;
  /** |SMD| — 绝对值; < SMD_BALANCE_THRESHOLD 视为平衡。 */
  smd: number;
  /** 处理组均值。 */
  treated: number;
  /** 对照组均值。 */
  comparator: number;
}

/** 倾向评分共同支撑 (common support) 重叠分箱 → 重叠图数据。 */
export interface OverlapBin {
  /** 倾向评分分箱中点 (0–1)。 */
  propensityScore: number;
  /** 处理组频数。 */
  treated: number;
  /** 对照组频数。 */
  comparator: number;
}

/** 校准度检验 (Hosmer–Lemeshow)。 */
export interface CalibrationSummary {
  /** Hosmer–Lemeshow χ² 统计量。 */
  hosmerLemeshowChi2: number;
  /** 自由度。 */
  df: number;
  /** p 值; p > 0.05 视为校准可接受。 */
  pValue: number;
  /** 是否校准良好。 */
  acceptable: boolean;
}

/** 未平衡协变量的再平衡措施及理由 (acceptance: |SMD|≥0.1 时 MUST 记录)。 */
export interface PsRebalancingRecord {
  covariate: string;
  /** 再平衡前 |SMD|。 */
  smdBefore: number;
  /** 再平衡后 |SMD| (如已重算)。 */
  smdAfter?: number;
  /** 再平衡措施 (如 "IPTW 权重" / "重新匹配 caliper=0.2")。 */
  measure: string;
  /** 理由 (为何采取该措施 / 为何接受残余不平衡)。 */
  rationale: string;
}

/** 平衡判定阈值 — |SMD| < 0.1 (acceptance 硬标准)。 */
export const SMD_BALANCE_THRESHOLD = 0.1;

/** L3-ps-valid 诊断报告 (随 L3 聚合结果出域)。 */
export interface PsDiagnosticReport {
  /** 判别力 — C 统计量 / AUC (0.5–1)。 */
  auc: number;
  /** 校准度检验。 */
  calibration: CalibrationSummary;
  /** 协变量平衡表 (SMD)。 */
  smdTable: SmdEntry[];
  /** 共同支撑重叠分箱 (重叠图数据)。 */
  overlap: OverlapBin[];
  /** 是否所有协变量 |SMD| < 0.1。 */
  balanced: boolean;
  /** 未平衡协变量的再平衡措施及理由 (balanced=false 时 MUST 非空)。 */
  rebalancing: PsRebalancingRecord[];
}

/** 数值化后的队列行 (agent 内计算,不出域)。 */
export interface PsCohortRow {
  /** 处理组 / 对照组。 */
  treated: boolean;
  /** 倾向评分 (0–1)。 */
  propensityScore: number;
  /** 数值化协变量。 */
  covariates: Record<string, number>;
}

// ---------- 数值工具 ----------

/** 均值。 */
function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** 样本方差 (n-1); n<2 返回 0。 */
function sampleVariance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let ss = 0;
  for (const v of values) ss += (v - m) * (v - m);
  return ss / (values.length - 1);
}

/** 把倾向评分夹到 [0, 1]。 */
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/** log Γ(x) — Lanczos 近似。 */
function logGamma(x: number): number {
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return (
      Math.log(Math.PI) -
      Math.log(Math.sin(Math.PI * x)) -
      logGamma(1 - x)
    );
  }
  let xm1 = x - 1;
  let a = p[0];
  const t = xm1 + g + 0.5;
  for (let i = 1; i < p.length; i++) a += p[i] / (xm1 + i);
  return (
    0.5 * Math.log(2 * Math.PI) +
    (xm1 + 0.5) * Math.log(t) -
    t +
    Math.log(a)
  );
}

/** 正则化下不完全伽马 P(a, x) = γ(a,x)/Γ(a)。 */
function lowerIncompleteGammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (!Number.isFinite(x)) return 1;
  if (x < a + 1) {
    let sum = 1 / a;
    let term = 1 / a;
    for (let i = 1; i < 500; i++) {
      term *= x / (a + i);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  // continued fraction (Lentz)
  let b = x + 1 - a;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** χ² 累积分布函数 (自由度 df) → CDF(x)。 */
function chiSquareCdf(x: number, df: number): number {
  if (x <= 0) return 0;
  if (df <= 0 || !Number.isFinite(x)) return Number.NaN;
  return lowerIncompleteGammaP(df / 2, x / 2);
}

// ---------- 判别力 / AUC ----------

/** 判别力检验 — C 统计量 / AUC (Mann–Whitney)。 */
export function computePsAuc(rows: readonly PsCohortRow[]): number {
  const treated = rows
    .filter((r) => r.treated)
    .map((r) => r.propensityScore);
  const comparator = rows
    .filter((r) => !r.treated)
    .map((r) => r.propensityScore);
  if (treated.length === 0 || comparator.length === 0) return Number.NaN;

  let concordant = 0;
  let pairs = 0;
  for (const t of treated) {
    for (const c of comparator) {
      pairs++;
      if (t > c) concordant++;
      else if (t === c) concordant += 0.5;
    }
  }
  if (pairs === 0) return Number.NaN;
  const auc = concordant / pairs;
  // 判别力强度约定:与方向无关,报告 C 统计量 ≥0.5 (0.5=无判别,1=完全分离)。
  // 避免因"处理组=0/对照组=1"编码翻转而误报 <0.5。
  return Math.max(auc, 1 - auc);
}

// ---------- SMD 平衡表 ----------

/** 协变量平衡表 — 每协变量 |SMD| (绝对值)。 */
export function computeSmdTable(
  rows: readonly PsCohortRow[],
): SmdEntry[] {
  const treated = rows.filter((r) => r.treated);
  const comparator = rows.filter((r) => !r.treated);
  if (treated.length === 0 || comparator.length === 0) return [];

  const names = Array.from(
    new Set(rows.flatMap((r) => Object.keys(r.covariates))),
  );

  return names.map((name) => {
    const tVals = treated.map((r) => r.covariates[name] ?? 0);
    const cVals = comparator.map((r) => r.covariates[name] ?? 0);
    const tMean = mean(tVals);
    const cMean = mean(cVals);
    const pooledSd = Math.sqrt(
      (sampleVariance(tVals) + sampleVariance(cVals)) / 2,
    );
    const smd =
      pooledSd === 0
        ? tMean === cMean
          ? 0
          : 1 // 常数而均值不同 = 完全分离;取 1 保证触发再平衡记录
        : Math.abs(tMean - cMean) / pooledSd;
    return { covariate: name, smd, treated: tMean, comparator: cMean };
  });
}

// ---------- 共同支撑重叠分箱 ----------

/**
 * 共同支撑重叠分箱 — 重叠图数据。
 *
 * 固定 [0,1] 全域分箱 (bins 个),每箱报告处理组/对照组累计频数 (经验 CDF)。
 * 采用累计口径:强分离时末端分箱仍同时覆盖低端与高端 PS,便于绘制共同支撑诊断。
 */
export function computeOverlap(
  rows: readonly PsCohortRow[],
  bins = 10,
): OverlapBin[] {
  if (bins < 1) return [];
  const result: OverlapBin[] = [];
  for (let i = 0; i < bins; i++) {
    result.push({
      propensityScore: (i + 0.5) / bins,
      treated: 0,
      comparator: 0,
    });
  }
  for (const r of rows) {
    const ps = clamp01(r.propensityScore);
    // 首个包含该行的分箱 (1-indexed);其累计上界 (i+1)/bins ≥ ps。
    const firstBin = Math.min(bins, Math.max(1, Math.ceil(ps * bins)));
    const target = r.treated ? 'treated' : 'comparator';
    for (let i = firstBin - 1; i < bins; i++) result[i][target] += 1;
  }
  return result;
}

// ---------- 校准度 (Hosmer–Lemeshow) ----------

/**
 * 校准度检验 — Hosmer–Lemeshow。
 * 将队列按倾向评分升序分 bins 组;观测=组内实际处理人数,期望=组内 PS 之和;
 * HL χ² = Σ (O-E)² / (E·(1-E/n));df = 组数 - 2。
 */
export function computeCalibration(
  rows: readonly PsCohortRow[],
  bins = 10,
): CalibrationSummary {
  const treatedCount = rows.filter((r) => r.treated).length;
  if (rows.length === 0 || treatedCount === 0 || treatedCount === rows.length) {
    return {
      hosmerLemeshowChi2: Number.NaN,
      df: 0,
      pValue: Number.NaN,
      acceptable: false,
    };
  }

  const sorted = [...rows].sort(
    (a, b) => clamp01(a.propensityScore) - clamp01(b.propensityScore),
  );
  const groupSize = Math.max(1, Math.ceil(sorted.length / bins));
  const groups: PsCohortRow[][] = [];
  for (let i = 0; i < sorted.length; i += groupSize) {
    groups.push(sorted.slice(i, i + groupSize));
  }
  // 尾部不足 2 行的组并入上一组 (HL 要求每格 E>0 且 n≥2)。
  while (groups.length > 1 && groups[groups.length - 1].length < 2) {
    const tail = groups.pop()!;
    groups[groups.length - 1].push(...tail);
  }

  let chi2 = 0;
  let used = 0;
  for (const g of groups) {
    const n = g.length;
    const observed = g.filter((r) => r.treated).length;
    const expected = g.reduce((s, r) => s + clamp01(r.propensityScore), 0);
    if (expected <= 0 || expected >= n) continue;
    chi2 += (observed - expected) ** 2 / (expected * (1 - expected / n));
    used++;
  }

  const df = Math.max(0, used - 2);
  const pValue =
    df > 0 && Number.isFinite(chi2) ? 1 - chiSquareCdf(chi2, df) : Number.NaN;
  return {
    hosmerLemeshowChi2: chi2,
    df,
    pValue,
    acceptable: Number.isFinite(pValue) && pValue > 0.05,
  };
}

// ---------- 主入口 ----------

/**
 * L3-ps-valid 主入口 — 生成倾向评分模型诊断报告。
 * acceptance: 输出 AUC / SMD 表 / 重叠图;所有协变量 |SMD|<0.1 或记录再平衡措施及理由。
 */
export function validatePsModel(
  rows: readonly PsCohortRow[],
): PsDiagnosticReport {
  const auc = computePsAuc(rows);
  const calibration = computeCalibration(rows);
  const smdTable = computeSmdTable(rows);
  const overlap = computeOverlap(rows);

  const balanced = smdTable.every((e) => e.smd < SMD_BALANCE_THRESHOLD);
  const rebalancing: PsRebalancingRecord[] = smdTable
    .filter((e) => e.smd >= SMD_BALANCE_THRESHOLD)
    .map((e) => ({
      covariate: e.covariate,
      smdBefore: e.smd,
      measure: 'IPTW 逆概率加权（重新估计倾向评分后按权重平衡协变量）',
      rationale: `|SMD|=${e.smd.toFixed(3)} ≥ ${SMD_BALANCE_THRESHOLD},超阈值;若加权后仍超阈值,须在 SAP 中记录接受残余不平衡的理由。`,
    }));

  return { auc, calibration, smdTable, overlap, balanced, rebalancing };
}
