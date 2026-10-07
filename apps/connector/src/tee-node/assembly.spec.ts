import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSm2KeyPair, publicKeyFromPrivateKey } from '@medtrust/mdop';
import { createTrustedNodeAssembly, nodeRuntimeEnv } from './assembly';

/** 演练 KMS 的密钥表与信任根（开发替身；真实部署换成 remote KMS 客户端）。 */
function devKms(): {
  devKms: {
    privateKey: string;
    keys: Map<string, Uint8Array>;
    roots: Array<{ kind: 'tdx'; verifyQuoteDigest: (digest: string) => boolean }>;
  };
} {
  return {
    devKms: {
      privateKey: KEYS.privateKey,
      keys: new Map<string, Uint8Array>(),
      roots: [{ kind: 'tdx', verifyQuoteDigest: () => true }],
    },
  };
}

/**
 * 生产装配（任务 3.18）：把每块接成一个**可启动**的进程，且配置不全时**起不来**。
 *
 * 这一支的价值在于「接线错了会当场红」——此前每块都有用例，但没有任何东西保证它们被接上
 * （清单没应用、探针没跑、消息没派给路由器、合约副本没人存……都属于「每块都对、整条不通」）。
 */

const KEYS = generateSm2KeyPair();
const PLATFORM_KEYS = generateSm2KeyPair();
const REGISTRY_KEYS = generateSm2KeyPair();
const HOSP = 'urn:tds:sh-med:participant:p-huashan';

function tempFile(name: string, contents: string, mode?: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'tee-assembly-'));
  const file = join(dir, name);
  writeFileSync(file, contents, mode ? { mode } : undefined);
  return file;
}

/** 一份对齐齐全的节点部署配置（缺哪项由各用例自己删）。 */
function env(): Record<string, string> {
  return {
    TEE_NODE_PARTICIPANT_ID: 'tee-1',
    NODE_ENV: 'test',
    TEE_NODE_KEY_FILE: tempFile('node.key', KEYS.privateKey, 0o600),
    TEE_NODE_ATTESTATION_PROVIDER: 'software',
    TEE_NODE_KMS_MODE: 'local-dev',
    TEE_NODE_ALLOW_DEV_PROVIDERS: 'true',
    TEE_NODE_KMS_PUBKEY: publicKeyFromPrivateKey(KEYS.privateKey),
    TEE_NODE_CERT_FINGERPRINT: 'SM2:NODE',
    TEE_NODE_PLATFORM_PUBKEY: publicKeyFromPrivateKey(PLATFORM_KEYS.privateKey),
    TEE_NODE_REGISTRY_PUBKEY: publicKeyFromPrivateKey(REGISTRY_KEYS.privateKey),
    TEE_NODE_PARTICIPANT_KEYS_FILE: tempFile(
      'participants.json',
      JSON.stringify({ [HOSP]: publicKeyFromPrivateKey(KEYS.privateKey) }),
    ),
    TEE_NODE_MODULE_DIR: mkdtempSync(join(tmpdir(), 'tee-modules-')),
    TEE_NODE_MEASUREMENTS: `sm3:${'a'.repeat(64)}`,
    CONTROL_PLANE_URL: 'http://127.0.0.1:1/api/v1',
  };
}

async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T> | T): Promise<T> {
  const before = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    before.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('可信空间节点生产装配（任务 3.18）', () => {
  it('配置齐全 → 组装成功：运行循环、路由器、清单库、会话、制品与回执链都在', async () => {
    await withEnv(env(), () => {
      const assembly = createTrustedNodeAssembly({ providers: devKms() });
      expect(assembly.identity.urn).toBe('urn:tds:sh-med:participant:tee-1');
      expect(assembly.runtime.isRunning()).toBe(false); // 装配不等于启动
      expect(assembly.router).toBeDefined();
      expect(assembly.operators.manifestCount()).toBe(0); // 清单要等长轮询下发
      expect(assembly.receipts.list('job-1')).toHaveLength(0);
    });
  });

  /**
   * 2026-10-07 真机事故回归：节点重启后把已完成的阶段又跑了一遍。登记能落盘只是一半——
   * 它必须**真的被装配接上**（此前 `msg_id` 去重表就是「有实现、有用例、装配里没接」）。
   */
  it('已执行阶段登记接进了装配：重启后的进程从数据目录恢复它，重发的派发指令不再执行', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tee-assembly-state-'));
    writeFileSync(
      join(dataDir, 'node-state.json'),
      JSON.stringify({
        version: 1,
        receipts: [],
        artifacts: [],
        processed: [],
        executed: [
          {
            key: 'tkt-9:scri',
            jobId: 'job-9',
            at: new Date().toISOString(),
            statusReported: true,
            outcome: {
              label: 'C2',
              published: false,
              handle: 'art://urn:tds:sh-med:participant:tee-1/job-9/scri',
              digest: `sm3:${'4'.repeat(64)}`,
              witnesses: 1,
              receipts: 2,
              delivered: false,
            },
          },
        ],
      }),
      { mode: 0o600 },
    );
    await withEnv({ ...env(), TEE_NODE_DATA_DIR: dataDir }, async () => {
      const assembly = createTrustedNodeAssembly({ providers: devKms() });
      const dispatch = (stageId: string) =>
        assembly.router.handle({
          mdop: '0.2',
          msg_id: `m-${stageId}`,
          msg_type: 'StageDispatch',
          job_id: 'job-9',
          sender: 'urn:tds:sh-med:participant:platform',
          receiver: assembly.identity.urn,
          timestamp: new Date().toISOString(),
          nonce: `n-${stageId}`,
          idempotency_key: `job-9:${stageId}:1`,
          body: { ticket_id: 'tkt-9', stage_id: stageId, attempt: 1 },
          sig: { alg: 'SM2-SM3', kid: 'k', value: 'v' },
        } as never);
      // 已登记的阶段：直接回放（新进程内存里没有片段与凭证，也不需要）
      await expect(dispatch('scri')).resolves.toMatchObject({
        status: 'handled',
        detail: 'already-executed',
        outcome: { digest: `sm3:${'4'.repeat(64)}` },
      });
      // 没登记的阶段照旧走凭证校验（登记不是「放行一切」）
      await expect(dispatch('decTee')).rejects.toMatchObject({ code: 'E_TICKET_INVALID' });
    });
  });

  it('缺平台公钥 / 注册中心公钥 / 证书指纹 → 起不来（fail-closed，不留「先跑起来再说」）', async () => {
    const base = env();
    for (const key of [
      'TEE_NODE_PLATFORM_PUBKEY',
      'TEE_NODE_REGISTRY_PUBKEY',
      'TEE_NODE_CERT_FINGERPRINT',
    ]) {
      const vars = { ...base, [key]: '' };
      await withEnv(vars, () => {
        expect(() => createTrustedNodeAssembly()).toThrow();
      });
    }
  });

  it('软件提供者未显式开关 / 生产环境用软件提供者 → 起不来（配置闸门在装配期就生效）', async () => {
    const noDevSwitch = { ...env(), TEE_NODE_ALLOW_DEV_PROVIDERS: 'false' };
    await withEnv(noDevSwitch, () => {
      expect(() => createTrustedNodeAssembly()).toThrow(/TEE_NODE_ALLOW_DEV_PROVIDERS/);
    });
    const production = { ...env(), NODE_ENV: 'production' };
    await withEnv(production, () => {
      expect(() => createTrustedNodeAssembly()).toThrow(/生产环境/);
    });
  });

  it('运行时配置逐键直读：探针地址/度量/模块目录都来自部署配置', () => {
    const vars = {
      ...env(),
      TEE_NODE_VERIFIER_URL: ' https://verifier.example/attest ',
      TEE_NODE_MEASUREMENTS: ' sm3:aaa, sm3:bbb ',
      TEE_NODE_MODULE_DIR: ' /var/lib/tee-node/modules ',
    };
    return withEnv(vars, () => {
      const value = nodeRuntimeEnv();
      expect(value.verifierUrl).toBe('https://verifier.example/attest');
      expect(value.measurements).toEqual(['sm3:aaa', 'sm3:bbb']);
      expect(value.moduleDir).toBe('/var/lib/tee-node/modules');
      // 没配就不跑探针（不猜地址），度量缺省为空 = 不接受任何 C2 要约
      return withEnv({ TEE_NODE_VERIFIER_URL: '', TEE_NODE_MEASUREMENTS: '' }, () => {
        expect(nodeRuntimeEnv().verifierUrl).toBe('');
        expect(nodeRuntimeEnv().measurements).toEqual([]);
      });
    });
  });
});
