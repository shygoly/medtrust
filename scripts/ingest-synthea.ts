#!/usr/bin/env node
/**
 * MedTrust Synthea → Connector Loader
 *
 * Reads Synthea FHIR JSON output from data/synthea/output/fhir/ and converts
 * each patient bundle into the connector's RawPatientRecord format.
 *
 * Usage:
 *   pnpm --filter @medtrust/connector ingest-synthea
 *   # Or directly:
 *   ts-node scripts/ingest-synthea.ts [--patients N] [--seed S]
 *
 * Output: data/synthea/ingested/*.json (one file per patient, de-identified)
 */
import * as fs from 'fs';
import * as path from 'path';

interface SyntheaEntry {
  fullUrl?: string;
  resource?: {
    resourceType: string;
    id?: string;
    name?: { text?: string }[];
    telecom?: { system: string; value: string }[];
    birthDate?: string;
    gender?: string;
    subject?: { reference?: string };
    code?: { text?: string; coding?: { code?: string }[] };
    medicationCodeableConcept?: { text?: string; coding?: { code?: string }[] };
    effectiveDateTime?: string;
    performedDateTime?: string;
    performedPeriod?: { start?: string };
    valueQuantity?: { value: number; unit: string };
    component?: { code: { text?: string }; valueQuantity: { value: number; unit: string } }[];
    clinicalStatus?: { coding?: { code?: string }[] };
    category?: { coding?: { code?: string; display?: string }[] };
    type?: { coding?: { code?: string }[] }[];
    encounter?: { period?: { start: string; end?: string }; class?: { code?: string } };
    period?: { start?: string; end?: string };
    reasonCode?: { text?: string }[];
    start?: string;
  };
}

interface RawPatientRecord {
  patientId: string;
  name: string;
  phone?: string;
  birthDate: string;
  gender?: string;
  conditions: string[];
  medications: string[];
  observations: {
    code: string;
    value: number;
    unit: string;
    date: string;
  }[];
  encounters: {
    type: string;
    start: string;
    end?: string;
    reason?: string;
  }[];
  procedures: {
    code: string;
    date: string;
  }[];
}

function extractPatient(entries: SyntheaEntry[]): RawPatientRecord[] {
  const patients = entries.filter((e) => e.resource?.resourceType === 'Patient');

  return patients.map((p) => {
    const res = p.resource!;
    const pid = res.id ?? 'unknown';

    // Synthea uses "urn:uuid:<id>" references. Extract the UUID from fullUrl
    // to match against subject.reference.
    const patientRef = p.fullUrl ?? `urn:uuid:${pid}`;
    const patientUuid = patientRef.split('/').pop() ?? patientRef.replace('urn:uuid:', '');

    const encounterIds = new Set<string>(
      entries
        .filter((e) => e.resource?.resourceType === 'Encounter')
        .filter((e) => {
          const sr = e.resource?.subject?.reference ?? '';
          return sr.includes(patientUuid) || sr === patientRef || sr === pid;
        })
        .map((e) => e.resource!.id!)
    );

    const related = entries.filter((e) => {
      if (!e.resource || e.resource.resourceType === 'Patient') return false;

      // Direct patient reference
      const subjectRef = e.resource.subject?.reference ?? '';
      if (subjectRef.includes(patientUuid) || subjectRef === patientRef || subjectRef === pid) {
        return true;
      }

      // Indirect: MedicationRequest / Procedure → Encounter → Patient
      if (subjectRef.startsWith('urn:uuid:') || subjectRef.startsWith('Patient/')) {
        const refId = subjectRef.replace('urn:uuid:', '').replace('Patient/', '');
        return encounterIds.has(refId);
      }

      return false;
    });

    const conditions = related
      .filter((e) => e.resource?.resourceType === 'Condition')
      .map((e) => e.resource!.code?.text ?? e.resource!.code?.coding?.[0]?.code ?? '')
      .filter(Boolean);

    const medications = related
      .filter((e) => e.resource?.resourceType === 'MedicationRequest')
      .map((e) =>
        e.resource!.medicationCodeableConcept?.text ??
        e.resource!.medicationCodeableConcept?.coding?.[0]?.code ??
        e.resource!.code?.text ??
        e.resource!.code?.coding?.[0]?.code ??
        ''
      )
      .filter(Boolean);

    const observations = related
      .filter((e) => e.resource?.resourceType === 'Observation')
      .map((e) => ({
        code: e.resource!.code?.text ?? '',
        value: e.resource!.valueQuantity?.value ?? 0,
        unit: e.resource!.valueQuantity?.unit ?? '',
        date: e.resource!.effectiveDateTime ?? '',
      }))
      .filter((o) => o.code);

    const encounters = related
      .filter((e) => e.resource?.resourceType === 'Encounter')
      .map((e) => ({
        type: e.resource?.encounter?.class?.code ?? e.resource?.type?.[0]?.coding?.[0]?.code ?? 'unknown',
        start: e.resource?.period?.start ?? e.resource?.start ?? '',
        end: e.resource?.period?.end,
        reason: e.resource?.reasonCode?.[0]?.text,
      }));

    const procedures = related
      .filter((e) => e.resource?.resourceType === 'Procedure')
      .map((e) => ({
        code: e.resource!.code?.text ?? e.resource!.code?.coding?.[0]?.code ?? '',
        date: e.resource!.performedDateTime ?? e.resource!.performedPeriod?.start ?? '',
      }))
      .filter((p) => p.code);

    return {
      patientId: pid,
      name: res.name?.[0]?.text ?? `Patient-${pid}`,
      phone: res.telecom?.find((t) => t.system === 'phone')?.value,
      birthDate: res.birthDate ?? '',
      gender: res.gender,
      conditions,
      medications,
      observations,
      encounters,
      procedures,
    };
  });
}

function deidentify(records: RawPatientRecord[]): RawPatientRecord[] {
  return records.map((r) => ({
    ...r,
    name: `SUBJ-${r.patientId.slice(0, 8)}`,
    phone: undefined,
    birthDate: `${new Date(r.birthDate).getFullYear()}-01-01`, // age band only
  }));
}

function main() {
  const fhirDir = path.resolve(process.cwd(), 'data/synthea/output/fhir');
  if (!fs.existsSync(fhirDir)) {
    console.error(`FHIR output not found at ${fhirDir}`);
    console.error("Run: scripts/generate-synthea-data.sh first");
    process.exit(1);
  }

  const outputDir = path.resolve(process.cwd(), 'data/synthea/ingested');
  fs.mkdirSync(outputDir, { recursive: true });

  const files = fs.readdirSync(fhirDir).filter((f) => f.endsWith('.json'));
  console.log(`Found ${files.length} FHIR bundles`);

  let totalRecords = 0;
  for (const file of files) {
    const content = fs.readFileSync(path.join(fhirDir, file), 'utf-8');
    const bundle = JSON.parse(content);
    const entries: SyntheaEntry[] = bundle.entry ?? [];

    const records = extractPatient(entries);
    const deidentified = deidentify(records);

    for (const rec of deidentified) {
      const outFile = path.join(outputDir, `patient-${rec.patientId}.json`);
      fs.writeFileSync(outFile, JSON.stringify(rec, null, 2));
    }
    totalRecords += deidentified.length;
  }

  console.log(`Ingested ${totalRecords} patients → ${outputDir}/`);
  console.log('Ready for connector ingestion.');
}

main();
