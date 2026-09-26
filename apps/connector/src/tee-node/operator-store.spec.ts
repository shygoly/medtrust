import {
  generateSm2KeyPair,
  parseOperatorManifest,
  publicKeyKid,
  signCanonicalObject,
  signRevocationList,
  type OperatorManifest,
} from '@medtrust/mdop';
import { NodeOperatorNotAllowedError, NodeOperatorStore, nodeOperatorEnv } from './operator-store';

/**
 * 节点侧算子清单 / 吊销 / 模块库（任务 3.12g）。
 *
 * 没有这一层，节点复核会把每一个阶段都以「算子清单未同步」拒掉——链一步也走不动。
 * 要钉住的判据（与连接器同口径）：清单用**注册中心公钥**验签、吊销名单用**平台节点公钥**验签
 * 且版本单调、**未同步到有效吊销名单就拒绝执行 wasm**、模块字节必须**本地有**。
 */

const REGISTRY = generateSm2KeyPair();
const PLATFORM = generateSm2KeyPair();
const OTHER = generateSm2KeyPair();

const MODULE_SM3 = `sm3:${'a'.repeat(64)}`;
const REVOKED_SM3 = `sm3:${'b'.repeat(64)}`;

function manifest(over: Partial<{ digest: string; kind: string }> = {}): OperatorManifest {
  return parseOperatorManifest({
    apiVersion: 'mdop/v1',
    kind: over.kind ?? 'wasm',
    id: 'rws.paired-cohort',
    version: '1.0.0',
    category: 'collab',
    digest: over.digest ?? MODULE_SM3,
    publisher: 'urn:tds:sh-med:operator-registry',
    inputs: [
      { name: 'left', schema: 'mdop.projection@1', accept_labels: ['C2'] },
      { name: 'right', schema: 'mdop.projection@1', accept_labels: ['C2'] },
    ],
    outputs: [{ name: 'paired', schema: 'rws.paired-cohort@1', label_rule: 'inherit' }],
    params: {},
    environments: ['tee'],
    security: { network: 'none' },
    build: { source_digest: `sm3:${'7'.repeat(64)}`, toolchain: 'asc@0.27.37', reproducible: true },
  });
}

function entry(over: { manifest?: OperatorManifest; signWith?: { privateKey: string; publicKey: string } } = {}) {
  const m = over.manifest ?? manifest();
  const key = over.signWith ?? REGISTRY;
  return {
    ref: `${m.id}@${m.version}`,
    digest: m.digest,
    manifest: m as unknown as Record<string, unknown>,
    signature: signCanonicalObject(m, key.privateKey, { publicKey: key.publicKey }),
  };
}

function revocations(over: { version?: number; revoked?: string[]; signWith?: { privateKey: string; publicKey: string } } = {}) {
  const key = over.signWith ?? PLATFORM;
  const body = {
    version: over.version ?? 1,
    issued_at: '2026-09-25T10:00:00.000Z',
    revoked_digests: over.revoked ?? [REVOKED_SM3],
  };
  return signRevocationList(body, key.privateKey, key.publicKey);
}

function store(over: { moduleBytes?: Map<string, Uint8Array>; registryKey?: string } = {}) {
  return new NodeOperatorStore({
    registryPublicKey: over.registryKey ?? REGISTRY.publicKey,
    platformPublicKey: PLATFORM.publicKey,
    moduleBytes: (digest) => over.moduleBytes?.get(digest),
  });
}

describe('节点算子清单 / 吊销 / 模块库（任务 3.12g）', () => {
  it('注册中心签名有效才采纳；换密钥或被篡改的清单丢弃（fail-closed）', () => {
    const s = store();
    expect(s.applyManifests([entry()])).toBe(1);
    expect(s.manifestFor('rws.paired-cohort@1.0.0')?.digest).toBe(MODULE_SM3);

    // 用别的密钥签 → 丢弃
    expect(s.applyManifests([entry({ signWith: OTHER })])).toBe(0);
    // 签名有效但条目声明的摘要与清单不符（想「换摘要挂别的字节」）→ 丢弃
    const tampered = { ...entry(), digest: REVOKED_SM3 };
    expect(s.applyManifests([tampered])).toBe(0);
    // 没配注册中心公钥 → 一条都不采纳
    expect(store({ registryKey: '' }).applyManifests([entry()])).toBe(0);
  });

  it('吊销名单：平台签名有效 + 版本单调才采纳；回退与坏签名拒收', () => {
    const s = store();
    expect(s.applyRevocations(revocations({ version: 2 }))).toBe(true);
    expect(s.hasValidRevocations()).toBe(true);
    // 版本回退 → 拒（继续用本地版本）
    expect(s.applyRevocations(revocations({ version: 1 }))).toBe(false);
    // 同版本但内容不同 → 拒
    expect(s.applyRevocations(revocations({ version: 2, revoked: [`sm3:${'c'.repeat(64)}`] }))).toBe(false);
    // 坏签名 → 拒
    expect(s.applyRevocations(revocations({ version: 3, signWith: OTHER }))).toBe(false);
  });

  it('wasm 执行闸门：无有效吊销名单先拒；被吊销拒；本地没有字节拒；齐全才通过', () => {
    const bytes = new Map([[MODULE_SM3.replace(/^sm3:/, ''), new Uint8Array([0, 97, 115, 109])]]);
    const s = store({ moduleBytes: bytes });
    s.applyManifests([entry()]);
    // ① 还没同步吊销名单 → 即使有清单与字节也拒（与连接器同口径）
    expect(() => s.assertExecutable({ op: 'rws.paired-cohort@1.0.0', digest: MODULE_SM3, kind: 'wasm' })).toThrow(
      expect.objectContaining({ code: 'E_REVOCATION_UNSYNCED' }),
    );
    // ② 同步后通过
    s.applyRevocations(revocations({ revoked: [] }));
    expect(() =>
      s.assertExecutable({ op: 'rws.paired-cohort@1.0.0', digest: MODULE_SM3, kind: 'wasm' }),
    ).not.toThrow();
    // ③ 被吊销 → 拒（吊销名单里的 `sm3:<hex>` 与裸 hex 都要归一后比）
    s.applyRevocations(revocations({ version: 2, revoked: [MODULE_SM3] }));
    expect(() =>
      s.assertExecutable({ op: 'rws.paired-cohort@1.0.0', digest: MODULE_SM3, kind: 'wasm' }),
    ).toThrow(expect.objectContaining({ code: 'E_OP_REVOKED' }));
    // ④ 本地模块库没有这个摘要的字节 → 拒（不现取平台）
    s.applyRevocations(revocations({ version: 3, revoked: [] }));
    expect(() =>
      s.assertExecutable({
        op: 'rws.paired-cohort@1.0.0',
        digest: `sm3:${'f'.repeat(64)}`,
        kind: 'wasm',
      }),
    ).toThrow(NodeOperatorNotAllowedError);
  });

  it('system 算子只判清单（吊销名单与模块库只对 wasm 生效）', () => {
    const systemEntry = entry({
      manifest: parseOperatorManifest({
        apiVersion: 'mdop/v0.2',
        kind: 'system',
        id: 'declassify.small_cell',
        version: '1.0.0',
        category: 'declassify',
        digest: 'component:node-publication-review@1',
        publisher: 'urn:tds:platform',
        inputs: [],
        outputs: [{ name: 'o', schema: 'mdop.table/1.0', label_rule: 'C3' }],
        params: {},
        environments: ['tee'],
        security: { network: 'none' },
        component: 'node-publication-review@1.0.0',
      }),
    });
    const s = store();
    expect(s.applyManifests([systemEntry])).toBe(1);
    expect(() =>
      s.assertExecutable({ op: 'declassify.small_cell@1.0.0', digest: 'component:x@1', kind: 'system' }),
    ).not.toThrow();
    // 没清单的算子 → 拒
    expect(() =>
      s.assertExecutable({ op: 'rws.unknown@1.0.0', digest: MODULE_SM3, kind: 'wasm' }),
    ).toThrow(expect.objectContaining({ code: 'E_OP_NOT_WHITELISTED' }));
    // kid 与部署公钥不符的清单也不能用（换公钥顶替）
    const s2 = new NodeOperatorStore({
      registryPublicKey: OTHER.publicKey,
      platformPublicKey: PLATFORM.publicKey,
    });
    expect(s2.applyManifests([{ ...entry(), signature: { ...entry().signature, kid: publicKeyKid(OTHER.publicKey) } }])).toBe(0);
  });

  it('注册中心公钥来自部署配置：逐键直读，未配置即空（不取默认值、不取消息）', () => {
    const before = process.env.TEE_NODE_REGISTRY_PUBKEY;
    try {
      process.env.TEE_NODE_REGISTRY_PUBKEY = ` ${REGISTRY.publicKey} `;
      expect(nodeOperatorEnv().registryPublicKey).toBe(REGISTRY.publicKey);
      delete process.env.TEE_NODE_REGISTRY_PUBKEY;
      expect(nodeOperatorEnv().registryPublicKey).toBe('');
    } finally {
      if (before === undefined) delete process.env.TEE_NODE_REGISTRY_PUBKEY;
      else process.env.TEE_NODE_REGISTRY_PUBKEY = before;
    }
  });
});
