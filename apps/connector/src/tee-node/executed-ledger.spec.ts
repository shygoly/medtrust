import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSm2KeyPair } from '@medtrust/mdop';
import { NodeArtifactStore } from '../mdop/node/node-artifacts';
import { NodeReceiptChain } from '../mdop/node/node-receipts';
import { EXECUTED_STAGE_TTL_MS, NodeExecutedStages } from './executed-ledger';
import { NODE_STATE_VERSION, NodeStateFile, NodeStateStore } from './persist';
import type { NodeStageOutcome } from './stage-dispatch';

/**
 * 已执行阶段登记的落盘与恢复（2026-10-07 真机事故回归）：节点重启后，平台重发的同一份
 * `StageDispatch` 不得把已完成的阶段整段重跑（再要一次密钥、再扣一次预算、换一个摘要覆盖已交付的 C3）。
 */

const NODE = 'urn:tds:sh-med:participant:tee-node-a';
const keys = generateSm2KeyPair();
const OUTCOME: NodeStageOutcome = {
  label: 'C3',
  published: true,
  handle: `art://${NODE}/job-1/decTee`,
  digest: `sm3:${'4'.repeat(64)}`,
  witnesses: 0,
  receipts: 3,
  delivered: true,
};

const dir = () => mkdtempSync(join(tmpdir(), 'tee-node-executed-'));
const stores = () => ({
  receipts: new NodeReceiptChain({ node: NODE, privateKey: keys.privateKey }),
  artifacts: new NodeArtifactStore({ node: NODE, privateKey: keys.privateKey }),
});

describe('已执行阶段登记（节点重启后不重跑）', () => {
  it('落盘 → 重启恢复：登记原样回来（含「状态尚未送达」这一位）', () => {
    const d = dir();
    const ledger = new NodeExecutedStages();
    ledger.record({ key: 'tkt-1:scri', jobId: 'job-1', outcome: { ...OUTCOME, label: 'C2' }, statusReported: true });
    ledger.record({ key: 'tkt-1:decTee', jobId: 'job-1', outcome: OUTCOME, statusReported: false });
    new NodeStateStore(new NodeStateFile({ dir: d }), { ...stores(), executed: ledger }).persist();

    // 「重启」：全新的内存登记，从同一个目录 hydrate
    const fresh = new NodeExecutedStages();
    const restored = new NodeStateStore(new NodeStateFile({ dir: d }), { ...stores(), executed: fresh });
    restored.hydrate();
    expect(fresh.size()).toBe(2);
    expect(fresh.get('tkt-1:scri')).toMatchObject({ jobId: 'job-1', statusReported: true });
    expect(fresh.get('tkt-1:decTee')).toMatchObject({
      statusReported: false,
      outcome: { digest: OUTCOME.digest, label: 'C3', delivered: true },
    });

    // 状态文件里只有摘要与标识：没有任何制品内容
    const onDisk = JSON.parse(readFileSync(join(d, 'node-state.json'), 'utf8'));
    expect(onDisk.version).toBe(NODE_STATE_VERSION);
    expect(Object.keys(onDisk.executed[0].outcome).sort()).toEqual(
      ['delivered', 'digest', 'handle', 'label', 'published', 'receipts', 'witnesses'].sort(),
    );
  });

  it('旧状态文件（没有登记字段）照常读入；没接登记的调用方落盘时不抹掉盘上已有的登记', () => {
    const d = dir();
    const file = new NodeStateFile({ dir: d });
    // 升级前的状态文件：只有三个字段
    writeFileSync(
      file.path(),
      JSON.stringify({ version: NODE_STATE_VERSION, receipts: [], artifacts: [], processed: [] }),
      { mode: 0o600 },
    );
    const ledger = new NodeExecutedStages();
    const store = new NodeStateStore(file, { ...stores(), executed: ledger });
    expect(() => store.hydrate()).not.toThrow();
    expect(ledger.size()).toBe(0);

    ledger.record({ key: 'tkt-1:scri', jobId: 'job-1', outcome: OUTCOME, statusReported: true });
    store.persist();
    // 只导出回执的命令行等调用方不接登记：它落盘时登记必须还在
    new NodeStateStore(file, stores()).persist();
    expect(JSON.parse(readFileSync(file.path(), 'utf8')).executed).toHaveLength(1);
  });

  it('欠着的上报随登记落盘并原样恢复；送达一项划掉一项，落盘的是当时的快照；全部送达后不再留这个字段', () => {
    const d = dir();
    const ledger = new NodeExecutedStages();
    const ref = {
      stage: { id: 'decTee', op: 'declassify.small_cell@1.0.0', op_digest: 'component:x@1', output_schema: 'mdop.table/1.0' },
      handle: OUTCOME.handle,
      label: 'C3' as const,
      digest: OUTCOME.digest,
      expiresAt: '2026-10-10T10:00:00.000Z',
    };
    const pending = { handle: ref, delivery: ref, receipts: true };
    ledger.record({
      key: 'tkt-1:decTee',
      jobId: 'job-1',
      credentialId: 'tkt-1',
      outcome: OUTCOME,
      statusReported: false,
      pending,
    });
    const store = new NodeStateStore(new NodeStateFile({ dir: d }), { ...stores(), executed: ledger });
    store.persist();

    // 「进程被杀」：新进程读回来的欠账与落盘那一刻一致
    const fresh = new NodeExecutedStages();
    new NodeStateStore(new NodeStateFile({ dir: d }), { ...stores(), executed: fresh }).hydrate();
    expect(fresh.get('tkt-1:decTee')).toMatchObject({
      credentialId: 'tkt-1',
      statusReported: false,
      pending: { handle: { handle: OUTCOME.handle }, delivery: { digest: OUTCOME.digest }, receipts: true },
    });

    // 句柄登记送达 → 划掉 → 落盘只剩两项；之前读回去的那份快照不跟着变
    delete (pending as { handle?: unknown }).handle;
    store.persist();
    const onDisk = () => JSON.parse(readFileSync(join(d, 'node-state.json'), 'utf8')).executed[0];
    expect(Object.keys(onDisk().pending).sort()).toEqual(['delivery', 'receipts']);
    expect(fresh.get('tkt-1:decTee')?.pending?.handle).toBeDefined();

    delete (pending as { delivery?: unknown }).delivery;
    delete (pending as { receipts?: unknown }).receipts;
    store.persist();
    expect(onDisk().pending).toBeUndefined();
  });

  it('作业销毁：它名下的欠账一律作废（见证本体一并丢掉）并打上 purged；别的作业不受影响', () => {
    const ledger = new NodeExecutedStages();
    const witness = { job_id: 'job-1', key_id: 'k-1' } as never;
    ledger.record({
      key: 'tkt-1:scri',
      jobId: 'job-1',
      outcome: OUTCOME,
      statusReported: false,
      pending: { witnesses: [witness], receipts: true },
    });
    ledger.record({
      key: 'tkt-2:scri',
      jobId: 'job-2',
      outcome: OUTCOME,
      statusReported: false,
      pending: { receipts: true },
    });
    expect(ledger.markJobPurged('job-1')).toBe(1);
    expect(ledger.get('tkt-1:scri')).toMatchObject({ purged: true, statusReported: false });
    expect(ledger.get('tkt-1:scri')?.pending).toBeUndefined();
    expect(ledger.get('tkt-2:scri')?.pending).toEqual({ receipts: true });
    // 销毁标记要过得了重启：否则重启后的进程会把「已销毁的作业」当成「只差一条成功状态」
    const fresh = new NodeExecutedStages();
    fresh.import(ledger.dump());
    expect(fresh.get('tkt-1:scri')?.purged).toBe(true);
    expect(JSON.stringify(ledger.dump())).not.toContain('k-1');
  });

  it('过了保留期（与制品同为 72 小时）的登记不再落盘、也不再恢复；形状不对的条目不当成「已执行」', () => {
    const ledger = new NodeExecutedStages();
    const t0 = new Date('2026-10-07T10:00:00.000Z');
    ledger.record({ key: 'tkt-old:scri', jobId: 'job-old', outcome: OUTCOME, statusReported: true, now: t0 });
    const later = new Date(t0.getTime() + EXECUTED_STAGE_TTL_MS + 1);
    ledger.record({ key: 'tkt-new:scri', jobId: 'job-new', outcome: OUTCOME, statusReported: true, now: later });
    const dumped = ledger.dump(later);
    expect(dumped.map((e) => e.key)).toEqual(['tkt-new:scri']);
    expect(ledger.get('tkt-old:scri')).toBeUndefined();

    const fresh = new NodeExecutedStages();
    const loaded = fresh.import(
      [
        { key: 'tkt-old:scri', jobId: 'job-old', at: t0.toISOString(), outcome: OUTCOME, statusReported: true },
        ...dumped,
        { key: 'broken', jobId: 'job-x', at: later.toISOString(), outcome: {} as NodeStageOutcome, statusReported: true },
      ],
      later,
    );
    expect(loaded).toBe(1);
    expect(fresh.get('broken')).toBeUndefined();
  });
});
