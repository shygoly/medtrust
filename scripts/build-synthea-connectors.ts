#!/usr/bin/env node
/**
 * Build per-hospital connector slices from Synthea FHIR bundles.
 *
 * Reads:  data/synthea/hospitals/{huashan,ruijin}/fhir/*.json
 * Writes: data/synthea/connectors/{huashan,ruijin}/patient-<id>.json
 *
 * Usage (repo root):
 *   npx tsx scripts/build-synthea-connectors.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadFhirBundleFile } from '../apps/connector/src/domain/fhir-bundle-loader';
import { enrichConditions, enrichMedications } from '../apps/connector/src/domain/clinical-matching';

const REPO = path.resolve(__dirname, '..');

const HOSPITALS = [
  { key: 'huashan', participantId: 'p-huashan', catalogProductId: 'dp-insulin-panc-huashan' },
  { key: 'ruijin', participantId: 'p-ruijin', catalogProductId: 'dp-insulin-panc-ruijin' },
] as const;

function isPatientBundle(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  return (
    base.endsWith('.json') &&
    !base.includes('practitioner') &&
    !base.includes('hospital') &&
    !base.includes('information') &&
    !base.includes('manifest')
  );
}

/** Deterministic demo enrichment so Fly L1.5–L3 e2e have balanced drug×outcome cells. */
function enrichForAnalyticsDemo(
  slice: {
    conditions: string[];
    medications: string[];
    followUpDays?: number;
    eventOccurred?: boolean;
  },
  index: number,
  hospitalKey: string,
): void {
  const seed = index + (hospitalKey === 'huashan' ? 7 : 19);
  const onMetformin = seed % 3 !== 0;
  const hasCkd = seed % 5 === 0 || (onMetformin && seed % 4 === 1);
  const renalEvent = seed % 11 === 0;

  if (onMetformin) {
    for (const m of [
      '24 HR Metformin hydrochloride 500 MG Extended Release Oral Tablet',
      '二甲双胍',
    ]) {
      if (!slice.medications.includes(m)) slice.medications.push(m);
    }
  } else if (seed % 2 === 0) {
    for (const m of ['insulin human 100 UNT/ML Injectable Solution', '胰岛素']) {
      if (!slice.medications.includes(m)) slice.medications.push(m);
    }
  }

  if (hasCkd) {
    for (const c of [
      'Chronic kidney disease stage 3 (disorder)',
      'Chronic kidney disease stage 3',
      '慢性肾病',
    ]) {
      if (!slice.conditions.includes(c)) slice.conditions.push(c);
    }
  }

  if (renalEvent) {
    for (const c of ['renal_failure', '终末期肾病']) {
      if (!slice.conditions.includes(c)) slice.conditions.push(c);
    }
    slice.eventOccurred = true;
    slice.followUpDays = 120 + (seed % 400);
  } else {
    slice.followUpDays = 180 + (seed % 500);
    slice.eventOccurred = seed % 7 === 0;
  }

  slice.conditions = enrichConditions(slice.conditions);
  slice.medications = enrichMedications(slice.medications);
}

function main(): void {
  const stats: Record<string, number> = {};

  for (const h of HOSPITALS) {
    const srcDir = path.join(REPO, 'data/synthea/hospitals', h.key, 'fhir');
    const destDir = path.join(REPO, 'data/synthea/connectors', h.key);

    if (!fs.existsSync(srcDir)) {
      console.error(`Missing ${srcDir} — run: pnpm split-synthea`);
      process.exit(1);
    }

    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });

    const files = fs.readdirSync(srcDir).filter((f) => isPatientBundle(path.join(srcDir, f))).sort();
    let written = 0;

    for (const [index, file] of files.entries()) {
      for (const raw of loadFhirBundleFile(path.join(srcDir, file))) {
        const slice = {
          patientId: raw.patientId,
          name: `SUBJ-${raw.patientId}`,
          birthDate: raw.birthDate,
          gender: raw.gender,
          conditions: [...raw.conditions],
          medications: [...raw.medications],
        };
        enrichForAnalyticsDemo(slice, index, h.key);
        const outFile = path.join(destDir, `patient-${raw.patientId}.json`);
        fs.writeFileSync(outFile, JSON.stringify(slice, null, 2));
        written++;
      }
    }

    stats[h.key] = written;
    console.log(`  ${h.key}: ${written} patients → ${destDir}`);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: 'synthea-hospitals-fhir',
    hospitals: HOSPITALS.map((h) => ({
      ...h,
      patientCount: stats[h.key],
      localDataPath: `data/synthea/connectors/${h.key}`,
    })),
  };

  const manifestPath = path.join(REPO, 'data/synthea/connectors/manifest.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`\nWrote manifest → ${manifestPath}`);
  console.log('Next: redeploy medtrust-rws-worker-{a,b} with updated connector slices');
}

main();
