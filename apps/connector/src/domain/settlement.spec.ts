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
import { SettlementService } from './settlement';
import { ContractView, Pricing } from './contract-view';
import { InternalRecord } from './types';

describe('SettlementService — 按贡献分账 (value-settlement)', () => {
  const svc = new SettlementService();
  const contributions = [
    { org: '华山医院', contribution: 8 },
    { org: '瑞金医院', contribution: 6 },
  ];

  it('per-record: total = unit × Σ贡献, 各院 = unit × 自身贡献', () => {
    const r = svc.settle('t1', '创新药企', { model: 'per-record', amount: 10, currency: 'CNY' }, contributions);
    expect(r.total).toBe(140);
    expect(r.lines.map((l) => l.amount)).toEqual([80, 60]);
  });

  it('per-task: 固定费按贡献占比拆分,收益占比 = 贡献占比', () => {
    const r = svc.settle('t1', '创新药企', { model: 'per-task', amount: 1400, currency: 'CNY' }, contributions);
    expect(r.total).toBe(1400);
    expect(r.lines.map((l) => l.amount)).toEqual([800, 600]);
    // 收益占比 800/600 == 贡献占比 8/6
    expect(r.lines[0].amount / r.lines[1].amount).toBeCloseTo(8 / 6, 5);
  });

  it('subscription: 无单次计费', () => {
    const r = svc.settle('t1', '创新药企', { model: 'subscription', amount: 0, currency: 'CNY' }, contributions);
    expect(r.total).toBe(0);
    expect(r.lines.every((l) => l.amount === 0)).toBe(true);
  });
});

// —— orchestrator integration ——
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
const contract = (id: string, pricing?: Pricing): ContractView => ({
  id,
  purpose: '药物警戒',
  retention: '阅后即焚',
  output: '仅聚合',
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  status: 'active',
  pricing,
});
const req = { taskId: 'rws-s1', purpose: '药物警戒', analysis: { type: 'adverse-event-signal' as const, drug: '注射用紫杉醇' }, initiator: '创新药企' };

describe('RwsOrchestrator — 结算接入编排', () => {
  it('合约含计价 → 按 cohortSize 自动分账', async () => {
    const orch = new RwsOrchestrator(new AuditService());
    const a = node('h-a', '华山医院', 8);
    const b = node('h-b', '瑞金医院', 6);
    const pricing: Pricing = { model: 'per-record', amount: 10, currency: 'CNY' };
    const out = await orch.run(req, [a, b], new Map([['h-a', contract('c-a', pricing)], ['h-b', contract('c-b', pricing)]]));
    expect(out.settlement).toBeDefined();
    expect(out.settlement!.total).toBe(140); // 10 × (8+6)
    expect(out.settlement!.lines.find((l) => l.org === '华山医院')!.amount).toBe(80);
    expect(out.settlement!.hash).toMatch(/^SM3:/);
  });

  it('合约无计价 → 不产生结算', async () => {
    const orch = new RwsOrchestrator(new AuditService());
    const a = node('h-a', '华山医院', 8);
    const out = await orch.run(req, [a], new Map([['h-a', contract('c-a')]]));
    expect(out.settlement).toBeUndefined();
  });
});
