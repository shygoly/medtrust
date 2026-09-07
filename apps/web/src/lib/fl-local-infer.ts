/** Browser-local logistic scoring for FL weight bundles (no network after download). */

export interface FlWeightBundle {
  taskId: string;
  featureSchemaVersion: string;
  featureNames: string[];
  theta: number[];
  intercept: number;
  modelHash: string;
  trainedOnSynthetic: boolean;
  sampleCount: number;
  contractIds?: string[];
}

export interface PatientInferForm {
  ageBand: string;
  sex: "male" | "female";
  exposed_insulin: boolean;
}

export const PANCREATITIS_AGE_BANDS = [
  "18-29",
  "30-39",
  "40-49",
  "50-59",
  "60-69",
  "70+",
] as const;

function sigmoid(z: number): number {
  if (z >= 20) return 1;
  if (z <= -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

/** Encode pancreatitis-risk-v1 form into the bundle's featureNames order. */
export function encodePancreatitisForm(
  form: PatientInferForm,
  featureNames: readonly string[],
): number[] {
  const active = new Set<string>();
  active.add(`ageBand=${form.ageBand}`);
  active.add(`sex=${form.sex}`);
  if (form.exposed_insulin) active.add("exposed_insulin");
  return featureNames.map((name) => {
    if (name === "exposed_insulin") return form.exposed_insulin ? 1 : 0;
    return active.has(name) ? 1 : 0;
  });
}

export function scoreWeightBundle(
  bundle: FlWeightBundle,
  form: PatientInferForm,
): number {
  const x = encodePancreatitisForm(form, bundle.featureNames);
  let z = bundle.intercept;
  for (let i = 0; i < bundle.theta.length; i++) {
    z += bundle.theta[i] * (x[i] ?? 0);
  }
  return sigmoid(z);
}
