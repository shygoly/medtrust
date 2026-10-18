import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSm2KeyPair } from '@medtrust/mdop';
import { devKmsFromEnv } from './dev-kms';

function tmpFile(name: string, contents: string, mode = 0o600): string {
  const dir = mkdtempSync(join(tmpdir(), 'tee-dev-kms-'));
  const file = join(dir, name);
  writeFileSync(file, contents, { mode });
  return file;
}

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): Promise<T> {
  const before = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    before.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('本机演练 KMS 装配', () => {
  it('未显式配置密钥文件 → 返回 undefined，保持 fail-closed', async () => {
    await withEnv(
      { TEE_NODE_DEV_KMS_KEY_FILE: undefined, TEE_NODE_DEV_KMS_KEYS_FILE: undefined },
      () => expect(devKmsFromEnv()).toBeUndefined(),
    );
  });

  it('私钥与可选密钥表按部署配置装载；信任根恒为空', async () => {
    const pair = generateSm2KeyPair();
    const keyFile = tmpFile('kms.key', pair.privateKey);
    const keysFile = tmpFile('keys.json', JSON.stringify({ 'key-1': 'a'.repeat(64) }));
    await withEnv(
      { TEE_NODE_DEV_KMS_KEY_FILE: keyFile, TEE_NODE_DEV_KMS_KEYS_FILE: keysFile },
      () => {
        const out = devKmsFromEnv();
        expect(out?.privateKey).toBe(pair.privateKey);
        expect([...((out?.keys.get('key-1') ?? []) as Uint8Array)]).toEqual(
          new Array(32).fill(0xaa),
        );
        expect(out?.roots).toEqual([]);
      },
    );
  });

  it('私钥文件权限过宽 / 密钥长度不对 → 装配期拒绝', async () => {
    const pair = generateSm2KeyPair();
    const weak = tmpFile('weak.key', pair.privateKey, 0o644);
    const badKeys = tmpFile('bad-keys.json', JSON.stringify({ 'key-1': 'abcd' }));
    await withEnv(
      { TEE_NODE_DEV_KMS_KEY_FILE: weak, TEE_NODE_DEV_KMS_KEYS_FILE: undefined },
      () => expect(() => devKmsFromEnv()).toThrow(/0600/),
    );
    const good = tmpFile('good.key', pair.privateKey);
    await withEnv(
      { TEE_NODE_DEV_KMS_KEY_FILE: good, TEE_NODE_DEV_KMS_KEYS_FILE: badKeys },
      () => expect(() => devKmsFromEnv()).toThrow(/32 字节/),
    );
  });
});
