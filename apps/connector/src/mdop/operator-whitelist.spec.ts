import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateSm2KeyPair,
  parseOperatorManifest,
  signRevocationList,
  signCanonicalObject,
} from '@medtrust/mdop';
import {
  MdopOperatorWhitelistStore,
  OperatorNotAllowedError,
  normalizeDigest,
} from './operator-whitelist';

/** 极简内存仓库（create/save/find/findOne/delete）。 */
function memRepo(pkField: string) {
  const rows: any[] = [];
  const matches = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => r[k] === v);
  return {
    create: (x: any) => ({ ...x }),
    save: async (x: any) => {
      const arr = Array.isArray(x) ? x : [x];
      for (const item of arr) {
        const idx = rows.findIndex((r) => r[pkField] === item[pkField]);
        if (idx >= 0) rows[idx] = { ...rows[idx], ...item };
        else rows.push(item);
      }
      return x;
    },
    find: async (opts?: any) => (opts?.where ? rows.filter((r) => matches(r, opts.where)) : [...rows]),
    findOne: async (opts: any) => rows.find((r) => matches(r, opts?.where)) ?? null,
    delete: async (where: any) => {
      let affected = 0;
      for (let i = rows.length - 1; i >= 0; i--)
        if (matches(rows[i], where)) {
          rows.splice(i, 1);
          affected++;
        }
      return { affected };
    },
  } as any;
}

const WASM = 'a'.repeat(64);
const OTHER_WASM = 'c'.repeat(64);

function build(platformKey?: string) {
  return new MdopOperatorWhitelistStore(memRepo('digest'), memRepo('id'), {
    ...(platformKey
      ? { platformPublicKeyOverrides: { 'platform-node': platformKey, registry: platformKey } }
      : {}),
  });
}

describe('连接器本地算子白名单与吊销状态（D-MDOP-5 / 任务 6.3-6.4）', () => {
  const platformNode = generateSm2KeyPair();
  const registry = generateSm2KeyPair();

  beforeEach(() => {
    // 白名单/吊销都用同一把 override 公钥：这里分别构造两个 store，互不干扰
    delete process.env.CONNECTOR_PLATFORM_NODE_PUBKEY;
    delete process.env.CONNECTOR_REGISTRY_PUBKEY;
  });

  const signedList = (over: Record<string, unknown> = {}, keys = platformNode) =>
    signRevocationList(
      {
        version: 1,
        issued_at: '2026-09-24T00:00:00.000Z',
        revoked_digests: [],
        ...over,
      },
      keys.privateKey,
      keys.publicKey,
    );

  it('白名单缺省为空：未加白的算子一律拒（缺省不执行任何算子）', async () => {
    const store = build(platformNode.publicKey);
    await expect(store.assertExecutable(WASM)).rejects.toMatchObject({
      code: 'E_OP_NOT_WHITELISTED',
    });
  });

  it('已加白但尚未同步吊销名单 → 拒绝执行 wasm（重启后同理）', async () => {
    const store = build(platformNode.publicKey);
    await store.add(WASM, '张主任');
    await expect(store.assertExecutable(WASM)).rejects.toMatchObject({
      code: 'E_REVOCATION_UNSYNCED',
    });
  });

  it('收到有效吊销名单后放行；被吊销的摘要立刻拒', async () => {
    const store = build(platformNode.publicKey);
    await store.add(WASM, '张主任');
    expect(await store.applyRevocationList(signedList())).toBe(true);
    await expect(store.assertExecutable(WASM)).resolves.toBeUndefined();

    expect(
      await store.applyRevocationList(signedList({ version: 2, revoked_digests: [WASM] })),
    ).toBe(true);
    await expect(store.assertExecutable(WASM)).rejects.toMatchObject({ code: 'E_OP_REVOKED' });
  });

  it('吊销名单版本回退被拒（继续用本地版本）', async () => {
    const store = build(platformNode.publicKey);
    await store.applyRevocationList(signedList({ version: 5 }));
    expect(await store.applyRevocationList(signedList({ version: 4 }))).toBe(false);
    expect(await store.hasValidRevocationList()).toBe(true);
  });

  it('吊销名单验签失败即拒（用别的密钥签的名单不算数）', async () => {
    const attacker = generateSm2KeyPair();
    const store = build(platformNode.publicKey);
    expect(await store.applyRevocationList(signedList({}, attacker))).toBe(false);
    expect(await store.hasValidRevocationList()).toBe(false);
  });

  it('未配置平台节点公钥 → 吊销名单拒收（fail-closed）', async () => {
    const store = new MdopOperatorWhitelistStore(memRepo('digest'), memRepo('id'), {});
    expect(await store.applyRevocationList(signedList())).toBe(false);
  });

  it('算子清单：注册中心公钥验签通过才收下；换别的密钥签的清单被丢弃', async () => {
    const manifest = parseOperatorManifest({
      apiVersion: 'mdop/v0.2',
      kind: 'system',
      id: 'source.dataset',
      version: '1.0.0',
      category: 'source',
      digest: 'component:connector-datasource@1',
      publisher: 'urn:tds:platform',
      inputs: [],
      outputs: [{ name: 'o', schema: 's', label_rule: 'inherit' }],
      params: {},
      environments: ['plain'],
      security: { network: 'none' },
      component: 'connector-datasource@1.0.0',
    });
    const good = signCanonicalObject(manifest, registry.privateKey, {
      publicKey: registry.publicKey,
    });
    const store = build(registry.publicKey);
    expect(
      await store.applyOperatorManifests([
        { ref: 'source.dataset@1.0.0', digest: manifest.digest, manifest, signature: good },
      ]),
    ).toBe(1);
    expect(store.manifestFor('source.dataset@1.0.0')).toBeDefined();

    const attacker = generateSm2KeyPair();
    const forged = signCanonicalObject(manifest, attacker.privateKey, {
      publicKey: attacker.publicKey,
    });
    const store2 = build(registry.publicKey);
    expect(
      await store2.applyOperatorManifests([
        { ref: 'source.dataset@1.0.0', digest: manifest.digest, manifest, signature: forged },
      ]),
    ).toBe(0);
    expect(store2.manifestFor('source.dataset@1.0.0')).toBeUndefined();
  });

  it('平台消息无法给算子加白：收清单不改白名单', async () => {
    const store = build(registry.publicKey);
    const manifest = parseOperatorManifest({
      apiVersion: 'mdop/v0.2',
      kind: 'system',
      id: 'source.dataset',
      version: '1.0.0',
      category: 'source',
      digest: 'component:connector-datasource@1',
      publisher: 'urn:tds:platform',
      inputs: [],
      outputs: [{ name: 'o', schema: 's', label_rule: 'inherit' }],
      params: {},
      environments: ['plain'],
      security: { network: 'none' },
      component: 'connector-datasource@1.0.0',
    });
    await store.applyOperatorManifests([
      {
        ref: 'source.dataset@1.0.0',
        digest: manifest.digest,
        manifest,
        signature: signCanonicalObject(manifest, registry.privateKey, {
          publicKey: registry.publicKey,
        }),
      },
    ]);
    // 清单收下了，但白名单仍然是空的 —— 走平台消息这条路加不了白
    expect(await store.list()).toHaveLength(0);
    await expect(store.assertExecutable(manifest.digest, 'system')).rejects.toMatchObject({
      code: 'E_OP_NOT_WHITELISTED',
    });
  });

  it('system 算子只看白名单（不需要吊销名单）', async () => {
    const store = build(platformNode.publicKey);
    await store.add('source.dataset@1.0.0', '张主任', { kind: 'system' });
    await expect(store.assertExecutable('source.dataset@1.0.0', 'system')).resolves.toBeUndefined();
  });

  it('白名单可移除；摘要归一化接受 sm3: 前缀与大小写', async () => {
    const store = build(platformNode.publicKey);
    await store.add(`sm3:${WASM.toUpperCase()}`, '张主任');
    expect(await store.isWhitelisted(WASM)).toBe(true);
    await store.remove(WASM);
    expect(await store.isWhitelisted(WASM)).toBe(false);
    expect(() => normalizeDigest('')).toThrow();
    expect(normalizeDigest('sm3:' + WASM.toUpperCase())).toBe(WASM);
  });

  it('能力通告：运行时/白名单摘要如实上报，TEE 与协同协议本期为空', async () => {
    const store = build(platformNode.publicKey);
    await store.add(WASM, '张主任');
    await store.add('source.dataset@1.0.0', '张主任', { kind: 'system' });
    const cap = await store.capabilityAdvertise();
    expect(cap.runtime).toEqual(['native', 'wasm']);
    expect(cap.system_ops).toEqual(['source.dataset@1.0.0', 'declassify.small_cell@1.0.0']);
    expect(cap.whitelist_digests.sort()).toEqual([WASM, 'source.dataset@1.0.0'].sort());
    // 如实标注：本期没有硬件 TEE，也没有协同协议（不得据此声称 TEE attestation）
    expect(cap.tee).toBeNull();
    expect(cap.protocols).toEqual([]);
  });

  it('能力通告的 tee 恒为 null：连接器不是可信空间节点（任务 6.3，设计意图而非待办）', async () => {
    const store = build(platformNode.publicKey);
    const cap = await store.capabilityAdvertise();
    expect(cap.tee).toBeNull();
    // C2 能力因此恒不可用：连接器不会被当作 C2 目标
    expect(MdopOperatorWhitelistStore.supportsLabel(cap, 'C2')).toBe(false);

    // 且**不存在**「配一下就能让连接器声明 TEE」的路径：源码里不读任何 TEE 类配置。
    // （用源码断言而不是设假环境变量——后者会往 DEPLOY.md 的环境变量对拍里塞不存在的键。）
    const src = readFileSync(join(__dirname, 'operator-whitelist.ts'), 'utf8');
    expect(src).not.toMatch(/process\.env\.\w*TEE\w*/);
    expect(src).toContain('tee: null');
  });

  it('OperatorNotAllowedError 的错误码与协议一致', async () => {
    const store = build(platformNode.publicKey);
    await expect(store.assertExecutable(OTHER_WASM)).rejects.toBeInstanceOf(OperatorNotAllowedError);
  });
});
