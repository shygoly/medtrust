// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * Registration-grade external-control reference implementation.
 *
 * The implementation is deterministic and accepts only numeric/enumerated
 * columns. It fits a logistic propensity model, trims non-overlap, applies
 * IPTW-ATT weights, reports balance/diagnostics, and computes a weighted risk
 * contrast. Raw rows and link keys never enter the returned aggregate.
 */

export type RegistrationMissingness = "MCAR" | "MAR" | "MNAR";
export type RegistrationEffectMeasure = "risk-difference" | "risk-ratio";

export interface ExternalControlRegistrationRow {
  subjectKey: string;
  linkKey: string;
  sourceId: string;
  age: number | null;
  sex: string;
  calendarYear: number | null;
  timeZero: string;
  eligibleAtTimeZero: boolean;
  treatmentStrategy: string;
  severity: number | null;
  diseaseDuration: number | null;
  comorbidityIndex: number | null;
  priorTreatment: number | null;
  keyBiomarker: number | null;
  outcome: "pos" | "neg";
  followUpDays: number;
  [key: string]: unknown;
}

export interface ExternalControlRegistrationInput {
  trialRows: readonly ExternalControlRegistrationRow[];
  controlRows: readonly ExternalControlRegistrationRow[];
  covariates: readonly string[];
  effectMeasure: RegistrationEffectMeasure;
  missingness: RegistrationMissingness;
  trimLow?: number;
  trimHigh?: number;
  maxWeight?: number;
  minEffectiveSampleSize?: number;
  synthetic: boolean;
  truthRr?: number;
  study: {
    profileVersion: string;
    timeZero: string;
    estimandSapVersion: string;
  };
}

export interface RegistrationPrepared {
  rows: Array<{
    treated: 0 | 1;
    outcome: 0 | 1;
    weightQ: number;
  }>;
  diagnostics: {
    cohort: {
      trialN: number;
      controlPoolN: number;
      analysisTrialN: number;
      analysisControlN: number;
      excluded: {
        trialIneligibleAtTimeZero: number;
        controlIneligibleAtTimeZero: number;
      };
    };
    balance: Array<{ covariate: string; smdBefore: number; smdAfter: number }>;
    overlap: {
      minPropensity: number;
      maxPropensity: number;
      trimmed: number;
      eesTrial: number;
      eesControl: number;
    };
    weights: {
      maxWeight: number;
      p99Weight: number;
      truncatedFraction: number;
      effectiveSampleSize: number;
    };
    missingness: {
      mode: RegistrationMissingness;
      missingFraction: number;
      imputedN: number;
    };
    censoring: {
      observedN: number;
      censoredN: number;
      competingRiskN: number;
    };
  };
}

export interface RegistrationKernelResult {
  riskTreated: number;
  riskControl: number;
  riskDifference: number;
  riskRatio: number;
  riskDifferenceCi: [number, number];
  riskRatioCi: [number, number];
  effectiveSampleSize: number;
}

export interface ExternalControlRegistrationResult
  extends RegistrationKernelResult {
  analysisType: "external-control-registration";
  synthetic: boolean;
  estimand: "ATT";
  estimator: "IPTW-ATT";
  cohort: RegistrationPrepared["diagnostics"]["cohort"];
  effect: {
    measure: RegistrationEffectMeasure;
    estimate: number;
    ciLow: number;
    ciHigh: number;
  };
  balance: RegistrationPrepared["diagnostics"]["balance"];
  overlap: RegistrationPrepared["diagnostics"]["overlap"];
  weights: RegistrationPrepared["diagnostics"]["weights"];
  missingness: RegistrationPrepared["diagnostics"]["missingness"];
  censoring: RegistrationPrepared["diagnostics"]["censoring"];
  sensitivity: Array<{
    id: string;
    estimate: number;
    ciLow: number;
    ciHigh: number;
    direction: string;
  }>;
  truthComparison?: {
    rrTrue: number;
    rrEstimated: number;
    absoluteError: number;
    withinExpectedRange: boolean;
  };
  study: ExternalControlRegistrationInput["study"];
}

export const REGISTRATION_WEIGHT_Q = 65536;
const Z95 = 1.959963984540054;

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${path} must be a finite number`);
  return value;
}

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

function solve(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]!]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++)
      if (Math.abs(a[j]![i]!) > Math.abs(a[pivot]![i]!)) pivot = j;
    if (Math.abs(a[pivot]![i]!) < 1e-12) throw new Error("propensity model is singular");
    [a[i], a[pivot]] = [a[pivot]!, a[i]!];
    const divisor = a[i]![i]!;
    for (let k = i; k <= n; k++) a[i]![k] = a[i]![k]! / divisor;
    for (let row = 0; row < n; row++) {
      if (row === i) continue;
      const factor = a[row]![i]!;
      for (let k = i; k <= n; k++)
        a[row]![k] = a[row]![k]! - factor * a[i]![k]!;
    }
  }
  return a.map((row) => row[n]!);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dayNumber(value: string, path: string): number {
  const parsed = Date.parse(
    value.length === 10 ? `${value}T00:00:00Z` : value,
  );
  if (!Number.isFinite(parsed)) throw new Error(`${path} is not a valid date`);
  return Math.floor(parsed / 86_400_000);
}

function standardDeviation(values: readonly number[], center: number): number {
  const variance =
    values.reduce((sum, value) => sum + (value - center) ** 2, 0) /
    Math.max(1, values.length - 1);
  return Math.sqrt(variance) || 1;
}

function weightedMean(
  values: readonly number[],
  weights: readonly number[],
): number {
  const denominator = weights.reduce((sum, weight) => sum + weight, 0);
  if (denominator <= 0) throw new Error("weighted mean has zero denominator");
  return (
    values.reduce((sum, value, i) => sum + value * weights[i]!, 0) /
    denominator
  );
}

function weightedVariance(
  values: readonly number[],
  weights: readonly number[],
  center: number,
): number {
  const denominator = weights.reduce((sum, weight) => sum + weight, 0);
  return (
    values.reduce(
      (sum, value, i) => sum + weights[i]! * (value - center) ** 2,
      0,
    ) / denominator
  );
}

function covariateNumber(covariate: string, value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return Number.NaN;
  if (covariate === "sex" && (value === "M" || value === "F"))
    return value === "M" ? 1 : 0;
  throw new Error(
    `covariate ${covariate} must be numeric or, for sex only, the M/F enum`,
  );
}

function rankP99(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]!;
}

export function registrationKernel(
  rows: readonly { treated: 0 | 1; outcome: 0 | 1; weight: number }[],
): RegistrationKernelResult {
  const treated = rows.filter((row) => row.treated === 1);
  const controls = rows.filter((row) => row.treated === 0);
  if (treated.length === 0 || controls.length === 0)
    throw new Error("both trial and control arms must be non-empty");
  const riskTreated =
    treated.reduce((sum, row) => sum + row.outcome, 0) / treated.length;
  const controlWeight = controls.reduce((sum, row) => sum + row.weight, 0);
  if (controlWeight <= 0) throw new Error("control weights must be positive");
  const riskControl =
    controls.reduce((sum, row) => sum + row.outcome * row.weight, 0) /
    controlWeight;
  const riskDifference = riskTreated - riskControl;
  const riskRatio =
    riskControl <= 0 ? Number.POSITIVE_INFINITY : riskTreated / riskControl;

  const varianceTreated =
    (riskTreated * (1 - riskTreated)) / treated.length;
  const varianceControl =
    controls.reduce(
      (sum, row) =>
        sum + row.weight ** 2 * (row.outcome - riskControl) ** 2,
      0,
    ) /
    controlWeight ** 2;
  const seDifference = Math.sqrt(varianceTreated + varianceControl);
  const seLogRatio =
    riskTreated <= 0 ||
    riskControl <= 0 ||
    !Number.isFinite(riskRatio)
      ? Number.NaN
      : Math.sqrt(
          (1 - riskTreated) / (treated.length * riskTreated) +
            varianceControl / riskControl ** 2,
        );
  const eesTreated = treated.length;
  const eesControl =
    controlWeight ** 2 /
    controls.reduce((sum, row) => sum + row.weight ** 2, 0);

  return {
    riskTreated,
    riskControl,
    riskDifference,
    riskRatio,
    riskDifferenceCi: [
      Math.max(-1, riskDifference - Z95 * seDifference),
      Math.min(1, riskDifference + Z95 * seDifference),
    ],
    riskRatioCi: Number.isFinite(seLogRatio)
      ? [
          riskRatio * Math.exp(-Z95 * seLogRatio),
          riskRatio * Math.exp(Z95 * seLogRatio),
        ]
      : [Number.NaN, Number.NaN],
    effectiveSampleSize: eesTreated + eesControl,
  };
}

export function prepareExternalControlRegistration(
  input: ExternalControlRegistrationInput,
): RegistrationPrepared {
  if (!["MCAR", "MAR", "MNAR"].includes(input.missingness))
    throw new Error("missingness must be MCAR, MAR, or MNAR");
  if (!["risk-difference", "risk-ratio"].includes(input.effectMeasure))
    throw new Error("effectMeasure is not an allowed enum");
  if (!input.covariates.length) throw new Error("at least one covariate is required");
  if (input.synthetic && !(typeof input.truthRr === "number" && input.truthRr > 0))
    throw new Error("synthetic registration runs require a positive answer-key RR");

  const trialLinks = new Set(input.trialRows.map((row) => row.linkKey));
  if (input.controlRows.some((row) => trialLinks.has(row.linkKey)))
    throw new Error("trial and control linkKey partitions overlap");

  const allRows = [...input.trialRows, ...input.controlRows];
  for (const [index, row] of allRows.entries()) {
    if (!row.subjectKey?.trim())
      throw new Error(`row ${index} has an empty subjectKey`);
    if (!row.linkKey?.trim())
      throw new Error(`row ${index} has an empty linkKey`);
    if (!row.treatmentStrategy?.trim())
      throw new Error(`row ${index} has an empty treatmentStrategy`);
  }
  if (
    new Set(input.trialRows.map((row) => row.subjectKey)).size !==
    input.trialRows.length
  )
    throw new Error("trial subjectKey values must be unique");
  if (
    new Set(input.controlRows.map((row) => row.subjectKey)).size !==
    input.controlRows.length
  )
    throw new Error("control subjectKey values must be unique");
  if (new Set(allRows.map((row) => row.linkKey)).size !== allRows.length)
    throw new Error("subject linkKey values must be unique across both arms");

  const trialStrategies = new Set(
    input.trialRows.map((row) => row.treatmentStrategy.trim()),
  );
  const controlStrategies = new Set(
    input.controlRows.map((row) => row.treatmentStrategy.trim()),
  );
  if (trialStrategies.size !== 1 || controlStrategies.size !== 1)
    throw new Error("each arm must use exactly one predeclared treatment strategy");
  if (trialStrategies.has([...controlStrategies][0]!))
    throw new Error("trial and external-control treatment strategies must differ");

  const trialIneligible = input.trialRows.filter(
    (row) => !row.eligibleAtTimeZero,
  ).length;
  const controlIneligible = input.controlRows.filter(
    (row) => !row.eligibleAtTimeZero,
  ).length;

  const rows = [
    ...input.trialRows.map((row) => ({ row, treated: 1 as const })),
    ...input.controlRows.map((row) => ({ row, treated: 0 as const })),
  ]
    .filter(({ row }) => row.eligibleAtTimeZero)
    .map((item) => {
      const { row } = item;
      if (row.outcome !== "pos" && row.outcome !== "neg")
        throw new Error(`subject ${row.subjectKey} has an invalid outcome`);
      if (!row.timeZero)
        throw new Error(`subject ${row.subjectKey} has no timeZero`);
      const zero = dayNumber(row.timeZero, `subject ${row.subjectKey} timeZero`);
      if (!Number.isInteger(row.followUpDays) || row.followUpDays < 0)
        throw new Error(`subject ${row.subjectKey} has invalid followUpDays`);
      if (row.outcome === "pos") {
        if (typeof row.outcomeDate !== "string")
          throw new Error(`subject ${row.subjectKey} has a positive outcome without outcomeDate`);
        const outcomeDay = dayNumber(
          row.outcomeDate,
          `subject ${row.subjectKey} outcomeDate`,
        );
        if (outcomeDay < zero)
          throw new Error(`subject ${row.subjectKey} outcome precedes timeZero`);
      }
      if (row.censorDate !== null && row.censorDate !== undefined) {
        if (typeof row.censorDate !== "string")
          throw new Error(`subject ${row.subjectKey} has an invalid censorDate`);
        const censorDay = dayNumber(
          row.censorDate,
          `subject ${row.subjectKey} censorDate`,
        );
        if (censorDay < zero)
          throw new Error(`subject ${row.subjectKey} censoring precedes timeZero`);
        if (
          row.outcome === "pos" &&
          typeof row.outcomeDate === "string" &&
          dayNumber(
            row.outcomeDate,
            `subject ${row.subjectKey} outcomeDate`,
          ) > censorDay
        )
          throw new Error(
            `subject ${row.subjectKey} outcome follows censorDate`,
          );
      }
      return item;
    })
    .map((item, index) => ({ ...item, index }));
  if (rows.length === 0) throw new Error("no eligible rows at time zero");

  const values: Record<string, number[]> = {};
  let missingCells = 0;
  let imputedN = 0;
  for (const covariate of input.covariates) {
    values[covariate] = rows.map(({ row }) => {
      const value = covariateNumber(covariate, row[covariate]);
      if (!Number.isFinite(value)) {
        missingCells++;
        return Number.NaN;
      }
      return value;
    });
  }
  for (const covariate of input.covariates) {
    const column = values[covariate]!;
    const observed = column.filter(Number.isFinite);
    if (!observed.length) throw new Error(`covariate ${covariate} has no observed value`);
    const center = mean(observed);
    for (let i = 0; i < column.length; i++) {
      if (Number.isFinite(column[i]!)) continue;
      column[i] = center;
    }
    if (column.some((value) => !Number.isFinite(value)))
      throw new Error(`covariate ${covariate} remains missing`);
    imputedN += observed.length < column.length ? column.length - observed.length : 0;
  }
  const missingFraction = missingCells / (rows.length * input.covariates.length);
  if (missingFraction > 0.2)
    throw new Error("registration fail-closed: missing fraction exceeds 0.20");

  const standardized: number[][] = [];
  const scales: Array<{ center: number; scale: number }> = [];
  for (const covariate of input.covariates) {
    const column = values[covariate]!;
    const center = mean(column);
    const scale = standardDeviation(column, center);
    scales.push({ center, scale });
  }
  for (let i = 0; i < rows.length; i++)
    standardized.push([
      1,
      ...input.covariates.map(
        (covariate, j) => (values[covariate]![i]! - scales[j]!.center) / scales[j]!.scale,
      ),
    ]);

  let beta = new Array(standardized[0]!.length).fill(0) as number[];
  let converged = false;
  for (let iteration = 0; iteration < 30; iteration++) {
    const p = standardized.map((x) =>
      sigmoid(x.reduce((sum, value, i) => sum + value * beta[i]!, 0)),
    );
    const dimension = beta.length;
    const matrix = Array.from({ length: dimension }, () =>
      new Array(dimension).fill(0) as number[],
    );
    const vector = new Array(dimension).fill(0) as number[];
    for (let i = 0; i < rows.length; i++) {
      const treatment = rows[i]!.treated;
      const weight = p[i]! * (1 - p[i]!);
      for (let a = 0; a < dimension; a++) {
        vector[a] += standardized[i]![a]! * (treatment - p[i]!);
        for (let b = 0; b < dimension; b++)
          matrix[a]![b] += standardized[i]![a]! * standardized[i]![b]! * weight;
      }
    }
    for (let a = 0; a < dimension; a++) matrix[a]![a]! += 1e-7;
    const update = solve(matrix, vector);
    beta = beta.map((value, i) => value + update[i]!);
    if (Math.max(...update.map(Math.abs)) < 1e-8) {
      converged = true;
      break;
    }
  }
  if (!converged) throw new Error("propensity model did not converge");

  const propensity = standardized.map((x) =>
    sigmoid(x.reduce((sum, value, i) => sum + value * beta[i]!, 0)),
  );
  const trimLow = input.trimLow ?? 0.05;
  const trimHigh = input.trimHigh ?? 0.95;
  if (!(trimLow >= 0 && trimHigh <= 1 && trimLow < trimHigh))
    throw new Error("trim bounds are invalid");
  const kept = rows
    .map((row, i) => ({ ...row, propensity: propensity[i]! }))
    .filter((row) => row.propensity >= trimLow && row.propensity <= trimHigh);
  const trimmed = rows.length - kept.length;
  if (trimmed / rows.length > 0.1)
    throw new Error("registration fail-closed: overlap trimming exceeds 0.10");
  const preparedRows = kept.map((row) => ({
    ...row,
    outcome: row.row.outcome,
    weight: row.treated === 1 ? 1 : row.propensity / (1 - row.propensity),
  }));
  if (!preparedRows.some((row) => row.treated === 1) || !preparedRows.some((row) => row.treated === 0))
    throw new Error("positivty failure: one arm empty after trimming");
  const maxWeight = Math.max(...preparedRows.map((row) => row.weight));
  if (maxWeight > (input.maxWeight ?? 20))
    throw new Error("registration fail-closed: weight exceeds configured limit");
  const p99Weight = rankP99(preparedRows.map((row) => row.weight));
  if (p99Weight > 10)
    throw new Error("registration fail-closed: P99 weight exceeds 10");

  const balance = input.covariates.map((covariate, j) => {
    const raw = values[covariate]!;
    const rawTreated = raw.filter((_, i) => rows[i]!.treated === 1);
    const rawControl = raw.filter((_, i) => rows[i]!.treated === 0);
    const before = (mean(rawTreated) - mean(rawControl)) /
      Math.sqrt(
        (standardDeviation(rawTreated, mean(rawTreated)) ** 2 +
          standardDeviation(rawControl, mean(rawControl)) ** 2) /
          2,
      );
    const keptValues = kept.map(({ index }) => values[covariate]![index]!);
    const treatedValues = keptValues.filter((_, i) => kept[i]!.treated === 1);
    const controlValues = keptValues.filter((_, i) => kept[i]!.treated === 0);
    const controlWeights = preparedRows
      .filter((row) => row.treated === 0)
      .map((row) => row.weight);
    const treatedCenter = mean(treatedValues);
    const controlCenter = weightedMean(controlValues, controlWeights);
    const treatedVariance =
      (treatedValues.reduce((sum, value) => sum + (value - treatedCenter) ** 2, 0) /
      Math.max(1, treatedValues.length - 1));
    const controlVariance = weightedVariance(
      controlValues,
      controlWeights,
      controlCenter,
    );
    const after = (treatedCenter - controlCenter) /
      Math.sqrt(Math.max(1e-12, (treatedVariance + controlVariance) / 2));
    void j;
    return {
      covariate,
      smdBefore: Math.abs(before),
      smdAfter: Math.abs(after),
    };
  });

  const treatedPropensity = kept
    .filter((row) => row.treated === 1)
    .map((row) => row.propensity);
  const controlPropensity = kept
    .filter((row) => row.treated === 0)
    .map((row) => row.propensity);
  const eesTrial = treatedPropensity.length;
  const eesControl =
    controlPropensity.reduce((sum, p) => sum + p / (1 - p), 0) ** 2 /
    controlPropensity.reduce((sum, p) => sum + (p / (1 - p)) ** 2, 0);
  const effectiveSampleSize = eesTrial + eesControl;
  if (effectiveSampleSize < (input.minEffectiveSampleSize ?? 20))
    throw new Error("registration fail-closed: effective sample size too small");

  const censoring = {
    observedN: rows.filter(({ row }) => row.outcome === "pos").length,
    censoredN: rows.filter(
      ({ row }) =>
        typeof row.censorDate === "string" &&
        Number.isFinite(Date.parse(row.censorDate)),
    ).length,
    competingRiskN: rows.filter(
      ({ row }) =>
        Array.isArray(row.intercurrentEvents) &&
        row.intercurrentEvents.includes("competing-risk-event"),
    ).length,
  };

  return {
    rows: preparedRows.map((row) => ({
      treated: row.treated,
      outcome: row.outcome === "pos" ? 1 : 0,
      weightQ: Math.max(1, Math.round(row.weight * REGISTRATION_WEIGHT_Q)),
    })),
    diagnostics: {
      cohort: {
        trialN: input.trialRows.length,
        controlPoolN: input.controlRows.length,
        analysisTrialN: preparedRows.filter((row) => row.treated === 1).length,
        analysisControlN: preparedRows.filter((row) => row.treated === 0).length,
        excluded: {
          trialIneligibleAtTimeZero: trialIneligible,
          controlIneligibleAtTimeZero: controlIneligible,
        },
      },
      balance,
      overlap: {
        minPropensity: Math.min(...propensity),
        maxPropensity: Math.max(...propensity),
        trimmed,
        eesTrial,
        eesControl,
      },
      weights: {
        maxWeight,
        p99Weight,
        truncatedFraction: trimmed / rows.length,
        effectiveSampleSize,
      },
      missingness: {
        mode: input.missingness,
        missingFraction,
        imputedN,
      },
      censoring,
    },
  };
}

function resultOf(
  input: ExternalControlRegistrationInput,
  prepared: RegistrationPrepared,
  kernel: RegistrationKernelResult,
  id = "primary",
): ExternalControlRegistrationResult["sensitivity"][number] {
  const effect =
    input.effectMeasure === "risk-ratio"
      ? { estimate: kernel.riskRatio, ciLow: kernel.riskRatioCi[0], ciHigh: kernel.riskRatioCi[1] }
      : {
          estimate: kernel.riskDifference,
          ciLow: kernel.riskDifferenceCi[0],
          ciHigh: kernel.riskDifferenceCi[1],
        };
  const nullValue = input.effectMeasure === "risk-ratio" ? 1 : 0;
  return {
    id,
    estimate: effect.estimate,
    ciLow: effect.ciLow,
    ciHigh: effect.ciHigh,
    direction:
      Math.abs(effect.estimate - nullValue) < 1e-12
        ? "null"
        : effect.estimate < nullValue
          ? "below-null"
          : "above-null",
  };
}

export function externalControlRegistrationReference(
  input: ExternalControlRegistrationInput,
): ExternalControlRegistrationResult {
  const prepared = prepareExternalControlRegistration(input);
  const kernel = registrationKernel(
    prepared.rows.map((row) => ({
      treated: row.treated,
      outcome: row.outcome,
      weight: row.weightQ / REGISTRATION_WEIGHT_Q,
    })),
  );
  const effect =
    input.effectMeasure === "risk-ratio"
      ? {
          measure: input.effectMeasure,
          estimate: kernel.riskRatio,
          ciLow: kernel.riskRatioCi[0],
          ciHigh: kernel.riskRatioCi[1],
        }
      : {
          measure: input.effectMeasure,
          estimate: kernel.riskDifference,
          ciLow: kernel.riskDifferenceCi[0],
          ciHigh: kernel.riskDifferenceCi[1],
        };
  if (![effect.estimate, effect.ciLow, effect.ciHigh].every(Number.isFinite))
    throw new Error("registration fail-closed: effect is not estimable");

  const sensitivity = [resultOf(input, prepared, kernel)];
  const trimmedPrepared = prepareExternalControlRegistration({
    ...input,
    trimLow: 0.1,
    trimHigh: 0.9,
  });
  sensitivity.push(
    resultOf(
      input,
      trimmedPrepared,
      registrationKernel(
        trimmedPrepared.rows.map((row) => ({
          treated: row.treated,
          outcome: row.outcome,
          weight: row.weightQ / REGISTRATION_WEIGHT_Q,
        })),
      ),
      "overlap-trimming-10pct",
    ),
  );

  return {
    analysisType: "external-control-registration",
    synthetic: input.synthetic,
    estimand: "ATT",
    estimator: "IPTW-ATT",
    ...kernel,
    cohort: prepared.diagnostics.cohort,
    effect,
    balance: prepared.diagnostics.balance,
    overlap: prepared.diagnostics.overlap,
    weights: prepared.diagnostics.weights,
    missingness: prepared.diagnostics.missingness,
    censoring: prepared.diagnostics.censoring,
    sensitivity,
    ...(input.synthetic
      ? {
          truthComparison: {
            rrTrue: input.truthRr!,
            rrEstimated: kernel.riskRatio,
            absoluteError: Math.abs(kernel.riskRatio - input.truthRr!),
            withinExpectedRange:
              kernel.riskRatio >= input.truthRr! * 0.75 &&
              kernel.riskRatio <= input.truthRr! * 1.25,
          },
        }
      : {}),
    study: input.study,
  };
}

export interface RegistrationKernelEncoded {
  n: number;
  input: Uint8Array;
  outOff: number;
  outBytes: number;
  requiredBytes: number;
}

export function encodeRegistrationKernel(rows: RegistrationPrepared["rows"]): RegistrationKernelEncoded {
  const n = rows.length;
  const inOff = 1024;
  const treatedOff = inOff;
  const outcomeOff = treatedOff + n;
  const weightOff = (outcomeOff + n + 3) & ~3;
  const outOff = (weightOff + n * 4 + 7) & ~7;
  const outBytes = 56;
  const bytes = new Uint8Array(outOff + outBytes);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, n, true);
  rows.forEach((row, i) => {
    bytes[treatedOff + i] = row.treated;
    bytes[outcomeOff + i] = row.outcome;
    if (!Number.isInteger(row.weightQ) || row.weightQ < 1 || row.weightQ > 0x7fffffff)
      throw new Error("weightQ is outside signed 32-bit range");
    view.setInt32(weightOff + i * 4, row.weightQ, true);
  });
  return { n, input: bytes, outOff, outBytes, requiredBytes: bytes.length };
}

export function decodeRegistrationKernel(output: Uint8Array): RegistrationKernelResult & {
  nTreated: number;
  nControl: number;
} {
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const q = (offset: number) => view.getInt32(offset, true) / REGISTRATION_WEIGHT_Q;
  return {
    riskTreated: q(0),
    riskControl: q(4),
    riskDifference: q(8),
    riskRatio: q(12),
    riskDifferenceCi: [q(16), q(20)],
    riskRatioCi: [q(24), q(28)],
    effectiveSampleSize: view.getFloat64(40, true),
    nTreated: view.getInt32(48, true),
    nControl: view.getInt32(52, true),
  };
}
