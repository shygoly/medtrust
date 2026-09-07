import { AuditService } from './audit';
import { Deidentifier } from './deidentifier';
import { LocalStore } from './local-store';
import { RwsExecutor } from './rws-executor';
import { PolicyEnforcementPoint } from './policy-enforcement';
import { OutputGate } from './output-gate';
import { TaskScratch } from './task-scratch';
import { RetentionEnforcer } from './retention';
import { ConnectorTaskRunner } from './connector-task-runner';
import { ContractView } from './contract-view';
import { InternalRecord } from './types';

function rec(): InternalRecord {
  return {
    subjectKey: 'sk_' + Math.random(),
    ageBand: '40-49',
    conditions: [],
    medications: ['注射用紫杉醇'],
    adverseEvents: [{ organSystem: '肝胆系统', term: 'ALT', serious: false }],
  };
}

function wire() {
  const audit = new AuditService();
  const scratch = new TaskScratch();
  const store = new LocalStore(audit);
  store.ingest([rec(), rec()]);
  const deid = new Deidentifier();
  const runner = new ConnectorTaskRunner(
    new PolicyEnforcementPoint(audit),
    new RwsExecutor(store, deid),
    new OutputGate(audit, deid),
    scratch,
    new RetentionEnforcer(scratch, audit),
  );
  return { runner, scratch, audit };
}

const contract = (retention: string): ContractView => ({
  id: 'c1',
  purpose: '药物警戒',
  retention,
  output: '仅聚合',
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  status: 'active',
});

const task = { taskId: 'rws-1', purpose: '药物警戒', analysis: { type: 'adverse-event-signal' as const, drug: '注射用紫杉醇' } };

describe('RetentionEnforcer — 留存约束强制 (4.5)', () => {
  it('阅后即焚: purges task intermediate data after the run', async () => {
    const { runner, scratch, audit } = wire();
    const result = await runner.run(task, contract('阅后即焚'));
    expect(result.cohortSize).toBe(2); // task still produced its aggregate
    expect(scratch.has('rws-1')).toBe(false); // intermediate destroyed
    expect(audit.all().some((e) => e.action === 'retention-purge')).toBe(true);
  });

  it('留存 90 天: keeps the intermediate data', async () => {
    const { runner, scratch } = wire();
    await runner.run(task, contract('结果留存 90 天'));
    expect(scratch.has('rws-1')).toBe(true);
  });
});
