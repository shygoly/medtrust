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
import { createMdopRwsExecutor } from '../wiring/wire-mdop-rws';
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

function buildHospital(id: string, org: string, hospitalKey: 'demohospa' | 'demohospb'): HospitalNode {
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
  // 批次 2 迁移：L1.5 走 MDOP 阶段序列（source -> rws.disproportionality -> declassify），
  // 本地装配由 wiring 的本地模块客户端 + registerLocalL15 提供（D10.4）。
  const executor = createMdopRwsExecutor({
    legacy: new RwsExecutor(store, deid),
    context: {
      spaceId: 'sh-med',
      participantId: id,
      dataProductId: `dp-${id}`,
      contractId: `c-${id}`,
      purpose: '抗菌药物耐药监测真实世界研究',
      minCell: 5,
    },
    moduleDir: path.resolve(__dirname, '../../../../packages/wasm-algorithms/build'),
    withRows: (fn) => store.aggregateInternal({ origin: 'internal', actor: 'mdop-rws' }, fn as never),
    holder: `urn:tds:sh-med:participant:${id}`,
    localL15: true,
  });
  const runner = new ConnectorTaskRunner(
    new PolicyEnforcementPoint(audit),
    executor,
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

  const demohospa = buildHospital('p-demohospa', '示范甲医院', 'demohospa');
  const demohospb = buildHospital('p-demohospb', '示范乙医院', 'demohospb');
  const contracts = new Map<string, ContractView>([
    [
      'p-demohospa',
      amrContract(
        'seed:dp-amr-ast-demohospa:p-meddata:抗菌药物耐药监测真实世界研究',
        'p-demohospa',
        'dp-amr-ast-demohospa',
      ),
    ],
    [
      'p-demohospb',
      amrContract(
        'seed:dp-amr-ast-demohospb:p-meddata:抗菌药物耐药监测真实世界研究',
        'p-demohospb',
        'dp-amr-ast-demohospb',
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
    [demohospa, demohospb],
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
