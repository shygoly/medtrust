import { createHash } from 'crypto';
import { FlFeatureColumn, FlPredictionTaskSpec } from './fl-prediction-task-spec';
import { InternalRecord } from '../types';

const CKD_STAGE_RE = /chronic kidney disease stage\s*(\d)/i;
const ESRD_RE = /end[- ]stage renal|kidney failure|dialysis|终末期|透析/i;

function seed01(subjectKey: string, salt: string): number {
  const hex = createHash('sha256').update(`${subjectKey}:${salt}`).digest('hex');
  return parseInt(hex.slice(0, 8), 16) / 0xffffffff;
}

function maxCkdStage(conditions: readonly string[]): number {
  let max = 0;
  for (const label of conditions) {
    const m = label.match(CKD_STAGE_RE);
    if (m) max = Math.max(max, Number(m[1]));
    if (/stage\s*5|stage\s*v/i.test(label)) max = Math.max(max, 5);
    if (ESRD_RE.test(label)) max = Math.max(max, 5);
  }
  if (max === 0 && conditions.some((c) => /kidney|renal|ckd|肾病/i.test(c))) {
    max = 2;
  }
  return max;
}

function hasHypertension(conditions: readonly string[]): boolean {
  return conditions.some((c) => /hypertens|高血压/i.test(c));
}

function hasDiabetes(conditions: readonly string[]): boolean {
  return conditions.some((c) => /diabetes|糖尿病|diabetic/i.test(c));
}

function hasSglt2i(medications: readonly string[]): boolean {
  return medications.some((m) => /sglt2|empagliflozin|dapagliflozin|canagliflozin/i.test(m));
}

function ckdStageLabel(stage: number): string {
  const labels = ['G1', 'G2', 'G3', 'G4', 'G5'] as const;
  const idx = Math.min(Math.max(stage || 1, 1), 5) - 1;
  return labels[idx];
}

function egfrForStage(stage: number, jitter: number): number {
  const bands: [number, number][] = [
    [90, 118],
    [60, 89],
    [45, 59],
    [15, 29],
    [5, 14],
  ];
  const [lo, hi] = bands[Math.min(Math.max(stage || 1, 1), 5) - 1];
  return Math.round((lo + jitter * (hi - lo)) * 10) / 10;
}

function scrFromEgfr(egfr: number, jitter: number): number {
  const base = 110 - egfr * 0.65 + jitter * 18;
  return Math.round(Math.max(48, Math.min(520, base)) * 10) / 10;
}

function uacrFromRisk(stage: number, diabetic: boolean, jitter: number): number {
  const base = stage >= 4 ? 320 : stage >= 3 ? 120 : stage >= 2 ? 45 : 18;
  const dmBoost = diabetic ? 80 : 0;
  return Math.round(base + dmBoost + jitter * 90);
}

function bpFromRisk(hypertensive: boolean, stage: number, jitter: number): number {
  const base = hypertensive ? 138 : 118;
  return Math.round(base + stage * 2 + jitter * 12);
}

function esrdEvent(stage: number, conditions: readonly string[], jitter: number): boolean {
  if (stage >= 5) return true;
  if (conditions.some((c) => ESRD_RE.test(c))) return true;
  return stage >= 4 && jitter > 0.62;
}

function deriveFeature(
  record: InternalRecord,
  col: FlFeatureColumn,
  ctx: { stage: number; egfr: number; diabetic: boolean; hypertensive: boolean; jitter: number },
): unknown {
  const j = seed01(record.subjectKey, col.name);
  switch (col.name) {
    case 'egfr':
      return ctx.egfr;
    case 'scr':
      return scrFromEgfr(ctx.egfr, j);
    case 'uacr':
      return uacrFromRisk(ctx.stage, ctx.diabetic, j);
    case 'ckd_stage':
      return ckdStageLabel(ctx.stage);
    case 'bp_systolic':
      return bpFromRisk(ctx.hypertensive, ctx.stage, j);
    case 'dm_duration_yr':
      return ctx.diabetic ? Math.round(3 + j * 14) : Math.round(j * 4);
    case 'sglt2i_start':
      return hasSglt2i(record.medications) ? '2022-06-01' : null;
    case 'egfr_slope':
      return Math.round((-(0.8 + ctx.stage * 0.55 + j * 1.2)) * 10) / 10;
    default:
      if (col.dtype === 'boolean') return j > 0.5;
      if (col.dtype === 'categorical') {
        const categories = col.categories ?? [];
        if (categories.length) return categories[Math.floor(j * categories.length) % categories.length];
        return `cat-${Math.floor(j * 100)}`;
      }
      return Math.round(j * 1000) / 10;
  }
}

function deriveTarget(
  record: InternalRecord,
  targetColumn: string,
  ctx: { stage: number; jitter: number },
): unknown {
  if (targetColumn === 'esrd_event' || targetColumn === 'label') {
    return esrdEvent(ctx.stage, record.conditions, ctx.jitter);
  }
  return seed01(record.subjectKey, targetColumn) > 0.5;
}

function rowFromRecord(
  record: InternalRecord,
  spec: FlPredictionTaskSpec,
): Record<string, unknown> {
  const stage = maxCkdStage(record.conditions);
  const jitter = seed01(record.subjectKey, 'fl-target');
  const ctx = {
    stage,
    egfr: egfrForStage(stage, seed01(record.subjectKey, 'egfr')),
    diabetic: hasDiabetes(record.conditions),
    hypertensive: hasHypertension(record.conditions),
    jitter,
  };

  const row: Record<string, unknown> = {};
  for (const col of spec.featureColumns) {
    row[col.name] = deriveFeature(record, col, ctx);
  }
  row[spec.targetColumn] = deriveTarget(record, spec.targetColumn, ctx);
  return row;
}

/**
 * Materialize structured_ehr tabular rows for in-connector FL training.
 * Rows are derived from de-identified InternalRecord cohort signals (CKD stage,
 * comorbidities) and never leave the connector except to the local ML sidecar.
 */
export function materializeFlTabularRows(
  records: readonly InternalRecord[],
  spec: FlPredictionTaskSpec,
): Record<string, unknown>[] {
  if (!records.length || !spec.featureColumns.length || !spec.targetColumn) {
    return [];
  }
  return records.map((r) => rowFromRecord(r, spec));
}
