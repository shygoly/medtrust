/* eslint-disable no-console */
/**
 * AMR Sentinel — Q2 merge-then-gate unlock (PAPER P2).
 *
 * Contrast with demo:amr-q2 (gate-then-merge):
 *   · Both sites raw rare_colistin_r_aba in (0, minCell) → each alone would suppress
 *   · Trusted in-process merge of ungated aggregates, then OutputGate once → publishable
 *
 * Ungated site aggregates MUST NOT egress a network boundary (TRUST); this demo
 * only runs the dual-hospital loop inside one process (same pattern as Q1/Q2 demos).
 *
 * Run: pnpm --filter @medtrust/connector demo:amr-q2-unlock
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
import { AggregateResult } from '../domain/types';

const AMR_PURPOSE = '抗菌药物耐药监测真实世界研究';
const RARE_KEY = 'rare_colistin_r_aba';
const REPO = path.resolve(__dirname, '../../../..');
const MIN_CELL = DEFAULT_MIN_CELL;

type NodeMeta = HospitalNode & { recordCount: number; rawRare: number; audit: AuditService; gate: OutputGate };

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
    allowedArtifacts: ['condition_prevalence', 'cohort_count'],
    minCell: MIN_CELL,
  };
}

function rareBucket(agg: AggregateResult) {
  return agg.buckets.find((b) => b.key === RARE_KEY);
}

function buildHospital(
  id: string,
  org: string,
  hospitalKey: 'huashan' | 'ruijin',
): NodeMeta {
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
  store.replaceAll(loaded.records);
  const rawRare = loaded.records.filter((r) => r.conditions.includes(RARE_KEY)).length;
  const gate = new OutputGate(audit, deid);
  const scratch = new TaskScratch();
  const runner = new ConnectorTaskRunner(
    new PolicyEnforcementPoint(audit),
    new RwsExecutor(store, deid),
    gate,
    scratch,
    new RetentionEnforcer(scratch, audit),
  );
  return { id, org, runner, recordCount: loaded.records.length, rawRare, audit, gate };
}

async function main(): Promise<void> {
  const manifestPath = path.join(REPO, 'data/synthetic/amr/connectors/manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('Missing connectors manifest');
    process.exit(1);
  }

  console.log('=== AMR Sentinel · Q2 unlock（merge-then-gate）===\n');
  console.log(`表型: ${RARE_KEY} · minCell=${MIN_CELL}\n`);

  const huashan = buildHospital('p-huashan', '华山医院', 'huashan');
  const ruijin = buildHospital('p-ruijin', '瑞金医院', 'ruijin');

  console.log('1. 闸门前 raw');
  console.log(`   · 华山=${huashan.rawRare}  瑞金=${ruijin.rawRare}  合计=${huashan.rawRare + ruijin.rawRare}`);
  for (const h of [huashan, ruijin]) {
    if (!(h.rawRare > 0 && h.rawRare < MIN_CELL)) {
      throw new Error(
        `${h.org} raw rare=${h.rawRare} 需满足 0 < n < ${MIN_CELL}（双院皆压叙事）`,
      );
    }
  }
  if (huashan.rawRare + ruijin.rawRare < MIN_CELL) {
    throw new Error('merged raw still < minCell — retune rare_cre_boost');
  }

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

  const orchAudit = new AuditService();
  const orch = new RwsOrchestrator(orchAudit);
  const gateAlone = new OutputGate(new AuditService(), new Deidentifier());

  // Contrast: gate-then-merge loses the signal
  const gatedPath = await orch.run(
    {
      taskId: 'rws-amr-q2-gate-then-merge',
      purpose: AMR_PURPOSE,
      analysis: { type: 'condition-prevalence', level: 'L1' },
      initiator: 'p-meddata',
    },
    [huashan, ruijin],
    contracts,
  );
  const lost = rareBucket(gatedPath.merged);
  console.log('\n2. gate-then-merge（默认路径）');
  console.log(
    `   · merged ${RARE_KEY} count=${lost?.count ?? 0} suppressed=${Boolean(lost?.suppressed)}`,
  );
  if ((lost?.count ?? 0) >= MIN_CELL) {
    throw new Error('expected gate-then-merge to lose rare signal when both sites < minCell');
  }

  // Unlock: merge-then-gate
  const unlock = await orch.runMergeThenGate(
    {
      taskId: 'rws-amr-q2-merge-then-gate',
      purpose: AMR_PURPOSE,
      analysis: { type: 'condition-prevalence', level: 'L1' },
      initiator: 'p-meddata',
    },
    [huashan, ruijin],
    contracts,
    gateAlone,
  );
  const unlocked = rareBucket(unlock.merged);
  console.log('\n3. merge-then-gate（可信进程内合并后再闸）');
  console.log(
    `   · merged ${RARE_KEY} count=${unlocked?.count ?? 0} suppressed=${Boolean(unlocked?.suppressed)}`,
  );
  if (!unlocked || unlocked.count < MIN_CELL || unlocked.suppressed) {
    throw new Error(`expected unlock publishable rare cell, got ${JSON.stringify(unlocked)}`);
  }
  if (!orchAudit.all().some((e) => e.action === 'merge-then-gate')) {
    throw new Error('missing merge-then-gate audit');
  }

  console.log('\n叙事核对: 双院皆压 ✓ · gate-then-merge 丢信号 ✓ · merge-then-gate 解锁 ✓');
  console.log('demo:amr-q2-unlock PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
