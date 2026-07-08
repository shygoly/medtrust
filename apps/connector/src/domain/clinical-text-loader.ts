import * as fs from 'fs';
import * as path from 'path';
import { AdverseEvent, InternalRecord } from './types';

interface ClinicalNoteRecord {
  note_id: string;
  admission_summary?: string;
  nephrology_impression?: string;
  sections?: {
    chief_complaint?: string;
    medications?: string;
    plan?: string;
  };
}

export interface ClinicalTextPatientRecord {
  modality: 'clinical_text';
  profile?: string;
  patientId: string;
  subjectKey: string;
  demographics: {
    ageBand: string;
    sex?: string;
  };
  notes: ClinicalNoteRecord[];
}

const CHRONIC_KEYWORDS: [RegExp, string][] = [
  [/慢性肾病|ckd|chronic kidney/i, '慢性肾病'],
  [/糖尿病肾病|diabetic nephropathy/i, '糖尿病肾病'],
  [/蛋白尿|albuminuria|proteinuria/i, '蛋白尿'],
  [/高血压|hypertens/i, '高血压'],
  [/糖尿病|diabetes/i, '2型糖尿病'],
  [/透析|dialysis/i, '透析治疗'],
  [/终末期|end-stage/i, '终末期肾病'],
  [/influenza/i, '流感疫苗接种史'],
  [/zoster/i, '带状疱疹疫苗接种史'],
];

function extractLabels(text: string): string[] {
  const labels = new Set<string>();
  for (const [re, label] of CHRONIC_KEYWORDS) {
    if (re.test(text)) labels.add(label);
  }
  const immunMatch = text.match(/immunizations?:?\s*([^\n.]+)/i);
  if (immunMatch?.[1]) {
    for (const part of immunMatch[1].split(',')) {
      const t = part.trim();
      if (t) labels.add(t);
    }
  }
  return [...labels];
}

function parseMedications(block?: string): string[] {
  if (!block || /^no active/i.test(block.trim())) return [];
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function parseChiefComplaint(cc?: string): AdverseEvent[] {
  if (!cc || /^no complaint/i.test(cc.trim())) return [];
  return [{ organSystem: '全身', term: cc.trim().slice(0, 80), serious: false }];
}

export function clinicalTextToInternal(rec: ClinicalTextPatientRecord): InternalRecord {
  const conditions = new Set<string>();
  const medications = new Set<string>();
  const adverseEvents: AdverseEvent[] = [];

  for (const note of rec.notes) {
    const blob = [note.admission_summary, note.nephrology_impression, note.sections?.plan].filter(Boolean).join('\n');
    for (const label of extractLabels(blob)) conditions.add(label);
    for (const m of parseMedications(note.sections?.medications)) medications.add(m);
    for (const ae of parseChiefComplaint(note.sections?.chief_complaint)) adverseEvents.push(ae);
  }

  return {
    subjectKey: rec.subjectKey.startsWith('sk_') ? rec.subjectKey : `sk_${rec.subjectKey.replace(/^SUBJ-/, '')}`,
    ageBand: rec.demographics.ageBand,
    sex: rec.demographics.sex,
    conditions: [...conditions],
    medications: [...medications],
    adverseEvents,
  };
}

function isClinicalTextRecord(obj: unknown): obj is ClinicalTextPatientRecord {
  return (
    !!obj &&
    typeof obj === 'object' &&
    (obj as ClinicalTextPatientRecord).modality === 'clinical_text' &&
    Array.isArray((obj as ClinicalTextPatientRecord).notes)
  );
}

export function loadClinicalTextFile(filePath: string): InternalRecord[] {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (isClinicalTextRecord(parsed)) {
    return [clinicalTextToInternal(parsed)];
  }
  if (Array.isArray(parsed)) {
    return parsed.filter(isClinicalTextRecord).map(clinicalTextToInternal);
  }
  throw new Error(`Unsupported clinical text file: ${filePath}`);
}

export function loadClinicalTextDirectory(dir: string): InternalRecord[] {
  if (!fs.existsSync(dir)) {
    throw new Error(`Clinical text directory not found: ${dir}`);
  }

  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    return loadClinicalTextFile(dir);
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const records: InternalRecord[] = [];
  for (const file of files) {
    records.push(...loadClinicalTextFile(path.join(dir, file)));
  }
  return records;
}

export function detectClinicalTextPayload(obj: unknown): boolean {
  return isClinicalTextRecord(obj);
}
