/**
 * Load FHIR R4 patient bundles from a local directory or single file into
 * connector RawPatientRecord shapes.
 *
 * Handles Synthea v4 bundles (DiagnosticReport narrative, Immunization, Claim)
 * and standard FHIR bundles via the same extraction pipeline.
 */
import * as fs from 'fs';
import * as path from 'path';
import { enrichConditions, enrichMedications } from './clinical-matching';
import { RawPatientRecord, AdverseEvent } from './types';

interface FhirEntry {
  fullUrl?: string;
  resource?: {
    resourceType?: string;
    id?: string;
    name?: { text?: string }[];
    telecom?: { system?: string; value?: string }[];
    birthDate?: string;
    gender?: string;
    subject?: { reference?: string };
    vaccineCode?: { text?: string; coding?: { display?: string }[] };
    presentedForm?: { contentType?: string; data?: string }[];
    code?: { text?: string; coding?: { display?: string }[] };
  };
}

interface FhirBundle {
  entry?: FhirEntry[];
}

const CHRONIC_KEYWORDS: Record<string, string> = {
  diabetes: '2型糖尿病',
  hypertens: '高血压',
  kidney: '慢性肾病',
  renal: '慢性肾病',
  ckd: '慢性肾病',
  copd: '慢阻肺',
  asthma: '哮喘',
  cancer: '肿瘤随访',
  carcinoma: '肿瘤随访',
  heart: '心血管疾病',
  coronary: '心血管疾病',
};

const INSURANCE_NAMES =
  /medicare|medicaid|humana|aetna|united|blue cross|cigna|tricare|kaiser|anthem|wellcare|molina/i;

const CLAIM_SERVICE_LABELS: [RegExp, string][] = [
  [/general examination/i, '年度健康体检'],
  [/influenza/i, '流感疫苗接种史'],
  [/covid-19/i, '新冠疫苗接种史'],
  [/zoster/i, '带状疱疹疫苗接种史'],
  [/pneumococcal/i, '肺炎球菌疫苗接种史'],
  [/hep a/i, '甲肝疫苗接种史'],
  [/td \(adult\)/i, '破伤风加强接种史'],
  [/administration of vaccine/i, '疫苗接种服务'],
];

function mapClaimService(text: string): string | null {
  for (const [re, label] of CLAIM_SERVICE_LABELS) {
    if (re.test(text)) return label;
  }
  return null;
}

function extractClaimServices(entries: FhirEntry[]): string[] {
  const labels = new Set<string>();
  for (const e of entries) {
    const r = e.resource;
    if (r?.resourceType !== 'Claim') continue;
    const items = (r as { item?: { productOrService?: { text?: string; coding?: { display?: string }[] } }[] }).item ?? [];
    for (const it of items) {
      const text = it.productOrService?.text ?? it.productOrService?.coding?.[0]?.display ?? '';
      const label = mapClaimService(text);
      if (label) labels.add(label);
    }
  }
  return [...labels];
}

function decodeNote(data?: string): string {
  if (!data) return '';
  try {
    return Buffer.from(data, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function extractFromNote(note: string): { conditions: string[]; medications: string[] } {
  const conditions = new Set<string>();
  const medications = new Set<string>();

  const currently = note.match(/Patient currently has ([^\n.]+)/gi) ?? [];
  for (const line of currently) {
    const val = line.replace(/Patient currently has /i, '').trim();
    if (val && !INSURANCE_NAMES.test(val)) conditions.add(val);
  }

  const medsBlock = note.split(/# Medications/i)[1]?.split(/# /)[0] ?? '';
  for (const line of medsBlock.split('\n')) {
    const t = line.trim();
    if (t && !/^no active/i.test(t)) medications.add(t);
  }

  const plan = note.match(/given the following immunizations?:?\s*([^\n]+)/i);
  if (plan?.[1]) {
    for (const part of plan[1].split(',')) {
      const m = part.trim();
      if (m) medications.add(m);
    }
  }

  const lower = note.toLowerCase();
  for (const [kw, label] of Object.entries(CHRONIC_KEYWORDS)) {
    if (lower.includes(kw)) conditions.add(label);
  }

  return { conditions: [...conditions], medications: [...medications] };
}

function complaintsToAdverseEvents(note: string): AdverseEvent[] {
  const block = note.split(/# Chief Complaint/i)[1]?.split(/# /)[0] ?? '';
  const line = block.trim().split('\n').find((l) => l.trim() && !/^no complaint/i.test(l));
  if (!line) return [];
  return [{ organSystem: '全身', term: line.trim().slice(0, 80), serious: false }];
}

function parseBundle(bundle: FhirBundle): RawPatientRecord[] {
  const entries = bundle.entry ?? [];
  const patient = entries.find((e) => e.resource?.resourceType === 'Patient')?.resource;
  if (!patient?.id) return [];

  const conditions = new Set<string>();
  const medications = new Set<string>();
  const medicationExposures: Array<{ name: string; startDate?: string }> = [];
  const adverseEvents: AdverseEvent[] = [];

  for (const e of entries) {
    const r = e.resource;
    if (!r) continue;
    if (r.resourceType === 'Immunization') {
      const label = r.vaccineCode?.text ?? r.vaccineCode?.coding?.[0]?.display;
      if (label) {
        const mapped = mapClaimService(label);
        if (mapped) conditions.add(mapped);
      }
    }
    if (r.resourceType === 'MedicationRequest') {
      const medReq = r as {
        authoredOn?: string;
        medicationCodeableConcept?: {
          text?: string;
          coding?: { display?: string }[];
        };
      };
      const med = medReq.medicationCodeableConcept;
      const label = med?.text ?? med?.coding?.[0]?.display;
      if (label) {
        medications.add(label);
        const startDate =
          typeof medReq.authoredOn === 'string' && medReq.authoredOn
            ? medReq.authoredOn.slice(0, 10)
            : undefined;
        medicationExposures.push({
          name: label,
          ...(startDate ? { startDate } : {}),
        });
      }
    }
    if (r.resourceType === 'Condition') {
      const code = (r as { code?: { text?: string; coding?: { display?: string }[] } }).code;
      const label = code?.text ?? code?.coding?.[0]?.display;
      if (label) conditions.add(label);
    }
    if (r.resourceType === 'DiagnosticReport') {
      for (const form of r.presentedForm ?? []) {
        const note = decodeNote(form.data);
        const parsed = extractFromNote(note);
        parsed.conditions.forEach((c) => conditions.add(c));
        parsed.medications.forEach((m) => medications.add(m));
        for (const ae of complaintsToAdverseEvents(note)) adverseEvents.push(ae);
      }
    }
  }

  for (const svc of extractClaimServices(entries)) conditions.add(svc);

  return [
    {
      patientId: patient.id,
      name: patient.name?.[0]?.text ?? `Patient-${patient.id}`,
      phone: patient.telecom?.find((t) => t.system === 'phone')?.value,
      birthDate: patient.birthDate ?? '1970-01-01',
      gender: patient.gender,
      conditions: enrichConditions([...conditions]),
      medications: enrichMedications([...medications]),
      ...(medicationExposures.length ? { medicationExposures } : {}),
      adverseEvents,
    },
  ];
}

function isPatientBundleFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return (
    base.endsWith('.json') &&
    !base.includes('practitioner') &&
    !base.includes('hospital') &&
    !base.includes('information') &&
    !base.includes('manifest')
  );
}

export function loadFhirBundleFile(filePath: string): RawPatientRecord[] {
  const bundle = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as FhirBundle;
  return parseBundle(bundle);
}

/** Load every patient FHIR bundle JSON under a directory. */
export function loadFhirBundleDirectory(fhirDir: string): RawPatientRecord[] {
  if (!fs.existsSync(fhirDir)) {
    throw new Error(`FHIR directory not found: ${fhirDir}`);
  }

  const stat = fs.statSync(fhirDir);
  if (stat.isFile()) {
    return loadFhirBundleFile(fhirDir);
  }

  const files = fs.readdirSync(fhirDir).filter((f) => isPatientBundleFile(path.join(fhirDir, f))).sort();
  const records: RawPatientRecord[] = [];
  for (const file of files) {
    records.push(...loadFhirBundleFile(path.join(fhirDir, file)));
  }
  return records;
}
