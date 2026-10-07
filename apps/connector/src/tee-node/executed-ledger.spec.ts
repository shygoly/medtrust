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
