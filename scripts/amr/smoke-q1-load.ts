/**
 * Smoke: load AMR synthetic connector records and run Q1 condition-prevalence.
 *
 * Usage (repo root):
 *   pnpm --filter @medtrust/connector exec -- tsx ../../scripts/amr/smoke-q1-load.ts
 *   npx tsx scripts/amr/smoke-q1-load.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { Deidentifier } from '../../apps/connector/src/domain/deidentifier';
import { FhirGateway } from '../../apps/connector/src/domain/fhir-gateway';
import { LocalDataLoader } from '../../apps/connector/src/domain/local-data-loader';
import { LocalStore } from '../../apps/connector/src/domain/local-store';
import { RwsExecutor } from '../../apps/connector/src/domain/rws-executor';
import { SoftwareSealedCompute } from '../../apps/connector/src/domain/tee';
import { AuditService } from '../../apps/connector/src/domain/audit';
import { defaultConnectorDataRoot } from '../../apps/connector/src/domain/local-data-path';

const REPO = path.resolve(__dirname, '../..');
const HOSPITALS = ['huashan', 'ruijin'] as const;

function resistanceRate(
  records: { conditions: string[] }[],
  organism: string,
  drug: string,
): { nOrg: number; nR: number; rate: number | null } {
  const orgTag = `organism:${organism}`;
  const rTag = `resist:${organism}:${drug}:R`;
  let nOrg = 0;
  let nR = 0;
  for (const r of records) {
    if (!r.conditions.includes(orgTag)) continue;
    nOrg++;
    if (r.conditions.includes(rTag)) nR++;
  }
  return { nOrg, nR, rate: nOrg ? nR / nOrg : null };
}

async function main(): Promise<void> {
  const root = defaultConnectorDataRoot();
  const deid = new Deidentifier();
  const loader = new LocalDataLoader(deid, new FhirGateway());

  for (const hid of HOSPITALS) {
    const declared = `data/synthetic/amr/connectors/${hid}`;
    const abs = path.join(REPO, declared);
    if (!fs.existsSync(path.join(abs, 'records.json'))) {
      console.error(`missing ${declared}/records.json — run: python3 scripts/amr/build_amr_connectors.py`);
      process.exit(2);
    }

    const loaded = loader.loadFromDeclaredPath(declared, root);
    console.log(`[${hid}] format=${loaded.format} n=${loaded.records.length}`);
    if (loaded.format !== 'internal_records') {
      throw new Error(`expected internal_records, got ${loaded.format}`);
    }
    if (!loaded.records.length) throw new Error(`${hid}: empty`);

    // AE shape must survive normalize
    const withAe = loaded.records.filter((r) => r.adverseEvents.length > 0);
    if (withAe.length) {
      const ok = withAe.every(
        (r) =>
          r.adverseEvents.every(
            (e) =>
              typeof e.organSystem === 'string' &&
              typeof e.term === 'string' &&
              typeof e.serious === 'boolean',
          ),
      );
      if (!ok) throw new Error(`${hid}: adverseEvents missing organSystem/term/serious`);
    }

    const store = new LocalStore(new AuditService());
    store.replaceAll(loaded.records);
    const exec = new RwsExecutor(store, deid, new SoftwareSealedCompute());
    const agg = await exec.run({ type: 'condition-prevalence' }, `amr-q1-${hid}`);
    const buckets = (agg.buckets ?? []).slice(0, 12);
    console.log(`[${hid}] Q1 condition-prevalence top buckets:`);
    for (const b of buckets) {
      console.log(`  ${b.key}\tcount=${b.count}\trate=${b.rate}`);
    }

    // Spot-check organism-conditional resistance (demo math for CHINET narrative)
    for (const [org, drug] of [
      ['eco', 'CIP'],
      ['kpn', 'MEM'],
      ['aba', 'IPM'],
    ] as const) {
      const m = resistanceRate(loaded.records, org, drug);
      console.log(
        `  R% ${org}/${drug}: ${m.rate == null ? 'n/a' : (m.rate * 100).toFixed(1) + '%'} (n=${m.nOrg})`,
      );
    }
  }
  console.log('Q1 smoke PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
