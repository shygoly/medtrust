/* eslint-disable no-console */
/**
 * 组7.2 — 华山+瑞金 analytics ladder 本地演示 (L1.5 → L2 → L3 → L4).
 * 数据不出域; L4 走 federated_learning 轨道.
 *
 * Run: pnpm --filter @medtrust/connector demo:analytics-ladder
 */
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
import { InternalRecord } from '../domain/types';
import { mockHospitalBundle } from './mock-fhir';
import { FlTaskRunner } from '../domain/fl-prediction/fl-task-runner';
import { ckdEsrdRiskFlPredictionSpec } from '../domain/fl-prediction/fl-prediction-task-spec';

const PV = '药物警戒';
const CKD = 'CKD 多中心疗效真实世界研究';

function contract(id: string, purpose: string, providerId: string): ContractView {
  return {
    id,
    purpose,
    retention: '阅后即焚',
    output: '仅聚合',
    validUntil: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    status: 'active',
    providerId,
    allowedLevels: ['L1', 'L1.5', 'L2', 'L3', 'L4'],
    allowedArtifacts: [
      'disproportionality',
      'effect_estimate',
      'hazard_ratio',
      'km_curve',
      'model_hash',
      'aggregate_metrics',
    ],
  };
}

function buildHospital(
  id: string,
  org: string,
  seed: number,
  patients: number,
  enrichCkd = false,
): HospitalNode & { store: LocalStore } {
  const audit = new AuditService();
  const deid = new Deidentifier();
  const store = new LocalStore(audit);
  const gateway = new FhirGateway();
  const rows = gateway.fromBundle(mockHospitalBundle(seed, patients)).map((r) => deid.deidentify(r));
  if (enrichCkd) {
    store.ingest(
      rows.map((r, i): InternalRecord => {
        const onDrug = i % 2 === 0;
        const alt = (Math.floor(i / 2) + seed) % 2 === 0;
        return {
          ...r,
          medications: onDrug ? ['目标药'] : ['对照药'],
          followUpDays: 180 + (i % 500),
          eventOccurred: (i + seed) % 7 === 0,
          conditions:
            (i + seed) % 5 === 0
              ? ['Chronic kidney disease stage 3 (disorder)']
              : r.conditions,
          adverseEvents: [
            ...(r.adverseEvents ?? []),
            ...(alt ? [{ organSystem: '肝', term: 'ALT升高', serious: false }] : []),
          ],
        };
      }),
    );
  } else {
    store.ingest(rows);
  }
  const scratch = new TaskScratch();
  const runner = new ConnectorTaskRunner(
    new PolicyEnforcementPoint(audit),
    new RwsExecutor(store, deid),
    new OutputGate(audit, deid),
    scratch,
    new RetentionEnforcer(scratch, audit),
  );
  return { id, org, runner, store };
}

async function runFlDemo(huashan: HospitalNode, ruijin: HospitalNode): Promise<void> {
  const spec = ckdEsrdRiskFlPredictionSpec();
  const audit = new AuditService();
  const pep = new PolicyEnforcementPoint(audit);

  const runSite = async (participantId: string, node: HospitalNode & { store: LocalStore }) => {
    const prev = process.env.CONNECTOR_PARTICIPANT_ID;
    process.env.CONNECTOR_PARTICIPANT_ID = participantId;
    const fl = new FlTaskRunner(pep, undefined, undefined, node.store, participantId);
    const c =
      participantId === 'p-huashan'
        ? contract('c-fl-h', CKD, 'p-huashan')
        : contract('c-fl-r', CKD, 'p-ruijin');
    c.dataProductId = participantId === 'p-huashan' ? 'dp-ckd-ehr' : 'dp-dkd-cohort';
    const out = await fl.run('fl-ckd-1', spec.purpose, spec, c);
    if (prev === undefined) delete process.env.CONNECTOR_PARTICIPANT_ID;
    else process.env.CONNECTOR_PARTICIPANT_ID = prev;
    return out;
  };

  const h = await runSite('p-huashan', huashan as HospitalNode & { store: LocalStore });
  const r = await runSite('p-ruijin', ruijin as HospitalNode & { store: LocalStore });
  console.log(`   · 华山 local AUC=${h.localMetrics.auc} dpApplied=${h.dpApplied}`);
  console.log(`   · 瑞金 local AUC=${r.localMetrics.auc} dpApplied=${r.dpApplied}`);
  console.log('   · 合并 modelHash/AUC 见 API fl-orchestrator');
}

async function main(): Promise<void> {
  console.log('\n=== Analytics Ladder E2E: 华山 + 瑞金 (组7.2) ===\n');

  const huashan = buildHospital('h-huashan', '华山医院', 7, 40, true);
  const ruijin = buildHospital('h-ruijin', '瑞金医院', 19, 30, true);
  const hospitals: HospitalNode[] = [huashan, ruijin];
  const contracts = new Map<string, ContractView>([
    ['h-huashan', contract('c-h', PV, 'p-huashan')],
    ['h-ruijin', contract('c-r', PV, 'p-ruijin')],
  ]);
  const orch = new RwsOrchestrator(new AuditService());

  const tte = {
    exposureArm: 'drug:目标药',
    comparatorArm: 'drug:对照药',
    timeZeroRule: 'index_date',
    inclusion: ['age>=18'],
    exclusion: [],
    outcome: { type: 'time_to_event' as const, event: 'renal_failure' },
  };

  console.log('1. L1.5 失衡信号 (disproportionality)');
  const l15 = orch.run(
    {
      taskId: 'ladder-l15',
      purpose: PV,
      analysis: { type: 'disproportionality', level: 'L1.5', drug: '注射用紫杉醇' },
      initiator: '恒瑞医药',
    },
    hospitals,
    contracts,
  );
  console.log(`   合并队列 n=${l15.merged.cohortSize}, buckets=${l15.merged.buckets.length}`);

  console.log('\n2. L2 比较效应 (comparative-effect + 本地效应量)');
  const l2 = orch.run(
    {
      taskId: 'ladder-l2',
      purpose: PV,
      analysis: {
        type: 'comparative-effect',
        level: 'L2',
        drug: '目标药',
        outcome: 'ALT升高',
        allowedArtifacts: ['effect_estimate'],
      },
      initiator: '恒瑞医药',
    },
    hospitals,
    contracts,
  );
  console.log(
    `   华山 β=${l2.perNode[0]?.aggregate.effectEstimate?.beta?.toFixed(3)} 瑞金 β=${l2.perNode[1]?.aggregate.effectEstimate?.beta?.toFixed(3)}`,
  );

  console.log('\n3. L3 因果 (causal-psm, TEE + echo agent)');
  const l3 = orch.run(
    {
      taskId: 'ladder-l3',
      purpose: PV,
      analysis: { type: 'causal-psm', level: 'L3', tte, allowedArtifacts: ['effect_estimate'] },
      initiator: '恒瑞医药',
    },
    hospitals,
    contracts,
  );
  console.log(
    `   华山 ATE=${l3.perNode[0]?.aggregate.effectEstimate?.beta} 瑞金 ATE=${l3.perNode[1]?.aggregate.effectEstimate?.beta}`,
  );

  console.log('\n4. L4 联邦预测 (federated_learning / CKD ESRD 风险)');
  await runFlDemo(huashan, ruijin);
  console.log('\n原始行级数据出域: 0 行');
  console.log('控制面 meta/存证: 见 apps/api e2e-huashan-ruijin.spec.ts\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
