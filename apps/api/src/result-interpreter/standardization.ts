/**
 * 直接标准化率（跨院去重发病率，change `cross-hospital-dedup-incidence` tasks 5.3）。
 *
 * 三条口径（任务原文）：
 *  1. 按**标准人口权重**对分层率做加权平均（直接标准化法）；
 *  2. 权重是**部署参数** —— 由平台侧配置注入；
 *  3. 权重 **MUST NOT 进节点** —— 这里只在平台侧（结果解释器）消费；节点侧代码不 import 本模块的调用方配置。
 *
 * 为什么单独成纯函数：加权平均 + 「哪些层被排除」的记账都必须是可复核的确定计算，
 * 而不是让模型去算（见 `intel-tdx-xeon-showcase` design S3 的实测教训）。
 */

export interface StandardizableCell {
  key: string;
  /** 去重后事件数（未抑制层）。 */
  events: number;
  /** 观察期并集人日数（未抑制层）。 */
  personDays: number;
}

export interface StandardizedRate {
  ratePer100k: number;
  /** 参与加权的层（权重大于 0 且率可算）。 */
  includedKeys: string[];
  /** 被排除的层及原因（无权重 / 人日为零 / 权重为 0）。 */
  excluded: Array<{ key: string; reason: "no-weight" | "zero-person-days" | "zero-weight" }>;
  /** 参与加权的权重占比合计（1 = 全部权重都落到了可算的层上）。 */
  coverage: number;
}

/**
 * 直接标准化：`Σ w_k*r_k / Σ w_k`（只对「有权重且率可算」的层求和）。
 * 返回 `null` 表示**没有任何层可参与**（无权重的配置错误或全被排除）—— 不得静默返回 0。
 */
export function directStandardizedRatePer100k(
  cells: readonly StandardizableCell[],
  weights: Readonly<Record<string, number>>,
): StandardizedRate | null {
  const excluded: StandardizedRate["excluded"] = [];
  const included: Array<{ key: string; rate: number; w: number }> = [];
  for (const c of cells) {
    const w = weights[c.key];
    if (w === undefined) {
      excluded.push({ key: c.key, reason: "no-weight" });
      continue;
    }
    if (!(w > 0)) {
      excluded.push({ key: c.key, reason: "zero-weight" });
      continue;
    }
    if (!(c.personDays > 0)) {
      excluded.push({ key: c.key, reason: "zero-person-days" });
      continue;
    }
    included.push({
      key: c.key,
      rate: (c.events / (c.personDays / 365.25)) * 100_000,
      w,
    });
  }
  if (included.length === 0) return null;
  const totalW = Object.values(weights).reduce((s, w) => s + (w > 0 ? w : 0), 0);
  const usedW = included.reduce((s, x) => s + x.w, 0);
  const rate = included.reduce((s, x) => s + x.rate * x.w, 0) / usedW;
  return {
    ratePer100k: rate,
    includedKeys: included.map((x) => x.key),
    excluded,
    coverage: totalW > 0 ? usedW / totalW : 0,
  };
}

/** 从部署参数（JSON 字符串）解析标准人口权重；非法输入一律拒绝（不静默用空表）。 */
export function parseStandardWeights(raw: string | undefined): Record<string, number> | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("DEDUP_STANDARD_WEIGHTS 不是合法 JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("DEDUP_STANDARD_WEIGHTS 必须是 { 分层键: 权重 } 对象");
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
      throw new Error(`DEDUP_STANDARD_WEIGHTS.${k} 必须是非负有限数`);
    out[k] = v;
  }
  return out;
}
