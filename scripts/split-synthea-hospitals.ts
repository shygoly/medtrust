#!/usr/bin/env node
/**
 * Split Synthea FHIR patient bundles into two hospital data domains (40 + 60).
 *
 * Usage (repo root):
 *   npx tsx scripts/split-synthea-hospitals.ts [--huashan 40] [--ruijin 60]
 *
 * Input:  data/synthea/output/fhir/*.json (patient bundles only)
 * Output: data/synthea/hospitals/{huashan,ruijin}/fhir/*.json + manifest.json
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

function parseArgs(): { huashan: number; ruijin: number } {
  const args = process.argv.slice(2);
  let huashan = 40;
  let ruijin = 60;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--huashan' && args[i + 1]) huashan = Number(args[++i]);
    if (args[i] === '--ruijin' && args[i + 1]) ruijin = Number(args[++i]);
  }
  return { huashan, ruijin };
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

  const { huashan, ruijin } = parseArgs();
  const total = huashan + ruijin;

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
      id: 'h-huashan',
      org: '华山医院',
      participantId: 'p-huashan',
      catalogProductId: 'dp-insulin-panc-huashan',
      modality: 'structured_ehr',
      count: huashan,
    },
    {
      id: 'h-ruijin',
      org: '瑞金医院',
      participantId: 'p-ruijin',
      catalogProductId: 'dp-insulin-panc-ruijin',
      modality: 'structured_ehr',
      count: ruijin,
    },
  ];

  const outRoot = path.join(REPO, 'data/synthea/hospitals');
  const assignments: { hospital: string; files: string[] }[] = [];

  let offset = 0;
  for (const h of hospitals) {
    const slice = files.slice(offset, offset + h.count);
    offset += h.count;
    const destDir = path.join(outRoot, h.id === 'h-huashan' ? 'huashan' : 'ruijin', 'fhir');
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
