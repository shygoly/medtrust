/* eslint-disable no-console */
// 6.5 — End-to-end RWS demo: 1 pharma (恒瑞医药) initiates a signal-detection
// task across 2 hospital connectors (华山/瑞金). Each hospital runs it locally
// in-TEE behind a digital contract; only gated aggregates come back; the task is
// attested on-chain. Raw data never leaves any hospital.
//
// Run: pnpm --filter @medtrust/connector demo:e2e
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { FhirGateway } from '../domain/fhir-gateway';
import { LocalStore } from '../domain/local-store';
import { RwsExecutor } from '../domain/rws-executor';
import { OutputGate } from '../domain/output-gate';
import { PolicyEnforcementPoint } from '../domain/policy-enforcement';
import { TaskScratch } from '../domain/task-scratch';
import { RetentionEnforcer } from '../domain/retention';
import { ConnectorTaskRunner } from '../domain/connector-task-runner';
import { RwsOrchestrator, HospitalNode } from '../domain/rws-orchestrator';
import { ContractView } from '../domain/contract-view';
import { mockHospitalBundle } from './mock-fhir';

function buildHospital(id: string, org: string, seed: number, patients: number): HospitalNode {
  const audit = new AuditService();
  const deid = new Deidentifier();
  const store = new LocalStore(audit);
  const gateway = new FhirGateway();
  store.ingest(gateway.fromBundle(mockHospitalBundle(seed, patients)).map((r) => deid.deidentify(r)));
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

const contract = (id: string): ContractView => ({
  id,
  purpose: '药物警戒',
  retention: '阅后即焚',
  output: '仅聚合',
  validUntil: new Date(Date.now() + 90 * 86_400_000).toISOString(),
  status: 'active',
});

function main() {
  console.log('\n=== 端到端 RWS:恒瑞医药 × (华山医院 + 瑞金医院) ===\n');

  const hospitals = [
    buildHospital('h-huashan', '华山医院', 7, 40),
    buildHospital('h-ruijin', '瑞金医院', 19, 30),
  ];
  const contracts = new Map<string, ContractView>([
    ['h-huashan', contract('c-huashan')],
    ['h-ruijin', contract('c-ruijin')],
  ]);

  const orch = new RwsOrchestrator(new AuditService());
  const out = orch.run(
    {
      taskId: 'rws-2041',
      purpose: '药物警戒',
      analysis: { type: 'adverse-event-signal', drug: '注射用紫杉醇' },
      initiator: '恒瑞医药',
    },
    hospitals,
    contracts,
  );

  console.log(`1. 已下发:${out.dispatched.join('、')}`);
  if (out.skipped.length) console.log(`   未下发:${out.skipped.map((s) => `${s.org}(${s.reason})`).join('、')}`);
  console.log(`2. 各院本地 TEE 执行,仅回传聚合:`);
  for (const p of out.perNode) {
    console.log(`     ${p.org}(队列 n=${p.aggregate.cohortSize}):` + p.aggregate.buckets.map((b) => `${b.key} ${b.count}${b.suppressed ? '(抑制)' : ''}`).join('、'));
  }
  console.log(`3. 合并聚合(队列 n=${out.merged.cohortSize}):`);
  for (const b of out.merged.buckets) console.log(`     · ${b.key}: ${b.count} 例 (${(b.rate * 100).toFixed(1)}%)`);
  console.log(`4. 上链存证(链上仅哈希):`);
  console.log(`     taskHash=${out.attestation.taskHash} outputHash=${out.attestation.outputHash}`);
  console.log(`     participants=${out.attestation.participants.join(',')} policyHashes=${out.attestation.policyHashes.length}`);
  console.log(`\n原始数据出域行数:0  ·  各院数据始终留在本地\n`);
}

main();
