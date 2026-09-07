/* eslint-disable no-console */
/**
 * AMR Sentinel — 联邦 Q2（小细胞抑制反转）端到端演示。
 *
 * 叙事（PROPOSAL §4）：「单院压制、联邦解锁」
 *   · 华山 rare_colistin_r_aba 本地 n < minCell → OutputGate 抑制
 *   · 瑞金同表型 n ≥ minCell → 可单独出域
 *   · 联邦合并后罕见表型可发布（瑞金贡献主导；华山单独发不出）
 *
 * Prereq:
 *   python3 scripts/amr/generate_synthetic.py --n-per-hospital 5000
 *   python3 scripts/amr/build_amr_connectors.py
 *
 * Run: pnpm --filter @medtrust/connector demo:amr-q2
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

type HospitalNodeWithMeta = HospitalNode & {
  store: LocalStore;
  recordCount: number;
  rawRare: number;
};

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
  const rawRare = loaded.records.filter((r) => r.conditions.includes(RARE_KEY)).length;

  const scratch = new TaskScratch();
  const runner = new ConnectorTaskRunner(
    new PolicyEnforcementPoint(audit),
    new RwsExecutor(store, deid),
    new OutputGate(audit, deid),
    scratch,
    new RetentionEnforcer(scratch, audit),
  );
  return {
    id,
    org,
    runner,
    store,
    recordCount: loaded.records.length,
    rawRare,
  };
}

function rareBucket(agg: AggregateResult): { count: number; suppressed?: boolean } | undefined {
  const b = agg.buckets.find((x) => x.key === RARE_KEY);
  if (!b) return undefined;
  return { count: b.count, suppressed: b.suppressed };
}

async function main(): Promise<void> {
  const manifestPath = path.join(REPO, 'data/synthetic/amr/connectors/manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('Missing data/synthetic/amr/connectors/manifest.json');
    console.error('Run: python3 scripts/amr/build_amr_connectors.py');
    process.exit(1);
  }

  console.log('=== AMR Sentinel · 联邦 Q2（小细胞抑制反转）===\n');
  console.log(`表型: ${RARE_KEY} · 闸门 minCell=${MIN_CELL}\n`);

  const huashan = buildHospitalFromAmr('p-huashan', '华山医院', 'huashan');
  const ruijin = buildHospitalFromAmr('p-ruijin', '瑞金医院', 'ruijin');

  console.log('1. 各院本地罕见表型原始计数（闸门前）');
  console.log(`   · 华山 raw ${RARE_KEY}=${huashan.rawRare}`);
  console.log(`   · 瑞金 raw ${RARE_KEY}=${ruijin.rawRare}`);
  console.log(`   · 合计 raw=${huashan.rawRare + ruijin.rawRare}`);

  const bothUnder =
    huashan.rawRare > 0 &&
    huashan.rawRare < MIN_CELL &&
    ruijin.rawRare > 0 &&
    ruijin.rawRare < MIN_CELL;
  const asymmetric =
    huashan.rawRare > 0 &&
    huashan.rawRare < MIN_CELL &&
    ruijin.rawRare >= MIN_CELL;

  if (!bothUnder && !asymmetric) {
    throw new Error(
      `rare counts incompatible with Q2 narratives: hs=${huashan.rawRare} rj=${ruijin.rawRare}`,
    );
  }
  if (bothUnder) {
    console.log(`\n模式: 双院皆压 (0 < n < ${MIN_CELL}) — gate-then-merge 应丢信号；解锁见 demo:amr-q2-unlock`);
  } else {
    console.log(`\n模式: 非对称 — 华山压制 / 瑞金可发`);
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

  const orch = new RwsOrchestrator(new AuditService());
  const result = await orch.run(
    {
      taskId: 'rws-amr-q2-small-cell',
      purpose: AMR_PURPOSE,
      analysis: { type: 'condition-prevalence', level: 'L1' },
      initiator: 'p-meddata',
    },
    [huashan, ruijin],
    contracts,
  );

  console.log(`\n2. 单院过闸后（连接器 OutputGate，再交给编排合并）`);
  for (const p of result.perNode) {
    const rare = rareBucket(p.aggregate);
    const label =
      rare == null
        ? '缺失'
        : rare.suppressed || rare.count === 0
          ? `抑制 count=${rare.count} suppressed=${Boolean(rare.suppressed)}`
          : `可发 count=${rare.count}`;
    console.log(`   · ${p.org}: ${RARE_KEY} → ${label}`);
  }

  const hs = result.perNode.find((p) => p.org === '华山医院');
  const rj = result.perNode.find((p) => p.org === '瑞金医院');
  const hsRare = hs ? rareBucket(hs.aggregate) : undefined;
  const rjRare = rj ? rareBucket(rj.aggregate) : undefined;
  const mergedRare = rareBucket(result.merged);

  console.log(`\n3. 联邦合并 n=${result.merged.cohortSize}`);
  console.log(`   · ${RARE_KEY} merged count=${mergedRare?.count ?? 0}`);

  if (bothUnder) {
    if (!hsRare?.suppressed || hsRare.count !== 0) {
      throw new Error(`华山应抑制: ${JSON.stringify(hsRare)}`);
    }
    if (!rjRare?.suppressed || rjRare.count !== 0) {
      throw new Error(`瑞金应抑制: ${JSON.stringify(rjRare)}`);
    }
    if ((mergedRare?.count ?? 0) >= MIN_CELL) {
      throw new Error('gate-then-merge 不应保留双院皆压的 rare 信号');
    }
    console.log('\n叙事核对: 双院皆压 ✓ · gate-then-merge 丢信号 ✓');
    console.log('提示: 合并解锁请运行 pnpm --filter @medtrust/connector demo:amr-q2-unlock');
  } else {
    if (!hsRare || hsRare.count !== 0 || !hsRare.suppressed) {
      throw new Error(`华山过闸后应抑制 ${RARE_KEY}，实际 ${JSON.stringify(hsRare)}`);
    }
    if (!rjRare || rjRare.count < MIN_CELL || rjRare.suppressed) {
      throw new Error(`瑞金过闸后应可发 ${RARE_KEY}，实际 ${JSON.stringify(rjRare)}`);
    }
    if (!mergedRare || mergedRare.count < MIN_CELL) {
      throw new Error(`联邦合并后 ${RARE_KEY} 应可发，实际 ${JSON.stringify(mergedRare)}`);
    }
    console.log('\n叙事核对: 华山压制 ✓ · 瑞金可发 ✓ · 联邦仍可发 ✓');
  }

  console.log(`\n4. 存证 taskHash=${result.attestation.taskHash.slice(0, 18)}…`);
  console.log('联邦 Q2 PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
