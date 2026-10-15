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
import { HeSecureAggregator } from './he-aggregator';
import { ContractView } from './contract-view';
import { InternalRecord } from './types';
import { createTestMdopExecutor } from '../test/mdop-local-executor';

const SCHEMA = ['神经系统', '血液系统', '胃肠系统', '肝胆系统'];

function rec(organ: string): InternalRecord {
  return {
    subjectKey: 'sk_' + Math.random(),
    ageBand: '40-49',
    conditions: [],
    medications: ['注射用紫杉醇'],
    adverseEvents: [{ organSystem: organ, term: 't', serious: false }],
  };
}

function node(id: string, org: string, count: number, organ: string): HospitalNode {
  const audit = new AuditService();
  const store = new LocalStore(audit);
  store.ingest(Array.from({ length: count }, () => rec(organ)));
  const deid = new Deidentifier();
  const runner = new ConnectorTaskRunner(
    new PolicyEnforcementPoint(audit),
    createTestMdopExecutor({ id, store, categoryKeys: SCHEMA, minCell: 1 }),
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
  taskId: 'rws-he-1',
  purpose: '药物警戒',
  analysis: { type: 'adverse-event-signal' as const, drug: '注射用紫杉醇' },
  initiator: '创新药企',
};

describe('RwsOrchestrator.runEncrypted — HE 跨院加密聚合编排', () => {
  let he: HeSecureAggregator;
  beforeAll(async () => {
    he = await HeSecureAggregator.create();
  }, 30000);

  it('center merges ciphertexts blind; only the consumer decrypts the cross-hospital sum', async () => {
    const { publicKey, secretKey } = he.generateKeys();
    const orch = new RwsOrchestrator(new AuditService());
    const a = node('h-a', '示范甲医院', 8, '肝胆系统');
    const b = node('h-b', '示范乙医院', 6, '血液系统');
    const contracts = new Map([
      ['h-a', activeContract('c-a')],
      ['h-b', activeContract('c-b')],
    ]);

    const out = await orch.runEncrypted(req, [a, b], contracts, he, publicKey, SCHEMA);

    expect(out.dispatched).toEqual(['示范甲医院', '示范乙医院']);
    // the orchestrator output is an opaque ciphertext, not plaintext counts
    expect(typeof out.mergedCiphertext).toBe('string');
    expect(out.mergedCiphertext.length).toBeGreaterThan(1000);

    // only the consumer can decrypt → cross-hospital sum, projected on schema
    const merged = he.decrypt(secretKey, out.mergedCiphertext, SCHEMA.length);
    expect(merged).toEqual([0, 6, 0, 8]); // 神经0 血液6 胃肠0 肝胆8
  });

  it('skips a hospital without an effective contract', async () => {
    const { publicKey } = he.generateKeys();
    const orch = new RwsOrchestrator(new AuditService());
    const a = node('h-a', '示范甲医院', 8, '肝胆系统');
    const b = node('h-b', '示范乙医院', 6, '肝胆系统');
    const out = await orch.runEncrypted(req, [a, b], new Map([['h-a', activeContract('c-a')]]), he, publicKey, SCHEMA);
    expect(out.dispatched).toEqual(['示范甲医院']);
    expect(out.skipped).toEqual([{ org: '示范乙医院', reason: '无生效合约' }]);
  });
});
