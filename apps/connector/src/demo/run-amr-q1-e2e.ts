/* eslint-disable no-console */
/**
 * AMR Sentinel — 联邦 Q1（condition-prevalence）端到端演示。
 *
 * 华山 + 瑞金各自加载合成药敏 records.json；药企发起耐药率描述任务；
 * 仅聚合出域；控制面侧合并由本机 RwsOrchestrator 完成（与 synthea-e2e 同构）。
 *
 * Prereq:
 *   python3 scripts/amr/generate_synthetic.py --n-per-hospital 5000
 *   # 或仅灌连接器切片：
 *   python3 scripts/amr/build_amr_connectors.py
 *
 * Run: pnpm --filter @medtrust/connector demo:amr-q1
 */
import * as fs from 'fs';
import * as path from 'path';
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { FhirGateway } from '../domain/fhir-gateway';
import { LocalDataLoader } from '../domain/local-data-loader';
import { LocalStore } from '../domain/local-store';
import { RwsExecutor } from '../domain/rws-executor';
import { OutputGate } from '../domain/output-gate';
import { PolicyEnforcementPoint } from '../domain/policy-enforcement';
import { TaskScratch } from '../domain/task-scratch';
import { RetentionEnforcer } from '../domain/retention';
import { ConnectorTaskRunner } from '../domain/connector-task-runner';
import { RwsOrchestrator, HospitalNode } from '../domain/rws-orchestrator';
import { ContractView } from '../domain/contract-view';
import { defaultConnectorDataRoot } from '../domain/local-data-path';

const AMR_PURPOSE = '抗菌药物耐药监测真实世界研究';
const REPO = path.resolve(__dirname, '../../../..');

type HospitalNodeWithMeta = HospitalNode & { store: LocalStore; recordCount: number };

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
    minCell: 5,
  };
}

function buildHospitalFromAmr(
  id: string,
  org: string,
  hospitalKey: 'huashan' | 'ruijin',
): HospitalNodeWithMeta {
  const audit = new AuditService();
  const deid = new Deidentifier();
  const store = new LocalStore(audit);
  const loader = new LocalDataLoader(deid, new FhirGateway());
  const declared = `data/synthetic/amr/connectors/${hospitalKey}`;
  const loaded = loader.loadFromDeclaredPath(declared, defaultConnectorDataRoot());
  if (loaded.format !== 'internal_records') {
    throw new Error(`${hospitalKey}: expected internal_records, got ${loaded.format}`);
  }
  store.replaceAll(loaded.records);

  const scratch = new TaskScratch();
  const runner = new ConnectorTaskRunner(
    new PolicyEnforcementPoint(audit),
    new RwsExecutor(store, deid),
    new OutputGate(audit, deid),
    scratch,
    new RetentionEnforcer(scratch, audit),
  );
  return { id, org, runner, store, recordCount: loaded.records.length };
}

function resistanceRate(
  buckets: { key: string; count: number }[],
  organism: string,
  drug: string,
): number | null {
  const nOrg = buckets.find((b) => b.key === `organism:${organism}`)?.count ?? 0;
  const nR = buckets.find((b) => b.key === `resist:${organism}:${drug}:R`)?.count ?? 0;
  return nOrg > 0 ? nR / nOrg : null;
}

async function main(): Promise<void> {
  const manifestPath = path.join(REPO, 'data/synthetic/amr/connectors/manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('Missing data/synthetic/amr/connectors/manifest.json');
    console.error('Run: python3 scripts/amr/build_amr_connectors.py');
    process.exit(1);
  }

  console.log('=== AMR Sentinel · 联邦 Q1（耐药率 condition-prevalence）===\n');
  console.log('数据域: 合成药敏分离株 · 华山 / 瑞金 · 原始 MIC 不出域\n');

  const huashan = buildHospitalFromAmr('p-huashan', '华山医院', 'huashan');
  const ruijin = buildHospitalFromAmr('p-ruijin', '瑞金医院', 'ruijin');

  console.log('1. 各院本地入库 (records.json → LocalStore)');
  console.log(`   · 华山: ${huashan.recordCount} 条 (dp-amr-ast-huashan)`);
  console.log(`   · 瑞金: ${ruijin.recordCount} 条 (dp-amr-ast-ruijin)`);

  for (const h of [huashan, ruijin]) {
    let blocked = false;
    try {
      h.store.exportRaw({ origin: 'external', actor: 'p-meddata' });
    } catch {
      blocked = true;
    }
    console.log(`   · ${h.org} 外部读行级: ${blocked ? '已拒绝 ✓' : '未拒绝 ✗'}`);
  }

  const contracts = new Map<string, ContractView>([
    ['p-huashan', amrContract('seed:dp-amr-ast-huashan:p-meddata:抗菌药物耐药监测真实世界研究', 'p-huashan', 'dp-amr-ast-huashan')],
    ['p-ruijin', amrContract('seed:dp-amr-ast-ruijin:p-meddata:抗菌药物耐药监测真实世界研究', 'p-ruijin', 'dp-amr-ast-ruijin')],
  ]);

  const orch = new RwsOrchestrator(new AuditService());
  const result = await orch.run(
    {
      taskId: 'rws-amr-q1-prevalence',
      purpose: AMR_PURPOSE,
      analysis: {
        type: 'condition-prevalence',
        level: 'L1',
      },
      initiator: 'p-meddata',
    },
    [huashan, ruijin],
    contracts,
  );

  console.log(`\n2. 药企发起 Q1 — 菌种×抗生素耐药标签患病率 (仅聚合出域)`);
  console.log(`   已下发: ${result.dispatched.join('、')}`);
  if (result.skipped.length) {
    console.log(`   跳过: ${result.skipped.map((s) => `${s.org}(${s.reason})`).join('、')}`);
  }

  for (const p of result.perNode) {
    const top = p.aggregate.buckets
      .filter((b) => b.key.startsWith('resist:') && b.key.endsWith(':R'))
      .slice(0, 3)
      .map((b) => `${b.key}=${b.count}`)
      .join('、');
    console.log(`   · ${p.org} n=${p.aggregate.cohortSize}: ${top || '—'}`);
  }

  console.log(`\n3. 联邦合并 n=${result.merged.cohortSize}`);
  const checks: Array<[string, string, number]> = [
    ['eco', 'CIP', 0.63],
    ['kpn', 'MEM', 0.22],
    ['aba', 'IPM', 0.645],
  ];
  for (const [org, drug, chinet] of checks) {
    const rate = resistanceRate(result.merged.buckets, org, drug);
    const pct = rate == null ? 'n/a' : `${(rate * 100).toFixed(1)}%`;
    const delta = rate == null ? '' : ` (Δ vs CHINET ${(Math.abs(rate - chinet) * 100).toFixed(1)}pp)`;
    console.log(`   · ${org}/${drug} R% = ${pct}${delta}`);
  }

  console.log(`\n4. 存证哈希 taskHash=${result.attestation.taskHash.slice(0, 18)}…`);
  if (result.settlement) {
    console.log(`   结算 total=${result.settlement.total} ${result.settlement.currency}`);
  }

  // Hard gate for CI / demo
  if (result.dispatched.length !== 2) {
    throw new Error(`expected 2 sites dispatched, got ${result.dispatched.length}`);
  }
  if (result.merged.cohortSize !== huashan.recordCount + ruijin.recordCount) {
    throw new Error('merged cohortSize mismatch');
  }
  const kpnMem = resistanceRate(result.merged.buckets, 'kpn', 'MEM');
  if (kpnMem == null || kpnMem < 0.1 || kpnMem > 0.4) {
    throw new Error(`kpn/MEM R% out of band: ${kpnMem}`);
  }

  console.log('\n联邦 Q1 PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
