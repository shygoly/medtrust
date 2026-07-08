/* eslint-disable no-console */
// Synthea-backed multi-hospital demo: 华山(40) + 瑞金(60) real FHIR bundles stay
// on each connector; 恒瑞医药 initiates RWS; only gated aggregates + chain hashes exit.
//
// Prereq:
//   npx tsx scripts/split-synthea-hospitals.ts
//
// Run: pnpm --filter @medtrust/connector demo:synthea-e2e
import * as fs from 'fs';
import * as path from 'path';
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { LocalStore } from '../domain/local-store';
import { RwsExecutor } from '../domain/rws-executor';
import { OutputGate } from '../domain/output-gate';
import { PolicyEnforcementPoint } from '../domain/policy-enforcement';
import { TaskScratch } from '../domain/task-scratch';
import { RetentionEnforcer } from '../domain/retention';
import { ConnectorTaskRunner } from '../domain/connector-task-runner';
import { RwsOrchestrator, HospitalNode } from '../domain/rws-orchestrator';
import { ContractView } from '../domain/contract-view';
import { defaultHospitalFhirPath, loadSyntheaHospitalDir } from './synthea-fhir-loader';

type HospitalNodeWithMeta = HospitalNode & { store: LocalStore; patientCount: number };

function buildHospitalFromSynthea(
  id: string,
  org: string,
  hospitalKey: 'huashan' | 'ruijin',
): HospitalNodeWithMeta {
  const audit = new AuditService();
  const deid = new Deidentifier();
  const store = new LocalStore(audit);
  const fhirDir = defaultHospitalFhirPath(hospitalKey);
  const raw = loadSyntheaHospitalDir(fhirDir);
  const internal = raw.map((r) => deid.deidentify(r));
  store.ingest(internal);

  const scratch = new TaskScratch();
  const runner = new ConnectorTaskRunner(
    new PolicyEnforcementPoint(audit),
    new RwsExecutor(store, deid),
    new OutputGate(audit, deid),
    scratch,
    new RetentionEnforcer(scratch, audit),
  );

  return { id, org, runner, store, patientCount: internal.length };
}

const contract = (id: string, provider: string): ContractView => ({
  id,
  purpose: '慢病真实世界研究',
  retention: '阅后即焚',
  output: '仅聚合',
  validUntil: new Date(Date.now() + 90 * 86_400_000).toISOString(),
  status: 'active',
  pricing: { model: 'per-record', amount: 2, currency: 'CNY' },
  providerId: provider,
  consumerId: '恒瑞医药',
});

function printRoleGuide(): void {
  console.log('\n── 可信数据空间演示角色 ──');
  console.log('  主管(监管): data-governance@health.gov.cn / demo123456');
  console.log('  华山医院:   admin@huashan-hospital.com / demo123456  (40 例 Synthea)');
  console.log('  瑞金医院:   admin@rjh.com.cn / demo123456          (60 例 Synthea)');
  console.log('  药企(消费): research@meddata-inst.edu.cn / demo123456');
  console.log('  Web 控制台: http://localhost:5020  → 登录后查看目录/合约/任务\n');
}

function main(): void {
  const manifestPath = path.resolve(
    __dirname,
    '../../../..',
    'data/synthea/hospitals/manifest.json',
  );
  if (!fs.existsSync(manifestPath)) {
    console.error('Missing data/synthea/hospitals/manifest.json');
    console.error('Run first: npx tsx scripts/split-synthea-hospitals.ts');
    process.exit(1);
  }

  printRoleGuide();

  console.log('=== Synthea 多院可信数据空间演示 ===\n');
  console.log('数据域拆分: 100 例 Synthea → 华山 40 + 瑞金 60 (数据不出域)\n');

  const huashan = buildHospitalFromSynthea('h-huashan', '华山医院', 'huashan');
  const ruijin = buildHospitalFromSynthea('h-ruijin', '瑞金医院', 'ruijin');

  console.log(`1. 各院本地入库 (FHIR → 脱敏 → LocalStore)`);
  console.log(`   · 华山医院: ${huashan.patientCount} 例 (dp-ckd-ehr / 结构化随访)`);
  console.log(`   · 瑞金医院: ${ruijin.patientCount} 例 (dp-dkd-cohort / DKD 队列)`);

  // Prove raw rows cannot leave either connector
  for (const h of [huashan, ruijin]) {
    let blocked = false;
    try {
      h.store.exportRaw({ origin: 'external', actor: '恒瑞医药' });
    } catch {
      blocked = true;
    }
    console.log(`   · ${h.org} 外部读行级数据: ${blocked ? '已拒绝 ✓' : '未拒绝 ✗'}`);
  }

  const hospitals: HospitalNode[] = [huashan, ruijin];
  const contracts = new Map<string, ContractView>([
    ['h-huashan', contract('c-huashan-synthea', '华山医院')],
    ['h-ruijin', contract('c-ruijin-synthea', '瑞金医院')],
  ]);

  const orch = new RwsOrchestrator(new AuditService());

  // Analysis A: chronic condition prevalence (shows clinical value of combined cohorts)
  const prevalence = orch.run(
    {
      taskId: 'rws-synthea-prevalence',
      purpose: '慢病真实世界研究',
      analysis: { type: 'condition-prevalence' },
      initiator: '恒瑞医药',
    },
    hospitals,
    contracts,
  );

  console.log(`\n2. 药企发起 RWS — 预防保健/接种服务谱 (仅聚合出域)`);
  console.log(`   已下发: ${prevalence.dispatched.join('、')}`);
  for (const p of prevalence.perNode) {
    const top = p.aggregate.buckets.slice(0, 3).map((b) => `${b.key} ${b.count}例`).join('、');
    console.log(`   · ${p.org} (n=${p.aggregate.cohortSize}): ${top || '—'}`);
  }
  console.log(`   合并队列 n=${prevalence.merged.cohortSize}, 主要服务/接种标签:`);
  for (const b of prevalence.merged.buckets.slice(0, 5)) {
    console.log(`     · ${b.key}: ${b.count} 例 (${(b.rate * 100).toFixed(1)}%)`);
  }

  // Analysis B: influenza-vaccinated sub-cohort age structure (shows cross-hospital utility)
  const vaccine = orch.run(
    {
      taskId: 'rws-synthea-vaccine',
      purpose: '慢病真实世界研究',
      analysis: { type: 'cohort-count', drug: 'influenza' },
      initiator: '恒瑞医药',
    },
    hospitals,
    contracts,
  );

  console.log(`\n3. 疫苗接种亚组 — 年龄分布 (用药队列过滤, 仍不出域)`);
  for (const p of vaccine.perNode) {
    const bands = p.aggregate.buckets.map((b) => `${b.key}:${b.count}`).join(', ');
    console.log(`   · ${p.org} 接种流感疫苗队列 n=${p.aggregate.cohortSize} → ${bands || '—'}`);
  }
  console.log(`   合并接种队列 n=${vaccine.merged.cohortSize}`);

  console.log(`\n4. 链上存证 (仅哈希, 无医疗明文)`);
  console.log(`   taskHash=${prevalence.attestation.taskHash}`);
  console.log(`   outputHash=${prevalence.attestation.outputHash}`);
  console.log(`   participants=${prevalence.attestation.participants.join(', ')}`);

  if (prevalence.settlement) {
    const s = prevalence.settlement;
    console.log(`\n5. 按贡献分账 (40:60 记录量)`);
    console.log(`   应付合计: ${s.total} ${s.currency}`);
    for (const l of s.lines) {
      console.log(`   · ${l.org}: 贡献 ${l.contribution}% → ${l.amount} ${s.currency}`);
    }
  }

  console.log(`\n原始行级数据出域: 0 行`);
  console.log(`各院 Synthea 文件仅驻留本地: data/synthea/hospitals/{huashan|ruijin}/fhir/\n`);
}

main();
