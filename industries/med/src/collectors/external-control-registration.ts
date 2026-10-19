// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 注册型外部对照的 C3 收集。
 *
 * 试验与对照只在单一可信空间节点内对齐、加权和估计；平台不得把多个节点的
 * 匹配/加权结果相加。这里再次做类型与单一来源校验，避免计划配置错误把不同
 * estimand 或不同分析总体拼在一起。
 */
export interface ExternalControlRegistrationAggregate {
  analysisType: "external-control-registration";
  synthetic: boolean;
  estimand: "ATT" | "ATE";
  estimator: "IPTW-ATT" | "IPTW-ATE";
  cohort: {
    trialN: number;
    controlPoolN: number;
    analysisTrialN: number;
    analysisControlN: number;
  };
  effect: {
    measure: "risk-difference" | "risk-ratio";
    estimate: number;
    ciLow: number;
    ciHigh: number;
  };
  balance: Array<{
    covariate: string;
    smdBefore: number;
    smdAfter: number;
  }>;
  overlap: Record<string, number>;
  weights: Record<string, number>;
  missingness: {
    mode: "MCAR" | "MAR" | "MNAR";
    missingFraction: number;
    imputedN: number;
  };
  censoring: {
    observedN: number;
    censoredN: number;
    competingRiskN: number;
  };
  sensitivity: Array<Record<string, unknown>>;
  truthComparison?: Record<string, unknown>;
  study: {
    profileVersion: string;
    timeZero: string;
    estimandSapVersion: string;
  };
  [key: string]: unknown;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeCount(value: unknown): value is number {
  return finite(value) && Number.isInteger(value) && value >= 0;
}

function assertShape(
  aggregate: ExternalControlRegistrationAggregate,
  node: string,
): void {
  if (aggregate.analysisType !== "external-control-registration")
    throw new Error(
      `收集阶段只接受 external-control-registration（节点 ${node} 交来 ${String((aggregate as { analysisType?: unknown }).analysisType)}）`,
    );
  if (typeof aggregate.synthetic !== "boolean")
    throw new Error(`节点 ${node} 的注册型结果缺 synthetic 边界标记`);
  if (
    !["ATT", "ATE"].includes(aggregate.estimand) ||
    !["IPTW-ATT", "IPTW-ATE"].includes(aggregate.estimator)
  )
    throw new Error(`节点 ${node} 的注册型结果缺合法 estimand/estimator`);
  if (aggregate.estimand === "ATT" && aggregate.estimator !== "IPTW-ATT")
    throw new Error(`节点 ${node} 的 ATT 必须与 IPTW-ATT 估计器绑定`);
  if (aggregate.estimand === "ATE" && aggregate.estimator !== "IPTW-ATE")
    throw new Error(`节点 ${node} 的 ATE 必须与 IPTW-ATE 估计器绑定`);

  const cohort = aggregate.cohort;
  if (
    !cohort ||
    ![
      cohort.trialN,
      cohort.controlPoolN,
      cohort.analysisTrialN,
      cohort.analysisControlN,
    ].every(nonNegativeCount)
  )
    throw new Error(`节点 ${node} 的注册型队列计数非法`);
  if (
    cohort.analysisTrialN > cohort.trialN ||
    cohort.analysisControlN > cohort.controlPoolN
  )
    throw new Error(`节点 ${node} 的分析队列超过源队列`);

  const effect = aggregate.effect;
  if (
    !effect ||
    !["risk-difference", "risk-ratio"].includes(effect.measure) ||
    ![effect.estimate, effect.ciLow, effect.ciHigh].every(finite) ||
    effect.ciLow > effect.estimate ||
    effect.estimate > effect.ciHigh
  )
    throw new Error(`节点 ${node} 的注册型主效应或区间非法`);

  if (!Array.isArray(aggregate.balance))
    throw new Error(`节点 ${node} 的注册型结果缺平衡诊断`);
  for (const row of aggregate.balance) {
    if (
      typeof row.covariate !== "string" ||
      row.covariate.trim().length === 0 ||
      !finite(row.smdBefore) ||
      !finite(row.smdAfter)
    )
      throw new Error(`节点 ${node} 的注册型平衡诊断形状非法`);
  }

  if (
    !aggregate.overlap ||
    ![
      aggregate.overlap.minPropensity,
      aggregate.overlap.maxPropensity,
      aggregate.overlap.trimmed,
      aggregate.overlap.eesTrial,
      aggregate.overlap.eesControl,
    ].every(finite)
  )
    throw new Error(`节点 ${node} 的注册型 overlap 诊断非法`);
  if (
    !aggregate.weights ||
    ![
      aggregate.weights.maxWeight,
      aggregate.weights.p99Weight,
      aggregate.weights.truncatedFraction,
      aggregate.weights.effectiveSampleSize,
    ].every(finite)
  )
    throw new Error(`节点 ${node} 的注册型权重诊断非法`);

  if (
    !aggregate.missingness ||
    !["MCAR", "MAR", "MNAR"].includes(aggregate.missingness.mode) ||
    !finite(aggregate.missingness.missingFraction) ||
    aggregate.missingness.missingFraction < 0 ||
    aggregate.missingness.missingFraction > 1 ||
    !nonNegativeCount(aggregate.missingness.imputedN)
  )
    throw new Error(`节点 ${node} 的注册型缺失诊断非法`);

  if (
    !aggregate.censoring ||
    ![
      aggregate.censoring.observedN,
      aggregate.censoring.censoredN,
      aggregate.censoring.competingRiskN,
    ].every(nonNegativeCount)
  )
    throw new Error(`节点 ${node} 的注册型删失诊断非法`);

  if (!Array.isArray(aggregate.sensitivity))
    throw new Error(`节点 ${node} 的注册型结果缺敏感性分析清单`);
  if (aggregate.synthetic && !aggregate.truthComparison)
    throw new Error(`节点 ${node} 的合成数据结果缺答案键真值对照`);
  if (
    !aggregate.study ||
    !aggregate.study.profileVersion?.trim() ||
    !aggregate.study.timeZero?.trim() ||
    !aggregate.study.estimandSapVersion?.trim()
  )
    throw new Error(`节点 ${node} 的注册型结果缺研究 profile/SAP 冻结信息`);
}

export function collectExternalControlRegistration(input: {
  tables: Array<{
    node: string;
    aggregate: ExternalControlRegistrationAggregate;
  }>;
}): ExternalControlRegistrationAggregate {
  if (input.tables.length === 0) throw new Error("收集阶段没有任何输入表");
  for (const table of input.tables) assertShape(table.aggregate, table.node);
  if (input.tables.length > 1)
    throw new Error(
      "注册型外部对照的试验、对照、加权和估计在同一可信节点内完成；多节点结果不可相加，拒绝收集",
    );
  return structuredClone(input.tables[0]!.aggregate);
}
