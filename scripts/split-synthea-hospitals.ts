#!/usr/bin/env node
/**
 * Split Synthea FHIR patient bundles into two hospital data domains (40 + 60).
 *
 * Usage (repo root):
 *   npx tsx scripts/split-synthea-hospitals.ts [--demohospa 40] [--demohospb 60]
 *
 * Input:  data/synthea/output/fhir/*.json (patient bundles only)
 * Output: data/synthea/hospitals/{demohospa,demohospb}/fhir/*.json + manifest.json
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'data/synthea/output/fhir');

interface HospitalSplit {
  id: string;
  org: string;
  participantId: string;
  catalogProductId: string;
  modality: string;
  count: number;
}

function parseArgs(): { demohospa: number; demohospb: number } {
  const args = process.argv.slice(2);
  let demohospa = 40;
  let demohospb = 60;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--demohospa' && args[i + 1]) demohospa = Number(args[++i]);
    if (args[i] === '--demohospb' && args[i + 1]) demohospb = Number(args[++i]);
  }
  return { demohospa, demohospb };
}

function isPatientBundle(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  return (
    base.endsWith('.json') &&
    !base.includes('practitioner') &&
    !base.includes('hospital') &&
    !base.includes('information')
  );
}

function copyFile(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main(): void {
  if (!fs.existsSync(SRC)) {
    console.error(`Missing ${SRC} — run Synthea generation first.`);
    process.exit(1);
  }

  const { demohospa, demohospb } = parseArgs();
  const total = demohospa + demohospb;

  const files = fs
    .readdirSync(SRC)
    .filter((f) => isPatientBundle(path.join(SRC, f)))
    .sort();

  if (files.length < total) {
    console.error(`Need at least ${total} patient bundles, found ${files.length}`);
    process.exit(1);
  }

  const hospitals: HospitalSplit[] = [
    {
      id: 'h-demohospa',
      org: '示范甲医院',
      participantId: 'p-demohospa',
      catalogProductId: 'dp-insulin-panc-demohospa',
      modality: 'structured_ehr',
      count: demohospa,
    },
    {
      id: 'h-demohospb',
      org: '示范乙医院',
      participantId: 'p-demohospb',
      catalogProductId: 'dp-insulin-panc-demohospb',
      modality: 'structured_ehr',
      count: demohospb,
    },
  ];

  const outRoot = path.join(REPO, 'data/synthea/hospitals');
  const assignments: { hospital: string; files: string[] }[] = [];

  let offset = 0;
  for (const h of hospitals) {
    const slice = files.slice(offset, offset + h.count);
    offset += h.count;
    const destDir = path.join(outRoot, h.id === 'h-demohospa' ? 'demohospa' : 'demohospb', 'fhir');
    for (const f of slice) {
      copyFile(path.join(SRC, f), path.join(destDir, f));
    }
    assignments.push({ hospital: h.org, files: slice });
    console.log(`  ${h.org}: ${slice.length} patients → ${destDir}`);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: 'synthea',
    totalPatients: total,
    hospitals,
    assignments: assignments.map((a) => ({
      org: a.hospital,
      patientCount: a.files.length,
      sampleFiles: a.files.slice(0, 3),
    })),
  };

  fs.mkdirSync(outRoot, { recursive: true });
  fs.writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nWrote manifest → ${path.join(outRoot, 'manifest.json')}`);
  console.log(`Next: pnpm --filter @medtrust/connector demo:synthea-e2e`);
}

main();
