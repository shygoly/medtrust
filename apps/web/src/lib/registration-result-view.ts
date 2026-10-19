export interface RegistrationBalanceRow {
  covariate: string;
  smdBefore: number;
  smdAfter: number;
}

export interface RegistrationSensitivityRow {
  id: string;
  estimate: number;
  ciLow: number;
  ciHigh: number;
  direction: string;
}

export interface RegistrationResultView {
  synthetic: boolean;
  estimand: string;
  estimator: string;
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
  balance: RegistrationBalanceRow[];
  overlap: {
    minPropensity: number;
    maxPropensity: number;
    trimmed: number;
    eesTrial: number;
    eesControl: number;
  } | null;
  weights: {
    maxWeight: number;
    p99Weight: number;
    truncatedFraction: number;
    effectiveSampleSize: number;
  } | null;
  missingness: {
    mode: "MCAR" | "MAR" | "MNAR";
    missingFraction: number;
    imputedN: number;
  } | null;
  censoring: {
    observedN: number;
    censoredN: number;
    competingRiskN: number;
  } | null;
  sensitivity: RegistrationSensitivityRow[];
  truthComparison: {
    rrTrue: number;
    rrEstimated: number;
    absoluteError: number;
    withinExpectedRange: boolean;
  } | null;
  study: {
    profileVersion: string;
    timeZero: string;
    estimandSapVersion: string;
  } | null;
  problems: string[];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * 注册型外部对照 C3 的只读视图。
 *
 * 这里不是发布闸门；节点仍未通过审查的明细不会进入平台。解析器只决定界面能展示什么，
 * 缺失或矛盾的诊断项会显式进入 `problems`，不会用零值或“通过”冒充。
 */
export function registrationResultView(value: unknown): RegistrationResultView | null {
  const root = record(value);
  if (!root || root.analysisType !== "external-control-registration") return null;

  const cohort = record(root.cohort);
  const effect = record(root.effect);
  const trialN = finite(cohort?.trialN);
  const controlPoolN = finite(cohort?.controlPoolN);
  const analysisTrialN = finite(cohort?.analysisTrialN);
  const analysisControlN = finite(cohort?.analysisControlN);
  const estimate = finite(effect?.estimate);
  const ciLow = finite(effect?.ciLow);
  const ciHigh = finite(effect?.ciHigh);
  const measure = effect?.measure;
  if (
    trialN === null ||
    controlPoolN === null ||
    analysisTrialN === null ||
    analysisControlN === null ||
    estimate === null ||
    ciLow === null ||
    ciHigh === null ||
    (measure !== "risk-difference" && measure !== "risk-ratio") ||
    typeof root.synthetic !== "boolean"
  ) {
    return null;
  }

  const problems: string[] = [];
  const balance: RegistrationBalanceRow[] = [];
  if (Array.isArray(root.balance)) {
    for (const raw of root.balance) {
      const row = record(raw);
      const covariate = text(row?.covariate);
      const smdBefore = finite(row?.smdBefore);
      const smdAfter = finite(row?.smdAfter);
      if (!covariate || smdBefore === null || smdAfter === null) {
        problems.push("平衡诊断中有形状非法的行，已从展示中剔除");
        continue;
      }
      balance.push({ covariate, smdBefore, smdAfter });
    }
  } else {
    problems.push("缺少平衡诊断（SMD）");
  }

  const overlapRaw = record(root.overlap);
  const overlap = {
    minPropensity: finite(overlapRaw?.minPropensity),
    maxPropensity: finite(overlapRaw?.maxPropensity),
    trimmed: finite(overlapRaw?.trimmed),
    eesTrial: finite(overlapRaw?.eesTrial),
    eesControl: finite(overlapRaw?.eesControl),
  };
  const hasOverlap = Object.values(overlap).every((v) => v !== null);

  const weightsRaw = record(root.weights);
  const weights = {
    maxWeight: finite(weightsRaw?.maxWeight),
    p99Weight: finite(weightsRaw?.p99Weight),
    truncatedFraction: finite(weightsRaw?.truncatedFraction),
    effectiveSampleSize: finite(weightsRaw?.effectiveSampleSize),
  };
  const hasWeights = Object.values(weights).every((v) => v !== null);

  const missingRaw = record(root.missingness);
  const missing = {
    mode: missingRaw?.mode,
    missingFraction: finite(missingRaw?.missingFraction),
    imputedN: finite(missingRaw?.imputedN),
  };
  const hasMissing =
    (missing.mode === "MCAR" || missing.mode === "MAR" || missing.mode === "MNAR") &&
    missing.missingFraction !== null &&
    missing.imputedN !== null;

  const censoringRaw = record(root.censoring);
  const censoring = {
    observedN: finite(censoringRaw?.observedN),
    censoredN: finite(censoringRaw?.censoredN),
    competingRiskN: finite(censoringRaw?.competingRiskN),
  };
  const hasCensoring = Object.values(censoring).every((v) => v !== null);

  if (!hasOverlap) problems.push("缺少完整 overlap 诊断");
  if (!hasWeights) problems.push("缺少完整权重诊断");
  if (!hasMissing) problems.push("缺少缺失机制与插补诊断");
  if (!hasCensoring) problems.push("缺少删失/竞争风险诊断");

  const sensitivity: RegistrationSensitivityRow[] = [];
  if (Array.isArray(root.sensitivity)) {
    for (const raw of root.sensitivity) {
      const row = record(raw);
      const id = text(row?.id);
      const rowEstimate = finite(row?.estimate);
      const rowLow = finite(row?.ciLow);
      const rowHigh = finite(row?.ciHigh);
      const direction = text(row?.direction);
      if (
        !id ||
        rowEstimate === null ||
        rowLow === null ||
        rowHigh === null ||
        !direction
      ) {
        problems.push("敏感性分析中有形状非法的行，已从展示中剔除");
        continue;
      }
      sensitivity.push({
        id,
        estimate: rowEstimate,
        ciLow: rowLow,
        ciHigh: rowHigh,
        direction,
      });
    }
  } else {
    problems.push("缺少敏感性分析结果");
  }

  const truthRaw = record(root.truthComparison);
  const truth = {
    rrTrue: finite(truthRaw?.rrTrue),
    rrEstimated: finite(truthRaw?.rrEstimated),
    absoluteError: finite(truthRaw?.absoluteError),
    withinExpectedRange:
      typeof truthRaw?.withinExpectedRange === "boolean"
        ? truthRaw.withinExpectedRange
        : null,
  };
  const truthComparison =
    truth.rrTrue !== null &&
    truth.rrEstimated !== null &&
    truth.absoluteError !== null &&
    truth.withinExpectedRange !== null
      ? {
          rrTrue: truth.rrTrue,
          rrEstimated: truth.rrEstimated,
          absoluteError: truth.absoluteError,
          withinExpectedRange: truth.withinExpectedRange,
        }
      : null;
  if (root.synthetic === true && !truthComparison)
    problems.push("合成数据演练缺少答案键真值对照");

  const studyRaw = record(root.study);
  const study = {
    profileVersion: text(studyRaw?.profileVersion),
    timeZero: text(studyRaw?.timeZero),
    estimandSapVersion: text(studyRaw?.estimandSapVersion),
  };
  const studyView =
    study.profileVersion && study.timeZero && study.estimandSapVersion
      ? {
          profileVersion: study.profileVersion,
          timeZero: study.timeZero,
          estimandSapVersion: study.estimandSapVersion,
        }
      : null;
  if (!studyView) problems.push("缺少研究 profile / time zero / SAP 版本");

  if (ciLow > estimate || estimate > ciHigh)
    problems.push("主分析点估计不在 95% 置信区间内");
  if (balance.some((row) => row.smdAfter > 0.1))
    problems.push("加权后仍有协变量 SMD > 0.1");
  if (sensitivity.some((row) => row.ciLow > row.estimate || row.estimate > row.ciHigh))
    problems.push("敏感性分析点估计不在相应置信区间内");

  return {
    synthetic: root.synthetic,
    estimand: text(root.estimand) ?? "未声明",
    estimator: text(root.estimator) ?? "未声明",
    cohort: { trialN, controlPoolN, analysisTrialN, analysisControlN },
    effect: { measure, estimate, ciLow, ciHigh },
    balance,
    overlap: hasOverlap
      ? {
          minPropensity: overlap.minPropensity!,
          maxPropensity: overlap.maxPropensity!,
          trimmed: overlap.trimmed!,
          eesTrial: overlap.eesTrial!,
          eesControl: overlap.eesControl!,
        }
      : null,
    weights: hasWeights
      ? {
          maxWeight: weights.maxWeight!,
          p99Weight: weights.p99Weight!,
          truncatedFraction: weights.truncatedFraction!,
          effectiveSampleSize: weights.effectiveSampleSize!,
        }
      : null,
    missingness: hasMissing
      ? {
          mode: missing.mode as "MCAR" | "MAR" | "MNAR",
          missingFraction: missing.missingFraction!,
          imputedN: missing.imputedN!,
        }
      : null,
    censoring: hasCensoring
      ? {
          observedN: censoring.observedN!,
          censoredN: censoring.censoredN!,
          competingRiskN: censoring.competingRiskN!,
        }
      : null,
    sensitivity,
    truthComparison,
    study: studyView,
    problems: [...new Set(problems)],
  };
}

export function registrationEffectText(
  effect: RegistrationResultView["effect"],
): string {
  const value =
    effect.measure === "risk-ratio"
      ? effect.estimate.toFixed(3)
      : `${(effect.estimate * 100).toFixed(1)} 个百分点`;
  const low =
    effect.measure === "risk-ratio"
      ? effect.ciLow.toFixed(3)
      : `${(effect.ciLow * 100).toFixed(1)}%`;
  const high =
    effect.measure === "risk-ratio"
      ? effect.ciHigh.toFixed(3)
      : `${(effect.ciHigh * 100).toFixed(1)}%`;
  return `${effect.measure === "risk-ratio" ? "RR" : "风险差"} ${value}（95% CI ${low} – ${high}）`;
}
