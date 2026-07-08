#!/usr/bin/env node
/**
 * MedTrust Synthea → Clinical Text Loader
 *
 * Reads Synthea FHIR JSON bundles and extracts DiagnosticReport / DocumentReference
 * clinical notes into the dp-neph-text (clinical_text) raw shape.
 *
 * Synthea v4 embeds narrative in DiagnosticReport.presentedForm (base64 plain text).
 *
 * Usage:
 *   pnpm ingest-synthea
 *   npx tsx scripts/ingest-synthea.ts
 *
 * Output: data/synthea/ingested-clinical-text/*.json (one file per patient, de-identified)
 */
import * as fs from 'fs';
import * as path from 'path';

interface SyntheaEntry {
  fullUrl?: string;
  resource?: {
    resourceType: string;
    id?: string;
    name?: { text?: string; given?: string[]; family?: string }[];
    telecom?: { system: string; value: string }[];
    birthDate?: string;
    gender?: string;
    subject?: { reference?: string };
    patient?: { reference?: string };
    encounter?: { reference?: string };
    status?: string;
    code?: { text?: string; coding?: { code?: string; display?: string; system?: string }[] };
    type?: { text?: string; coding?: { code?: string; display?: string; system?: string }[] };
    effectiveDateTime?: string;
    date?: string;
    presentedForm?: { contentType?: string; data?: string }[];
    content?: { attachment?: { contentType?: string; data?: string } }[];
    period?: { start?: string; end?: string };
    class?: { code?: string; display?: string };
    reasonCode?: { text?: string }[];
    start?: string;
  };
}

interface NoteSections {
  chief_complaint?: string;
  history_of_present_illness?: string;
  social_history?: string;
  allergies?: string;
  medications?: string;
  assessment_and_plan?: string;
  plan?: string;
}

interface ClinicalNoteRecord {
  note_id: string;
  encounter_id?: string;
  effective_date: string;
  note_type: string;
  loinc_codes: string[];
  source: 'DiagnosticReport' | 'DocumentReference';
  admission_summary: string;
  nephrology_impression: string;
  sections: NoteSections;
}

interface ClinicalTextPatientRecord {
  modality: 'clinical_text';
  profile: 'urn:medtrust:neph-text-v1';
  patientId: string;
  subjectKey: string;
  demographics: {
    ageBand: string;
    sex?: string;
  };
  notes: ClinicalNoteRecord[];
}

const CHRONIC_KEYWORDS: Record<string, string> = {
  diabetes: '2型糖尿病',
  hypertens: '高血压',
  kidney: '慢性肾病',
  renal: '慢性肾病',
  ckd: '慢性肾病',
  'chronic kidney': '慢性肾病',
  nephropathy: '糖尿病肾病',
  proteinuria: '蛋白尿',
  albuminuria: '蛋白尿',
  copd: '慢阻肺',
  asthma: '哮喘',
  cancer: '肿瘤随访',
  carcinoma: '肿瘤随访',
  heart: '心血管疾病',
  coronary: '心血管疾病',
  'end-stage': '终末期肾病',
  dialysis: '透析治疗',
  igA: 'IgA肾病',
};

const SECTION_HEADERS: [RegExp, keyof NoteSections][] = [
  [/^#\s*Chief Complaint\s*$/im, 'chief_complaint'],
  [/^#\s*History of Present Illness\s*$/im, 'history_of_present_illness'],
  [/^#\s*Social History\s*$/im, 'social_history'],
  [/^#\s*Allergies\s*$/im, 'allergies'],
  [/^#\s*Medications\s*$/im, 'medications'],
  [/^#\s*Assessment and Plan\s*$/im, 'assessment_and_plan'],
  [/^##\s*Plan\s*$/im, 'plan'],
];

function isPatientBundle(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  return (
    base.endsWith('.json') &&
    !base.includes('practitioner') &&
    !base.includes('hospital') &&
    !base.includes('information')
  );
}

function decodeNote(data?: string): string {
  if (!data) return '';
  try {
    return Buffer.from(data, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function parseNoteSections(note: string): NoteSections {
  const sections: NoteSections = {};
  const lines = note.split('\n');
  let current: keyof NoteSections | null = null;
  const buffers: Partial<Record<keyof NoteSections, string[]>> = {};

  for (const line of lines) {
    const header = SECTION_HEADERS.find(([re]) => re.test(line.trim()));
    if (header) {
      current = header[1];
      buffers[current] = buffers[current] ?? [];
      continue;
    }
    if (current) {
      buffers[current]!.push(line);
    }
  }

  for (const [key, buf] of Object.entries(buffers) as [keyof NoteSections, string[]][]) {
    const text = buf.join('\n').trim();
    if (text) sections[key] = text;
  }

  return sections;
}

function ageBandFromBirthDate(birthDate: string): string {
  const year = new Date(birthDate).getFullYear();
  const age = new Date().getFullYear() - year;
  if (age < 18) return '0-17';
  if (age < 45) return '18-44';
  if (age < 65) return '45-64';
  if (age < 75) return '65-74';
  return '75+';
}

function patientNameTokens(patient: NonNullable<SyntheaEntry['resource']>): string[] {
  const tokens = new Set<string>();
  for (const n of patient.name ?? []) {
    if (n.text) tokens.add(n.text);
    for (const g of n.given ?? []) tokens.add(g);
    if (n.family) tokens.add(n.family);
    const combo = [...(n.given ?? []), n.family].filter(Boolean).join(' ');
    if (combo) tokens.add(combo);
  }
  return [...tokens].filter((t) => t.length > 2);
}

function deidentifyNoteText(text: string, nameTokens: string[]): string {
  let out = text;
  for (const token of nameTokens.sort((a, b) => b.length - a.length)) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'gi'), '患者');
  }
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[已脱敏]');
  out = out.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[已脱敏]');
  out = out.replace(/(患者\s+)+/g, '患者');
  out = out.replace(/(患者\s*)+is a (\d+) year-old ([^\n.]+)/gi, '患者，$2岁，$3');
  return out.trim();
}

function extractChronicLabels(note: string): string[] {
  const labels = new Set<string>();
  const lower = note.toLowerCase();
  for (const [kw, label] of Object.entries(CHRONIC_KEYWORDS)) {
    if (lower.includes(kw)) labels.add(label);
  }
  return [...labels];
}

function buildAdmissionSummary(sections: NoteSections): string {
  const parts: string[] = [];
  if (sections.chief_complaint && !/^no complaint/i.test(sections.chief_complaint)) {
    parts.push(`主诉：${sections.chief_complaint}`);
  }
  if (sections.history_of_present_illness) {
    parts.push(`现病史：${sections.history_of_present_illness}`);
  }
  if (sections.social_history) {
    parts.push(`既往史/社会史：${sections.social_history}`);
  }
  if (sections.allergies && !/^no known/i.test(sections.allergies)) {
    parts.push(`过敏史：${sections.allergies}`);
  }
  return parts.join('\n') || '入院摘要未见特殊记录。';
}

function buildNephrologyImpression(sections: NoteSections, fullNote: string): string {
  const labels = extractChronicLabels(fullNote);
  const assessment = sections.assessment_and_plan?.trim();
  const plan = sections.plan?.trim();
  const meds = sections.medications?.trim();

  const parts: string[] = [];

  if (labels.length) {
    parts.push(`肾脏相关诊断印象：${labels.join('、')}。`);
  }

  if (assessment) {
    parts.push(`评估：${assessment}`);
  }

  if (plan) {
    parts.push(`诊疗计划：${plan}`);
  }

  if (meds && !/^no active/i.test(meds)) {
    parts.push(`用药记录：${meds}`);
  }

  const kidneyMeds =
    fullNote.match(/(lisinopril|losartan|irbesartan|enalapril|dapagliflozin|empagliflozin|finerenone|metformin)/gi) ??
    [];
  if (kidneyMeds.length) {
    parts.push(`肾保护相关用药：${[...new Set(kidneyMeds.map((m) => m.toLowerCase()))].join('、')}。`);
  }

  if (!parts.length) {
    return '本次病历未见明确肾脏专科诊断，建议结合 eGFR/UACR 等检验指标进一步评估。';
  }

  return parts.join('\n');
}

function loincCodes(resource: NonNullable<SyntheaEntry['resource']>): string[] {
  const codes = new Set<string>();
  for (const c of resource.code?.coding ?? []) {
    if (c.code) codes.add(c.code);
  }
  for (const c of resource.type?.coding ?? []) {
    if (c.code) codes.add(c.code);
  }
  return [...codes];
}

function noteTypeLabel(resource: NonNullable<SyntheaEntry['resource']>): string {
  return (
    resource.code?.text ??
    resource.type?.text ??
    resource.code?.coding?.[0]?.display ??
    resource.type?.coding?.[0]?.display ??
    'Clinical note'
  );
}

function encounterRefId(ref?: string): string | undefined {
  if (!ref) return undefined;
  return ref.replace('urn:uuid:', '').replace('Encounter/', '');
}

function resourceRefsToPatient(resource: NonNullable<SyntheaEntry['resource']>): string {
  return resource.subject?.reference ?? resource.patient?.reference ?? '';
}

function matchesPatient(
  ref: string,
  patientUuid: string,
  patientRef: string,
  pid: string,
): boolean {
  if (!ref) return false;
  return ref.includes(patientUuid) || ref === patientRef || ref === pid || ref.endsWith(`/${pid}`);
}

function extractNoteBody(resource: NonNullable<SyntheaEntry['resource']>): string {
  if (resource.resourceType === 'DiagnosticReport') {
    return (resource.presentedForm ?? []).map((f) => decodeNote(f.data)).find(Boolean) ?? '';
  }
  if (resource.resourceType === 'DocumentReference') {
    return (resource.content ?? []).map((c) => decodeNote(c.attachment?.data)).find(Boolean) ?? '';
  }
  return '';
}

function extractClinicalText(entries: SyntheaEntry[]): ClinicalTextPatientRecord[] {
  const patients = entries.filter((e) => e.resource?.resourceType === 'Patient');

  return patients.map((p) => {
    const res = p.resource!;
    const pid = res.id ?? 'unknown';
    const patientRef = p.fullUrl ?? `urn:uuid:${pid}`;
    const patientUuid = patientRef.split('/').pop() ?? patientRef.replace('urn:uuid:', '');
    const nameTokens = patientNameTokens(res);
    const seenNoteIds = new Set<string>();
    const seenContentKeys = new Set<string>();
    const notes: ClinicalNoteRecord[] = [];

    for (const e of entries) {
      const r = e.resource;
      if (!r) continue;
      if (r.resourceType !== 'DiagnosticReport' && r.resourceType !== 'DocumentReference') continue;
      if (r.resourceType === 'DocumentReference' && r.status === 'superseded') continue;
      if (!matchesPatient(resourceRefsToPatient(r), patientUuid, patientRef, pid)) continue;

      const rawBody = extractNoteBody(r);
      if (!rawBody.trim()) continue;

      const noteId = r.id ?? e.fullUrl?.replace('urn:uuid:', '') ?? `note-${notes.length}`;
      const effectiveDate = r.effectiveDateTime ?? r.date ?? '';
      const contentKey = `${effectiveDate}:${rawBody.slice(0, 120)}`;
      if (seenContentKeys.has(contentKey)) continue;
      seenContentKeys.add(contentKey);
      if (seenNoteIds.has(noteId)) continue;
      seenNoteIds.add(noteId);

      const deidentified = deidentifyNoteText(rawBody, nameTokens);
      const sections = parseNoteSections(deidentified);

      notes.push({
        note_id: noteId,
        encounter_id: encounterRefId(r.encounter?.reference),
        effective_date: effectiveDate,
        note_type: noteTypeLabel(r),
        loinc_codes: loincCodes(r),
        source: r.resourceType as 'DiagnosticReport' | 'DocumentReference',
        admission_summary: buildAdmissionSummary(sections),
        nephrology_impression: buildNephrologyImpression(sections, deidentified),
        sections,
      });
    }

    notes.sort((a, b) => a.effective_date.localeCompare(b.effective_date));

    return {
      modality: 'clinical_text',
      profile: 'urn:medtrust:neph-text-v1',
      patientId: pid,
      subjectKey: `SUBJ-${pid.slice(0, 8)}`,
      demographics: {
        ageBand: ageBandFromBirthDate(res.birthDate ?? '1970-01-01'),
        sex: res.gender,
      },
      notes,
    };
  });
}

function main() {
  const fhirDir = path.resolve(process.cwd(), 'data/synthea/output/fhir');
  if (!fs.existsSync(fhirDir)) {
    console.error(`FHIR output not found at ${fhirDir}`);
    console.error('Run: scripts/generate-synthea-data.sh first');
    process.exit(1);
  }

  const outputDir = path.resolve(process.cwd(), 'data/synthea/ingested-clinical-text');
  fs.mkdirSync(outputDir, { recursive: true });

  const files = fs.readdirSync(fhirDir).filter((f) => isPatientBundle(path.join(fhirDir, f)));
  console.log(`Found ${files.length} patient FHIR bundles`);

  let totalPatients = 0;
  let totalNotes = 0;
  let patientsWithNotes = 0;

  for (const file of files) {
    const content = fs.readFileSync(path.join(fhirDir, file), 'utf-8');
    const bundle = JSON.parse(content);
    const entries: SyntheaEntry[] = bundle.entry ?? [];

    for (const rec of extractClinicalText(entries)) {
      if (rec.notes.length) patientsWithNotes++;
      totalNotes += rec.notes.length;
      const outFile = path.join(outputDir, `patient-${rec.patientId}.json`);
      fs.writeFileSync(outFile, JSON.stringify(rec, null, 2));
      totalPatients++;
    }
  }

  console.log(`Ingested ${totalPatients} patients → ${outputDir}/`);
  console.log(`  patients with notes: ${patientsWithNotes}/${totalPatients}`);
  console.log(`  total clinical notes: ${totalNotes}`);
  console.log('Ready for dp-neph-text (clinical_text) connector ingestion.');
}

main();
