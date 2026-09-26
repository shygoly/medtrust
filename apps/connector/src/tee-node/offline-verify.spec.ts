import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateSm2KeyPair, publicKeyFromPrivateKey } from '@medtrust/mdop';
import { NodeReceiptChain } from '../mdop/node/node-receipts';

/**
 * 节点产出物**离线核验**（任务 8.5 的「产出物可离线核验」那一半）：
 * 把节点回执链导出成文件，用仓库里的离线工具（`scripts/verify-receipt-chain.mjs`）在**不连平台**的情况下
 * 复算链的连续性与签名。改一条就要被工具抓出来并指出位置。
 */

const NODE = 'urn:tds:sh-med:participant:tee-1';
const SCRIPT = resolve(__dirname, '../../scripts/verify-receipt-chain.mjs');

function runScript(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('节点回执链的离线核验（任务 8.5）', () => {
  const keys = generateSm2KeyPair();

  function buildChain() {
    const chain = new NodeReceiptChain({ node: NODE, privateKey: keys.privateKey });
    chain.append({ jobId: 'job-1', stage: 'st-1', event: 'UNSEALED', opDigest: 'component:node@1' });
    chain.append({ jobId: 'job-1', stage: 'st-1', event: 'EXECUTED', opDigest: 'component:node@1' });
    chain.append({ jobId: 'job-1', stage: 'st-1', event: 'EXITED', opDigest: 'component:node-exit@1', label: 'C3' });
    chain.append({ jobId: 'job-1', stage: '__node__', event: 'PURGED', opDigest: 'component:node-purge@1' });
    return chain.list('job-1');
  }

  function writeFile(receipts: readonly unknown[]): string {
    const file = join(mkdtempSync(join(tmpdir(), 'tee-node-chain-')), 'receipts.json');
    writeFileSync(file, JSON.stringify({ receipts }));
    return file;
  }

  it('导出的链能被离线工具核过（含逐条验签），且链头与本地一致', () => {
    const receipts = buildChain();
    const file = writeFile(receipts);
    const out = runScript(['--receipts', file, '--pubkey', publicKeyFromPrivateKey(keys.privateKey)]);
    if (out.code !== 0) throw new Error(`离线工具退出码 ${out.code}：${out.out}`);
    expect(out.code).toBe(0);
    expect(out.out).toMatch(/ok|通过|valid/i);
  });

  it('链被改动 → 离线工具抓出断链并指出位置（退出码 1）', () => {
    const receipts = buildChain() as unknown as Array<Record<string, unknown>>;
    const tampered = receipts.map((r, i) => (i === 1 ? { ...r, output_digest: `sm3:${'9'.repeat(64)}` } : r));
    const file = writeFile(tampered);
    const out = runScript(['--receipts', file, '--pubkey', publicKeyFromPrivateKey(keys.privateKey)]);
    expect(out.code).toBe(1);
    expect(out.out).toMatch(/断链|broken|前序/);
  });

  it('换公钥验签 → 离线工具拒（回执不是该密钥签的）', () => {
    const receipts = buildChain();
    const file = writeFile(receipts);
    const other = generateSm2KeyPair();
    const out = runScript(['--receipts', file, '--pubkey', publicKeyFromPrivateKey(other.privateKey)]);
    expect(out.code).toBe(1);
  });
});
