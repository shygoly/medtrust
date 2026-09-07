/* eslint-disable no-console */
/**
 * AMR Sentinel — Q3 AUD / resistance disproportionality (PAPER §4.4).
 *
 * Maps resist:*:R labels into adverse-event terms for the existing
 * disproportionality executor (drug of interest = MEM). Signal only — not causal.
 *
 * Run: pnpm --filter @medtrust/connector demo:amr-q3
 */
import * as fs from 'fs';
import * as path from 'path';
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { FhirGateway } from '../domain/fhir-gateway';
import { LocalDataLoader } from '../domain/local-data-loader';
import { LocalStore } from '../domain/local-store';
import { RwsExecutor } from '../domain/rws-executor';
import { OutputGate, DEFAULT_MIN_CELL } from '../domain/output-gate';
import { PolicyEnforcementPoint } from '../domain/policy-enforcement';
import { TaskScratch } from '../domain/task-scratch';
import { RetentionEnforcer } from '../domain/retention';
import { ConnectorTaskRunner } from '../domain/connector-task-runner';
import { RwsOrchestrator, HospitalNode } from '../domain/rws-orchestrator';
import { ContractView } from '../domain/contract-view';
import { defaultConnectorDataRoot } from '../domain/local-data-path';
import { InternalRecord } from '../domain/types';

const AMR_PURPOSE = '抗菌药物耐药监测真实世界研究';
const DRUG = 'MEM';
const REPO = path.resolve(__dirname, '../../../..');

function amrContract(id: string, providerId: string, dataProductId: string): ContractView {
  return {
    id,
    dataProductId,
    purpose: AMR_PURPOSE,
    retention: '阅后即焚',
    output: '仅聚合',
    validUntil: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    status: 'active',
    pricing: { model: 'per-record', amount: 1, currency: 'CNY' },
    providerId,
    consumerId: 'p-meddata',
    allowedLevels: ['L1', 'L1.5', 'L2', 'L3'],
    allowedArtifacts: ['condition_prevalence', 'cohort_count', 'disproportionality'],
    minCell: DEFAULT_MIN_CELL,
  };
}

/** Attach resistance-as-event terms so disproportionality can fire on AST labels. */
function enrichResistanceEvents(rows: InternalRecord[]): InternalRecord[] {
  return rows.map((r) => {
    const extra = r.conditions
      .filter((c) => c.startsWith('resist:') && c.endsWith(':R'))
      .map((c) => ({
        organSystem: 'infectious',
        term: c, // e.g. resist:kpn:MEM:R
        serious: true,
      }));
    return {
      ...r,
      adverseEvents: [...(r.adverseEvents ?? []), ...extra],
    };
  });
}

function buildHospital(id: string, org: string, hospitalKey: 'huashan' | 'ruijin'): HospitalNode {
  const audit = new AuditService();
  const deid = new Deidentifier();
  const store = new LocalStore(audit);
  const loader = new LocalDataLoader(deid, new FhirGateway());
  const loaded = loader.loadFromDeclaredPath(
    `data/synthetic/amr/connectors/${hospitalKey}`,
    defaultConnectorDataRoot(),
  );
  if (loaded.format !== 'internal_records') {
    throw new Error(`${hospitalKey}: expected internal_records`);
  }
  store.replaceAll(enrichResistanceEvents(loaded.records));
  const scratch = new TaskScratch();
  const runner = new ConnectorTaskRunner(
    new PolicyEnforcementPoint(audit),
    new RwsExecutor(store, deid),
    new OutputGate(audit, deid),
    scratch,
    new RetentionEnforcer(scratch, audit),
  );
  return { id, org, runner };
}

function rorFromBucket(b: { count: number; b?: number; c?: number; d?: number }): number | null {
  const a = b.count;
  const bb = b.b ?? 0;
  const c = b.c ?? 0;
  const d = b.d ?? 0;
  if ([a, bb, c, d].some((x) => x === 0)) {
    // Haldane–Anscombe
    return ((a + 0.5) * (d + 0.5)) / ((bb + 0.5) * (c + 0.5));
  }
  return (a * d) / (bb * c);
}

async function main(): Promise<void> {
  const manifest = path.join(REPO, 'data/synthetic/amr/connectors/manifest.json');
  if (!fs.existsSync(manifest)) {
    console.error('Missing connectors manifest — run build_amr_connectors.py');
    process.exit(1);
  }

  console.log('=== AMR Sentinel · Q3（用药–耐药失衡信号）===\n');
  console.log(`drug of interest: ${DRUG} · event: resist:*:R labels as AE terms`);
  console.log('角色: 信号检测（非因果）· PAPER §4.4\n');

  const huashan = buildHospital('p-huashan', '华山医院', 'huashan');
  const ruijin = buildHospital('p-ruijin', '瑞金医院', 'ruijin');
  const contracts = new Map<string, ContractView>([
    [
      'p-huashan',
      amrContract(
        'seed:dp-amr-ast-huashan:p-meddata:抗菌药物耐药监测真实世界研究',
        'p-huashan',
        'dp-amr-ast-huashan',
      ),
    ],
    [
      'p-ruijin',
      amrContract(
        'seed:dp-amr-ast-ruijin:p-meddata:抗菌药物耐药监测真实世界研究',
        'p-ruijin',
        'dp-amr-ast-ruijin',
      ),
    ],
  ]);

  const orch = new RwsOrchestrator(new AuditService());
  const result = await orch.run(
    {
      taskId: 'rws-amr-q3-disproportionality',
      purpose: AMR_PURPOSE,
      analysis: { type: 'disproportionality', level: 'L1.5', drug: DRUG },
      initiator: 'p-meddata',
    },
    [huashan, ruijin],
    contracts,
  );

  if (result.dispatched.length !== 2) {
    throw new Error(`expected 2 sites, got ${result.dispatched.length}`);
  }

  const targetKey = 'resist:kpn:MEM:R';
  // gate-then-merge currently sums `count` only — rebuild 2×2 from per-node buckets
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  for (const p of result.perNode) {
    const bucket = p.aggregate.buckets.find((x) => x.key === targetKey);
    if (!bucket) continue;
    a += bucket.count;
    b += bucket.b ?? 0;
    c += bucket.c ?? 0;
    d += bucket.d ?? 0;
    console.log(
      `  · ${p.org}: a=${bucket.count} b=${bucket.b} c=${bucket.c} d=${bucket.d}`,
    );
  }
  const pooled = { count: a, b, c, d };
  const ror = rorFromBucket(pooled);
  if (ror == null || !Number.isFinite(ror)) {
    throw new Error('ROR undefined');
  }
  console.log(`联邦 2×2 加总 n=${result.merged.cohortSize}`);
  console.log(`  ${targetKey}: a=${a} b=${b} c=${c} d=${d} ROR≈${ror.toFixed(3)}`);
  if (a + b + c + d !== result.merged.cohortSize) {
    console.log(
      `  note: 2×2 sum=${a + b + c + d} (event-defined); cohort=${result.merged.cohortSize}`,
    );
  }
  if (result.merged.warnings?.length) {
    console.log(`  warnings: ${result.merged.warnings.map((w) => w.code).join(', ')}`);
  }
  // Signal must be computable; do not claim causality
  if (a < DEFAULT_MIN_CELL) {
    throw new Error(`target cell a=${a} < minCell — signal not publishable under gate`);
  }
  console.log('\nQ3 PASS（信号层；非疗效结论）');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
