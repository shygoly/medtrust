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
import { ContractView } from './contract-view';
import { InternalRecord } from './types';

function rec(organ: string): InternalRecord {
  return {
    subjectKey: 'sk_' + Math.random(),
    ageBand: '40-49',
    conditions: [],
    medications: ['注射用紫杉醇'],
    adverseEvents: [{ organSystem: organ, term: 't', serious: false }],
  };
}

// Builds a fully-wired hospital connector node with `count` on-drug patients,
// all with the same organ adverse event (so the cohort bucket is deterministic).
function node(id: string, org: string, count: number, organ: string): HospitalNode {
  const audit = new AuditService();
  const store = new LocalStore(audit);
  store.ingest(Array.from({ length: count }, () => rec(organ)));
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

const req = {
  taskId: 'rws-2041',
  purpose: '药物警戒',
  analysis: { type: 'adverse-event-signal' as const, drug: '注射用紫杉醇' },
  initiator: '恒瑞医药',
};

describe('RwsOrchestrator — 端到端编排 (6.2/6.3/6.4)', () => {
  it('6.2 does not dispatch to a target without an effective contract', async () => {
    const orch = new RwsOrchestrator(new AuditService());
    const a = node('h-a', '华山医院', 8, '肝胆系统');
    const b = node('h-b', '瑞金医院', 8, '肝胆系统');
    const contracts = new Map([['h-a', activeContract('c-a')]]); // no contract for h-b
    const out = await orch.run(req, [a, b], contracts);
    expect(out.dispatched).toEqual(['华山医院']);
    expect(out.skipped).toEqual([{ org: '瑞金医院', reason: '无生效合约' }]);
  });

  it('6.3 dispatches to authorized hospitals and merges gated aggregates', async () => {
    const orch = new RwsOrchestrator(new AuditService());
    const a = node('h-a', '华山医院', 8, '肝胆系统'); // 8 ≥ threshold 5 → not suppressed
    const b = node('h-b', '瑞金医院', 6, '肝胆系统');
    const contracts = new Map([
      ['h-a', activeContract('c-a')],
      ['h-b', activeContract('c-b')],
    ]);
    const out = await orch.run(req, [a, b], contracts);
    expect(out.dispatched).toEqual(['华山医院', '瑞金医院']);
    expect(out.merged.cohortSize).toBe(14);
    const liver = out.merged.buckets.find((x) => x.key === '肝胆系统')!;
    expect(liver.count).toBe(14); // 8 + 6, neither suppressed
  });

  it('6.4 attestation carries only hashes/metadata — no medical plaintext', async () => {
    const orch = new RwsOrchestrator(new AuditService());
    const a = node('h-a', '华山医院', 8, '肝胆系统');
    const out = await orch.run(req, [a], new Map([['h-a', activeContract('c-a')]]));
    const json = JSON.stringify(out.attestation);
    expect(out.attestation.taskHash).toMatch(/^SM3:/);
    expect(out.attestation.outputHash).toMatch(/^SM3:/);
    expect(json).not.toContain('subjectKey');
    expect(json).not.toContain('注射用紫杉醇');
    expect(json).not.toContain('肝胆系统');
  });
});
