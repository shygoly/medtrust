import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateSm2KeyPair, publicKeyFromPrivateKey } from '@medtrust/mdop';
import { NodeArtifactStore } from '../mdop/node/node-artifacts';
import { NodeReceiptChain } from '../mdop/node/node-receipts';
import { NODE_STATE_VERSION, NodeStateFile, NodeStateStore, emptyNodeState } from './persist';

/**
 * 节点本地状态的落盘与恢复（任务 3.16）。
 *
 * 三条要证明的事：① 权限（目录 0700 / 文件 0600）与**原子写**；② 重启后**回执链与制品都还在**
 * 且链仍能逐条验签；③ 去重表带 TTL、不会被每次 persist 刷新；④ 导出文件能被**离线工具**核过。
 */

const NODE = 'urn:tds:sh-med:participant:tee-1';
const SCRIPT = resolve(__dirname, '../../scripts/verify-receipt-chain.mjs');
const keys = generateSm2KeyPair();

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'tee-node-state-'));
}

function chainWith(events: Array<'UNSEALED' | 'EXECUTED'> = ['UNSEALED', 'EXECUTED']) {
  const chain = new NodeReceiptChain({ node: NODE, privateKey: keys.privateKey });
  for (const event of events)
    chain.append({ jobId: 'job-1', stage: 'st-1', event, opDigest: 'component:node@1' });
  return chain;
}

describe('节点本地状态落盘（任务 3.16）', () => {
  it('落盘：目录 0700、文件 0600、原子写（临时文件不残留）', () => {
    const d = dir();
    const file = new NodeStateFile({ dir: d });
    const artifacts = new NodeArtifactStore({ node: NODE, privateKey: keys.privateKey });
    artifacts.put({
      handle: 'art://n/job-1/st-1',
      jobId: 'job-1',
      label: 'C3',
      digest: `sm3:${'a'.repeat(64)}`,
      payload: { analysisType: 'cohort-count', buckets: [] },
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const store = new NodeStateStore(file, { receipts: chainWith(), artifacts, processed: new Set(['m-1']) });
    expect(store.persist().processed).toBe(1);

    expect(statSync(d).mode & 0o777).toBe(0o700);
    expect(statSync(file.path()).mode & 0o777).toBe(0o600);
    // 临时文件已 rename 掉（不存在半份状态）
    expect(() => statSync(`${file.path()}.tmp`)).toThrow();
    expect(JSON.parse(readFileSync(file.path(), 'utf8')).version).toBe(NODE_STATE_VERSION);
  });

  it('重启恢复：回执链原序回来且仍能逐条验签；制品句柄仍可读', () => {
    const d = dir();
    const file = new NodeStateFile({ dir: d });
    const originalChain = chainWith();
    const originalArtifacts = new NodeArtifactStore({ node: NODE, privateKey: keys.privateKey });
    originalArtifacts.put({
      handle: 'art://n/job-1/st-1',
      jobId: 'job-1',
      label: 'C3',
      digest: `sm3:${'b'.repeat(64)}`,
      payload: { cohortSize: 42, buckets: [{ key: 'all', count: 42 }] },
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    new NodeStateStore(file, { receipts: originalChain, artifacts: originalArtifacts }).persist();

    // 「重启」：全新的内存 store，从同一个目录 hydrate
    const freshChain = new NodeReceiptChain({ node: NODE, privateKey: keys.privateKey });
    const freshArtifacts = new NodeArtifactStore({ node: NODE, privateKey: keys.privateKey });
    const freshProcessed = new Set<string>();
    const restored = new NodeStateStore(file, {
      receipts: freshChain,
      artifacts: freshArtifacts,
      processed: freshProcessed,
    }).hydrate();

    expect(restored).toEqual({ receipts: 2, artifacts: 1, processed: 0 });
    expect(freshChain.list('job-1').map((r) => r.event)).toEqual(['UNSEALED', 'EXECUTED']);
    expect(freshChain.verify('job-1', publicKeyFromPrivateKey(keys.privateKey))).toEqual({ valid: true });
    expect(freshChain.head('job-1')).toBe(originalChain.head('job-1'));
    expect(freshArtifacts.read('art://n/job-1/st-1')?.payload).toMatchObject({ cohortSize: 42 });
  });

  it('销毁必须覆盖**临时盘**：purge 后落盘快照里不再有该制品与载荷（重启也复活不了）', () => {
    const d = dir();
    const file = new NodeStateFile({ dir: d });
    const artifacts = new NodeArtifactStore({ node: NODE, privateKey: keys.privateKey });
    const MARKER = 'SENTINEL-PAYLOAD-9f2c';
    artifacts.put({
      handle: 'art://n/job-1/c3',
      jobId: 'job-1',
      label: 'C3',
      digest: `sm3:${'c'.repeat(64)}`,
      payload: { note: MARKER, buckets: [{ key: 'all', count: 7 }] },
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const store = new NodeStateStore(file, { receipts: chainWith(), artifacts });
    store.persist();
    // 前提确认：未销毁时载荷**确实**在盘上（否则这个用例什么都没证明）
    expect(readFileSync(file.path(), 'utf8')).toContain(MARKER);

    // 销毁（内存侧）→ 由调用方落盘（部署路径里由 node-messages 的 PurgeOrder 处理器调用 persist）
    const receipt = artifacts.purge({ jobId: 'job-1', reason: 'purge-order', idempotencyKey: 'p-1' });
    expect(receipt.handles).toEqual(['art://n/job-1/c3']);
    store.persist();

    // 盘上不再有载荷；句柄读不到；「重启」也复活不了
    expect(readFileSync(file.path(), 'utf8')).not.toContain(MARKER);
    expect(artifacts.read('art://n/job-1/c3')).toBeNull();
    const freshArtifacts = new NodeArtifactStore({ node: NODE, privateKey: keys.privateKey });
    const restored = new NodeStateStore(file, { receipts: chainWith(), artifacts: freshArtifacts }).hydrate();
    expect(restored.artifacts).toBe(0);
    expect(freshArtifacts.read('art://n/job-1/c3')).toBeNull();
  });

  it('去重表带 TTL：过期条目在 persist 时清掉，且不会因为反复 persist 而续期', () => {
    const d = dir();
    let now = new Date('2026-09-25T10:00:00.000Z');
    const file = new NodeStateFile({ dir: d, processedTtlMs: 3_600_000, now: () => now });
    const processed = new Set(['m-old', 'm-new']);
    // 手工写入：m-old 已经超过 TTL，m-new 还新
    writeFileSync(
      file.path(),
      JSON.stringify({
        ...emptyNodeState(),
        processed: [
          { id: 'm-old', at: '2026-09-25T08:00:00.000Z' },
          { id: 'm-new', at: '2026-09-25T09:59:00.000Z' },
        ],
      }),
    );
    const store = new NodeStateStore(file, { receipts: chainWith([]), artifacts: new NodeArtifactStore({ node: NODE, privateKey: keys.privateKey }), processed });
    store.hydrate();
    expect(processed.size).toBe(2);
    const out = store.persist();
    expect(out).toEqual({ processed: 1, removed: 1 });
    expect([...processed]).toEqual(['m-old', 'm-new']); // 内存集合不动，落盘的才是清理结果

    const saved = JSON.parse(readFileSync(file.path(), 'utf8'));
    expect(saved.processed.map((p: { id: string }) => p.id)).toEqual(['m-new']);

    // 时间再往前走一点：m-new 仍然没过期（说明 persist 没有把它「续期」到当前时间之后看不见的地方）
    now = new Date('2026-09-25T10:30:00.000Z');
    const out2 = store.persist();
    expect(out2.removed).toBe(0);
  });

  it('状态文件非法 → 拒绝启动（不把历史悄悄当空）', () => {
    const d = dir();
    const file = new NodeStateFile({ dir: d });
    writeFileSync(file.path(), '{not json');
    expect(() => file.load()).toThrow(/不是合法 JSON/);
    writeFileSync(file.path(), JSON.stringify({ version: 99 }));
    expect(() => file.load()).toThrow(/版本不符/);
  });

  it('从节点**自己的一手链**导出的文件能被离线工具核过', () => {
    const d = dir();
    const file = new NodeStateFile({ dir: d });
    const chain = chainWith();
    new NodeStateStore(file, {
      receipts: chain,
      artifacts: new NodeArtifactStore({ node: NODE, privateKey: keys.privateKey }),
    }).persist();

    // 导出成离线工具的输入形状
    const state = JSON.parse(readFileSync(file.path(), 'utf8'));
    const exportFile = join(d, 'receipts.json');
    writeFileSync(
      exportFile,
      JSON.stringify({ receipts: state.receipts.flatMap((r: { receipts: unknown[] }) => r.receipts) }),
    );
    const out = execFileSync(
      'node',
      [SCRIPT, '--receipts', exportFile, '--pubkey', publicKeyFromPrivateKey(keys.privateKey)],
      { encoding: 'utf8' },
    );
    expect(out).toMatch(/通过|valid|ok/i);
    expect(out).toMatch(/链连续/);
  });
});
