import * as fs from 'fs';
import { enrichConditions, enrichMedications } from './clinical-matching';
import { RawPatientRecord, AdverseEvent } from './types';

/** Synthea connector slice: one JSON file per patient (not a FHIR Bundle). */
export function detectSyntheaPatientPayload(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.patientId === 'string' &&
    Array.isArray(o.conditions) &&
    Array.isArray(o.medications)
  );
}

/**
 * Synthea "conditions" are SNOMED display strings. Many are administrative /
 * social noise ("Medication review due", "Full-time employment") that pollutes
 * the cohort. This allow-list keeps only clinically meaningful disorders /
 * findings, grouped by the body system they belong to — which is also what the
 * adverse-event and condition-prevalence analyses need.
 *
 * Each entry: [keyword to match (lowercase), organ system, clinical label].
 * The label is the term surfaced in aggregate buckets.
 */
const CONDITION_MAP: Array<[string, string, string]> = [
  // ── cardiovascular ──
  ['hypertens', '心血管系统', '高血压'],
  ['coronary', '心血管系统', '冠心病'],
  ['myocardial infarction', '心血管系统', '心肌梗死'],
  ['atrial fibrillation', '心血管系统', '房颤'],
  ['heart failure', '心血管系统', '心力衰竭'],
  ['angina', '心血管系统', '心绞痛'],
  ['cardiovascular disease', '心血管系统', '心血管疾病'],
  // ── renal / metabolic ──
  ['chronic kidney', '泌尿系统', '慢性肾病'],
  ['kidney disease', '泌尿系统', '慢性肾病'],
  ['renal', '泌尿系统', '慢性肾病'],
  ['nephropathy', '泌尿系统', '糖尿病肾病'],
  ['nephritis', '泌尿系统', '肾炎'],
  ['dialysis', '泌尿系统', '透析'],
  ['end-stage', '泌尿系统', '终末期肾病'],
  ['diabetes', '内分泌系统', '糖尿病'],
  ['prediabetes', '内分泌系统', '糖尿病前期'],
  ['metabolic syndrome', '内分泌系统', '代谢综合征'],
  ['gout', '内分泌系统', '痛风'],
  // ── respiratory ──
  ['asthma', '呼吸系统', '哮喘'],
  ['copd', '呼吸系统', '慢阻肺'],
  ['bronchitis', '呼吸系统', '支气管炎'],
  ['pneumonia', '呼吸系统', '肺炎'],
  ['pharyngitis', '呼吸系统', '咽炎'],
  ['sinusitis', '呼吸系统', '鼻窦炎'],
  // ── gastrointestinal ──
  ['gastritis', '消化系统', '胃炎'],
  ['gerd', '消化系统', '胃食管反流'],
  ['reflux', '消化系统', '胃食管反流'],
  ['ulcer', '消化系统', '溃疡'],
  ['appendicitis', '消化系统', '阑尾炎'],
  ['gallstone', '消化系统', '胆结石'],
  // ── neurological ──
  ['stroke', '神经系统', '脑卒中'],
  ['seizure', '神经系统', '癫痫'],
  ['migraine', '神经系统', '偏头痛'],
  ['concussion', '神经系统', '脑震荡'],
  // ── musculoskeletal ──
  ['fracture', '肌肉骨骼系统', '骨折'],
  ['osteoarthritis', '肌肉骨骼系统', '骨关节炎'],
  ['osteoporosis', '肌肉骨骼系统', '骨质疏松'],
  ['arthritis', '肌肉骨骼系统', '关节炎'],
  ['back pain', '肌肉骨骼系统', '腰背痛'],
  // ── hematologic / immune ──
  ['anemia', '血液系统', '贫血'],
  ['allergy', '免疫系统', '过敏反应'],
  ['allergic', '免疫系统', '过敏反应'],
  // ── oncology ──
  ['cancer', '肿瘤', '恶性肿瘤'],
  ['carcinoma', '肿瘤', '恶性肿瘤'],
  ['neoplasm', '肿瘤', '肿瘤'],
  ['melanoma', '肿瘤', '黑色素瘤'],
  ['leukemia', '肿瘤', '白血病'],
  ['lymphoma', '肿瘤', '淋巴瘤'],
  ['breast cancer', '肿瘤', '乳腺癌'],
  ['colorectal cancer', '肿瘤', '结直肠癌'],
  ['lung cancer', '肿瘤', '肺癌'],
  // ── infection ──
  ['infection', '感染', '感染'],
  ['sepsis', '感染', '脓毒症'],
  ['hepatitis', '感染', '肝炎'],
  ['tuberculosis', '感染', '结核'],
  // ── mental health ──
  ['depression', '精神系统', '抑郁'],
  ['anxiety', '精神系统', '焦虑'],
  ['insomnia', '精神系统', '失眠'],
];

/** Conditions that are pure administrative / social noise — never clinical. */
const NOISE_PATTERNS = [
  'medication review',
  'employment',
  'labor force',
  'social contact',
  'social isolation',
  'violence',
  'education',
  'assessment',
  'review due',
  'finding', // "Stress (finding)" etc. are vague
  'mass screening',
  'procedure',
  'documentation',
];

function isNoiseCondition(cond: string): boolean {
  const lower = cond.toLowerCase();
  return NOISE_PATTERNS.some((p) => lower.includes(p));
}

function classifyCondition(
  cond: string,
): { organSystem: string; term: string } | null {
  if (isNoiseCondition(cond)) return null;
  const lower = cond.toLowerCase();
  for (const [kw, system, term] of CONDITION_MAP) {
    if (lower.includes(kw)) return { organSystem: system, term };
  }
  return null;
}

/**
 * Derive adverse-event-like entries from the patient's condition list. Synthea
 * does not emit adverse drug reactions, so we treat clinically significant
 * comorbidities (cardiovascular events, infections, acute disorders) as
 * adverse events for the disproportionality / comparative-effect analyses.
 *
 * @deprecated D-DATA-1 / rws-test-data-signal-injection Task 4: comorbidity-as-AE
 * is a fake signal. Prefer payload `adverseEvents` from the TS injection layer.
 * Force this path with `MEDTRUST_DERIVE_AE=1` for one-iteration rollback only.
 */
const SERIOUS_SYSTEMS = new Set([
  '心血管系统',
  '泌尿系统',
  '神经系统',
  '肿瘤',
  '感染',
]);

/** Rollback switch: force comorbidity→AE derivation even when payload carries AE. */
export function shouldDeriveAdverseEvents(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const v = env.MEDTRUST_DERIVE_AE;
  return v === '1' || v === 'true';
}

function isAdverseEventShape(v: unknown): v is AdverseEvent {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.organSystem === 'string' &&
    typeof o.term === 'string' &&
    typeof o.serious === 'boolean'
  );
}

function deriveAdverseEvents(
  conditions: string[],
  seenTerms: Set<string>,
): AdverseEvent[] {
  const events: AdverseEvent[] = [];
  for (const cond of conditions) {
    const cls = classifyCondition(cond);
    if (!cls) continue;
    // dedupe by (system, term) within a patient to avoid double-counting
    const key = `${cls.organSystem}:${cls.term}`;
    if (seenTerms.has(key)) continue;
    seenTerms.add(key);
    events.push({
      organSystem: cls.organSystem,
      term: cls.term,
      serious: SERIOUS_SYSTEMS.has(cls.organSystem),
    });
  }
  return events;
}

/**
 * Prefer injected / precomputed AE on the payload. Empty array is valid (no AE).
 * Fall back to comorbidity derivation only when AE are absent, or when
 * `MEDTRUST_DERIVE_AE=1` forces the legacy path.
 */
export function resolveAdverseEvents(
  obj: Record<string, unknown>,
  conditions: string[],
  env: NodeJS.ProcessEnv = process.env,
): AdverseEvent[] {
  const forceDerive = shouldDeriveAdverseEvents(env);
  if (!forceDerive && Array.isArray(obj.adverseEvents)) {
    return (obj.adverseEvents as unknown[]).filter(isAdverseEventShape);
  }
  return deriveAdverseEvents(conditions, new Set());
}

/**
 * Normalize the Synthea condition list into clinically meaningful labels,
 * dropping noise. When no condition matches the known map, the raw display
 * string is kept (so cohort-count / condition-prevalence still see variety),
 * but only if it's not noise.
 */
function normalizeConditions(conditions: string[]): string[] {
  const out: string[] = [];
  for (const cond of conditions) {
    if (isNoiseCondition(cond)) continue;
    const cls = classifyCondition(cond);
    out.push(cls?.term ?? cond);
  }
  // dedupe, preserve order
  return [...new Set(out)];
}

function syntheaPatientToRaw(obj: Record<string, unknown>): RawPatientRecord {
  const conditions = (obj.conditions as string[]) ?? [];
  const adverseEvents = resolveAdverseEvents(obj, conditions);
  return {
    patientId: String(obj.patientId),
    name: typeof obj.name === 'string' ? obj.name : `SUBJ-${obj.patientId}`,
    birthDate: typeof obj.birthDate === 'string' ? obj.birthDate : '1970-01-01',
    gender: typeof obj.gender === 'string' ? obj.gender : undefined,
    conditions: enrichConditions(normalizeConditions(conditions)),
    medications: enrichMedications((obj.medications as string[]) ?? []),
    adverseEvents,
    followUpDays: typeof obj.followUpDays === 'number' ? obj.followUpDays : undefined,
    eventOccurred: typeof obj.eventOccurred === 'boolean' ? obj.eventOccurred : undefined,
  };
}

export function loadSyntheaPatientFile(filePath: string): RawPatientRecord[] {
  const obj = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  if (!detectSyntheaPatientPayload(obj)) {
    throw new Error(`非 Synthea patient JSON: ${filePath}`);
  }
  return [syntheaPatientToRaw(obj)];
}
