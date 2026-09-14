import { AuditService } from './audit';
import { Deidentifier } from './deidentifier';
import { LocalStore } from './local-store';
import { RwsExecutor } from './rws-executor';
import { OutputGate } from './output-gate';
import { PolicyEnforcementPoint } from './policy-enforcement';
import { TaskScratch } from './task-scratch';
import { RetentionEnforcer } from './retention';
import { ConnectorTaskRunner } from './connector-task-runner';
import { RwsOrchestrator, HospitalNode } from './rws-orchestrator';
import { CrossSpaceGateway, makeSpaceExecutor } from './cross-space-gateway';
import { ContractView } from './contract-view';
import { InternalRecord } from './types';

function rec(): InternalRecord {
  return {
    subjectKey: 'sk_' + Math.random(),
    ageBand: '40-49',
    conditions: [],
    medications: ['注射用紫杉醇'],
    adverseEvents: [{ organSystem: '肝胆系统', term: 't', serious: false }],
  };
}
function node(id: string, org: string, count: number): HospitalNode {
  const audit = new AuditService();
  const store = new LocalStore(audit);
  store.ingest(Array.from({ length: count }, () => rec()));
  const deid = new Deidentifier();
  const runner = new ConnectorTaskRunner(
    new PolicyEnforcementPoint(audit),
    new RwsExecutor(store, deid),
    new OutputGate(audit, deid),
    new TaskScratch(),
    new RetentionEnforcer(new TaskScratch(), audit),
  );
  return { id, org, runner };
}
const activeContract = (id: string): ContractView => ({
  id,
  purpose: '药物警戒',
  retention: '阅后即焚',
  output: '仅聚合',
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  status: 'active',
});

// a peer space (bj-med) with one hospital connector
function bjMedSpace() {
  const orch = new RwsOrchestrator(new AuditService());
  const nodes = [node('cn-xiehe', '北京协和', 12)];
  const contracts = new Map([['cn-xiehe', activeContract('c-xiehe')]]);
  return makeSpaceExecutor('bj-med', orch, nodes, contracts);
}

const req = {
  taskId: 'rws-x1',
  purpose: '药物警戒',
  analysis: { type: 'adverse-event-signal' as const, drug: '注射用紫杉醇' },
  initiator: '创新药企',
};

describe('CrossSpaceGateway — 跨空间任务执行 (9.4/9.5)', () => {
  it('relays to the product home space; data stays there, only the aggregate returns', async () => {
    const gw = new CrossSpaceGateway();
    gw.registerSpace(bjMedSpace());
    gw.trustSpace('bj-med');

    const out = await gw.runCrossSpace(req, 'urn:tds:bj-med:r1');
    expect(out.homeSpace).toBe('bj-med');
    expect(out.rawRowsCrossed).toBe(0);
    expect(out.result.dispatched).toEqual(['北京协和']);
    expect(out.result.merged.cohortSize).toBe(12);
    // the returned result carries no row-level data
    expect(JSON.stringify(out.result)).not.toContain('subjectKey');
  });

  it('refuses to relay to a space that is not mutually trusted', async () => {
    const gw = new CrossSpaceGateway();
    gw.registerSpace(bjMedSpace()); // reachable but not trusted
    await expect(gw.runCrossSpace(req, 'urn:tds:bj-med:r1')).rejects.toThrow(/未互信/);
  });

  it('rejects an illegal product URN', async () => {
    const gw = new CrossSpaceGateway();
    await expect(gw.runCrossSpace(req, 'not-a-urn')).rejects.toThrow(/非法/);
  });
});
