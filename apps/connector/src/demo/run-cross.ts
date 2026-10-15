/* eslint-disable no-console */
// Cross-space RWS demo (space-interconnect 9.4/9.5): a pharma in space sh-med
// references a data product whose home space is bj-med (北京示范丁). The gateway
// resolves the home space, checks mutual trust, relays the task there; bj-med's
// connector executes locally and returns only the aggregate. Raw data never
// leaves bj-med.
//
// Run: pnpm --filter @medtrust/connector demo:cross
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { LocalStore } from '../domain/local-store';
import { RwsExecutor } from '../domain/rws-executor';
import { OutputGate } from '../domain/output-gate';
import { PolicyEnforcementPoint } from '../domain/policy-enforcement';
import { TaskScratch } from '../domain/task-scratch';
import { RetentionEnforcer } from '../domain/retention';
import { ConnectorTaskRunner } from '../domain/connector-task-runner';
import { FhirGateway } from '../domain/fhir-gateway';
import { RwsOrchestrator, HospitalNode } from '../domain/rws-orchestrator';
import { CrossSpaceGateway, makeSpaceExecutor } from '../domain/cross-space-gateway';
import { ContractView } from '../domain/contract-view';
import { mockHospitalBundle } from './mock-fhir';
import { createMdopRwsExecutor } from '../wiring/wire-mdop-rws';
import * as path from 'path';

function hospital(id: string, org: string, seed: number, n: number): HospitalNode {
  const audit = new AuditService();
  const deid = new Deidentifier();
  const store = new LocalStore(audit);
  store.ingest(new FhirGateway().fromBundle(mockHospitalBundle(seed, n)).map((r) => deid.deidentify(r)));
  const scratch = new TaskScratch();
  // 批次 2 迁移：分析走 MDOP 阶段链；闭合分类键由申请方声明（与示范医院标签集一致）。
  const executor = createMdopRwsExecutor({
    legacy: new RwsExecutor(store, deid),
    context: {
      spaceId: 'bj-med',
      participantId: id,
      dataProductId: `dp-${id}`,
      contractId: `c-${id}`,
      purpose: '药物警戒',
      minCell: 5,
      categoryKeys: ['肝胆系统', '血液系统', '胃肠系统', '神经系统'],
    },
    moduleDir: path.resolve(__dirname, '../../../../packages/wasm-algorithms/build'),
    withRows: (fn) => store.aggregateInternal({ origin: 'internal', actor: 'mdop-rws' }, fn as never),
    holder: `urn:tds:bj-med:participant:${id}`,
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

const contract = (id: string): ContractView => ({
  id, purpose: '药物警戒', retention: '阅后即焚', output: '仅聚合',
  validUntil: new Date(Date.now() + 90 * 86_400_000).toISOString(), status: 'active',
});

async function main(): Promise<void> {
  console.log('\n=== 跨空间 RWS:sh-med(创新药企)× bj-med(北京示范丁)===\n');

  // bj-med space with its own connector + contract + orchestrator
  const bjMed = makeSpaceExecutor(
    'bj-med',
    new RwsOrchestrator(new AuditService()),
    [hospital('cn-demohospd', '北京示范丁', 11, 50)],
    new Map([['cn-demohospd', contract('c-demohospd')]]),
  );

  const gw = new CrossSpaceGateway();
  gw.registerSpace(bjMed);
  gw.trustSpace('bj-med'); // 联邦互信握手

  const productUrn = 'urn:tds:bj-med:cardio-cohort';
  console.log(`1. 创新药企引用远端数据产品:${productUrn}`);
  const out = await gw.runCrossSpace(
    { taskId: 'rws-x1', purpose: '药物警戒', analysis: { type: 'adverse-event-signal', drug: '注射用紫杉醇' }, initiator: '创新药企' },
    productUrn,
  );

  console.log(`2. 网关解析归属空间:${out.homeSpace}(已互信)→ 下发到该空间本地执行`);
  console.log(`3. ${out.homeSpace} 本地执行,仅回传聚合(队列 n=${out.result.merged.cohortSize}):`);
  for (const b of out.result.merged.buckets) console.log(`     · ${b.key}: ${b.count} 例`);
  console.log(`4. 存证:taskHash=${out.result.attestation.taskHash}`);
  console.log(`\n跨空间传输的原始数据行数:${out.rawRowsCrossed}  ·  数据始终留在 ${out.homeSpace}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
