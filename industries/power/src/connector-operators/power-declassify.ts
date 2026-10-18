// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 电力 `declassify.small_cell` 链环：认领三张电力 C0 节点表，出 C3（可交付平台）。
 *
 * 出域口径（TRUST：表计级明细是 raw-local，不得跨域）：
 * - 负荷预测 / 需求响应：逐表计结果**在节点内聚合到节点级**，不带任何表计标识；
 *   可选 Laplace DP 作用在**数值聚合量**上（负荷剖面 / 峰谷可调容量向量），敏感度=单块表的最大贡献；
 * - 窃电检测：只放行 ≥ 阈值的表计（至多 topK 块），表计标识换成**键控假名**
 *   （同一合约 scope 下各节点同一密钥，跨区域可关联；平台不持密钥、无从反查），
 *   证据区间泛化到日级；
 * - 小单元闸对**放行的对象**生效，不只对输入：负荷/需求按表计数、窃电按**放行的个体记录条数**
 *   （不足 minCell 即整表抑制，载荷与「零命中」不可区分）；
 * - DP 的适用面如实标注：数值聚合向量（负荷剖面 / 峰谷容量）可选加噪；窃电的个体列表在
 *   minCell 闸与假名化之后**不再有有意义的 DP 目标**（放行条数已由闸门决定），故不假装加噪。
 */

import type { StageExecutor, StageInput } from "@medtrust/mdop";
import {
  POWER_ANOMALY_ANALYSIS_TYPE,
  POWER_ANOMALY_TYPES,
  POWER_DR_POTENTIAL_ANALYSIS_TYPE,
  POWER_FEATURES_ANALYSIS_TYPE,
} from "@medtrust/wasm-algorithms";

import { drUserTypeDefaults, type HourTriple } from "../analysis/dr-potential";
import type { AnomalyDetectionResult, AnomalyType } from "../analysis/anomaly-detection";
import { LOAD_FORECAST_ANALYSIS_TYPE } from "../collectors/load-forecast-collector";
import { DEMAND_RESPONSE_ANALYSIS_TYPE } from "../collectors/demand-response-collector";
import { THEFT_DETECTION_ANALYSIS_TYPE } from "../collectors/theft-detection-collector";
import { applyLaplaceDp, type PowerPrivacyScenario } from "../privacy/dp";
import { enforcePowerEgress } from "../privacy/egress-gate";
import { DEFAULT_K } from "../privacy/k-anon";
import type {
  PowerAnomalyTable,
  PowerDrPotentialTable,
  PowerFeaturesTable,
  PowerOperatorDeps,
  PowerOperatorLogger,
} from "./register-power-ops";

export const POWER_DECLASSIFY_OP = "declassify.small_cell@1.0.0";

type PowerTable = PowerFeaturesTable | PowerDrPotentialTable | PowerAnomalyTable;

const CLAIMED = new Set<string>([
  POWER_FEATURES_ANALYSIS_TYPE,
  POWER_DR_POTENTIAL_ANALYSIS_TYPE,
  POWER_ANOMALY_ANALYSIS_TYPE,
]);

interface ReleasePolicy {
  readonly minCell: number;
  readonly k: number;
  readonly dpEpsilon?: number;
  readonly contractId: string;
}

function policyOf(input: StageInput): ReleasePolicy {
  const contractMinCell = Number(
    (input.contractTerms as { publication?: { minCell?: number } } | undefined)?.publication?.minCell ?? 0,
  );
  const paramMinCell = Number(input.stage.params.minCell ?? 0);
  // 编译期已校验「参数不得弱于合约」；这里再取一次严（纵深防御）
  const minCell = Math.max(contractMinCell, paramMinCell);
  if (!(minCell > 0)) throw new Error("declassify.small_cell 需要合约或参数给出 minCell");
  const k = input.stage.params.k === undefined ? DEFAULT_K : Number(input.stage.params.k);
  if (!Number.isInteger(k) || k < 2) throw new Error("k-匿名参数 k 须为 ≥ 2 的整数");
  const contractId = String(input.stage.params.contractId ?? "");
  if (!contractId) throw new Error("declassify.small_cell 需要参数 contractId（假名 scope 与审计都依赖它）");
  const eps = input.stage.params.dpEpsilon;
  return {
    minCell,
    k,
    contractId,
    ...(eps !== undefined && eps !== null ? { dpEpsilon: Number(eps) } : {}),
  };
}

function gateMeters(nMeters: number, policy: ReleasePolicy, scenario: PowerPrivacyScenario): void {
  enforcePowerEgress({ nSamples: nMeters }, { scenario, minCell: policy.minCell, k: policy.k });
}

/** 和向量加噪：敏感度 = 单块表对该和的最大贡献（去掉一块表，和至多变这么多）。 */
function dpSum(
  values: readonly number[],
  sensitivity: number,
  policy: ReleasePolicy,
  scenario: PowerPrivacyScenario,
  seed: string,
): number[] {
  if (policy.dpEpsilon === undefined) return [...values];
  if (!(sensitivity > 0)) return [...values];
  return applyLaplaceDp(values, scenario, policy.dpEpsilon, seed, sensitivity).values.map((v) => Math.max(0, v));
}

const sum = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);

function declassifyFeatures(
  table: PowerFeaturesTable,
  policy: ReleasePolicy,
  seed: string,
): Record<string, unknown> {
  const meters = table.meters;
  gateMeters(meters.length, policy, "load-forecast");
  const unitKw = table.unitW / 1000;
  const N = sum(meters.map((m) => m.n));
  const mean = sum(meters.map((m) => m.n * m.mean)) / N;
  // 合并方差：组内 + 组间
  const variance = sum(meters.map((m) => m.n * (m.std * m.std + (m.mean - mean) ** 2))) / N;
  const trend = sum(meters.map((m) => m.n * m.trendMilli)) / N / 1000;
  const profileUnits = Array.from({ length: table.period }, (_, h) => sum(meters.map((m) => m.phaseMeans[h] ?? 0)));
  const sensitivity = Math.max(...meters.map((m) => m.max)) * unitKw;
  const loadProfileKw = dpSum(
    profileUnits.map((v) => v * unitKw),
    sensitivity,
    policy,
    "load-forecast",
    seed,
  );
  const perMeterProfile = loadProfileKw.map((v) => v / meters.length);
  const windowStart = meters.map((m) => m.windowStart).sort()[0]!;
  const windowEnd = meters.map((m) => m.windowEnd).sort()[meters.length - 1]!;
  const day = new Date(windowStart).getUTCDay();
  return {
    analysisType: LOAD_FORECAST_ANALYSIS_TYPE,
    entityId: "node-aggregate",
    windowStart,
    windowEnd,
    mean: mean * unitKw,
    std: Math.sqrt(variance) * unitKw,
    max: Math.max(...meters.map((m) => m.max)) * unitKw,
    min: Math.min(...meters.map((m) => m.min)) * unitKw,
    hourOfDay: 0,
    dayOfWeek: day,
    isWeekend: day === 0 || day === 6,
    trend: trend * unitKw,
    seasonality: Math.max(...perMeterProfile) - Math.min(...perMeterProfile),
    nSamples: N,
    nMeters: meters.length,
    excludedMeters: table.excludedMeters,
    loadProfileKw,
    ...(policy.dpEpsilon !== undefined ? { dpEpsilon: policy.dpEpsilon } : {}),
  };
}

function declassifyDr(
  table: PowerDrPotentialTable,
  policy: ReleasePolicy,
  node: string,
  seed: string,
): Record<string, unknown> {
  const meters = table.meters;
  gateMeters(meters.length, policy, "demand-response");
  const unitKw = table.unitW / 1000;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const baselineCurve = hours.map((h) => sum(meters.map((m) => m.baseline[h]!)) * unitKw);
  const peakSens = Math.max(...meters.map((m) => Math.max(...m.peakCap))) * unitKw;
  const valleySens = Math.max(...meters.map((m) => Math.max(...m.valleyCap))) * unitKw;
  const peak = dpSum(
    hours.map((h) => sum(meters.map((m) => m.peakCap[h]!)) * unitKw),
    peakSens,
    policy,
    "demand-response",
    `${seed}:peak`,
  );
  const valley = dpSum(
    hours.map((h) => sum(meters.map((m) => m.valleyCap[h]!)) * unitKw),
    valleySens,
    policy,
    "demand-response",
    `${seed}:valley`,
  );
  const d = drUserTypeDefaults(table.userType);
  const zero = sum(peak) === 0 && sum(valley) === 0;
  const peakReduction: HourTriple[] = zero ? [] : hours.map((h) => [h, peak[h]!, d.curtailCost] as const);
  const valleyShift: HourTriple[] = zero ? [] : hours.map((h) => [h, valley[h]!, d.shiftWillingness] as const);
  return {
    analysisType: DEMAND_RESPONSE_ANALYSIS_TYPE,
    // 参与方（聚合商 / 供电所）本身就是合约主体，不是自然人
    entityId: node,
    nMeters: meters.length,
    excludedMeters: table.excludedMeters,
    fullLoadMeters: meters.filter((m) => m.fullLoad).length,
    baselineCurve,
    peakReduction,
    valleyShift,
    constraints: {},
    ...(policy.dpEpsilon !== undefined ? { dpEpsilon: policy.dpEpsilon } : {}),
  };
}

function declassifyAnomaly(
  table: PowerAnomalyTable,
  policy: ReleasePolicy,
  input: StageInput,
  deps: PowerOperatorDeps,
  logger: PowerOperatorLogger,
): Record<string, unknown> {
  const meters = table.meters;
  gateMeters(meters.length, policy, "theft-detection");
  const threshold = Number(input.stage.params.anomalyThreshold ?? table.anomalyThreshold ?? 0);
  if (!(threshold >= 0 && threshold <= 1)) throw new Error("异常阈值应在 0-1 之间");
  const topK = input.stage.params.topK === undefined ? meters.length : Number(input.stage.params.topK);
  if (!Number.isInteger(topK) || topK <= 0) throw new Error("topK 必须为正整数");
  const candidates = meters
    .filter((m) => m.scorePermille / 1000 >= threshold && m.type > 0 && m.type < 6)
    .sort((a, b) => b.scorePermille - a.scorePermille)
    .slice(0, topK);
  // 小单元闸（spec: 输出用户数 ≥ minCell；ACCEPTANCE 3.3「所有输出满足 k ≥ 5」）：
  // 上一步 gateMeters 卡的是**输入表计数**，这里放行的却是**个体级记录**——条数本身就是小单元。
  // 命中不足 minCell 时整表抑制：载荷与「一块没命中」逐字节相同，平台无法把 0 与 1..minCell-1 区分开。
  // 真实命中数只写节点本地日志（节点自己可审计），不进载荷。
  const releasable = candidates.length >= policy.minCell ? candidates : [];
  if (releasable.length < candidates.length) {
    logger.warn(
      `窃电出域抑制：命中 ${candidates.length} 块 < minCell=${policy.minCell}，个体列表不出域（平台只看到空表；本地日志留真值）`,
    );
  }
  const scope = `contract:${policy.contractId}`;
  const results: AnomalyDetectionResult[] = releasable.map((m) => ({
    entityId: deps.pseudonymize(m.entityId, scope),
    anomalyScore: m.scorePermille / 1000,
    anomalyType: POWER_ANOMALY_TYPES[m.type] as AnomalyType,
    detectionMethod: m.method === 1 ? "isolation_forest" : "rule_ensemble",
    confidence: m.confidencePermille / 1000,
    evidencePeriod: [Math.floor(m.evidence[0] / 24) * 24, Math.ceil(m.evidence[1] / 24) * 24] as const,
  }));
  return {
    analysisType: THEFT_DETECTION_ANALYSIS_TYPE,
    nMeters: meters.length,
    excludedMeters: table.excludedMeters,
    results,
  };
}

export function registerPowerDeclassifyOperator(
  executor: StageExecutor,
  deps: PowerOperatorDeps,
  logger: PowerOperatorLogger,
): void {
  executor.appendSystemHandler(POWER_DECLASSIFY_OP, async (input) => {
    const table = [...input.inputs.values()][0] as unknown as PowerTable | undefined;
    if (!table || !CLAIMED.has(String((table as { analysisType?: unknown }).analysisType))) return undefined;
    if (!Array.isArray(table.meters) || table.meters.length === 0) {
      throw new Error("电力降密：上游节点表没有任何表计");
    }
    const policy = policyOf(input);
    // 噪声种子必须带节点密钥：公开种子的「确定性噪声」平台可以算出来减掉
    const seed = deps.pseudonymize(`dp:${input.jobId}:${input.stage.id}`, "dp-seed");
    const released =
      table.analysisType === POWER_FEATURES_ANALYSIS_TYPE
        ? declassifyFeatures(table, policy, seed)
        : table.analysisType === POWER_DR_POTENTIAL_ANALYSIS_TYPE
          ? declassifyDr(table, policy, input.stage.node, seed)
          : declassifyAnomaly(table, policy, input, deps, logger);
    logger.log(
      `declassify.small_cell 电力 ${table.analysisType} → ${String(released.analysisType)} meters=${table.meters.length} minCell=${policy.minCell} k=${policy.k}`,
    );
    return { label: "C3", schema: "mdop.table/1.0", payload: released };
  });
}
