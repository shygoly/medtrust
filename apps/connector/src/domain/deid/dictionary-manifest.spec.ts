// 词表清单接收侧：验签 / kid / 载荷口径 / 时效 / 版本单调 / 吊销（Phase 2）。
import {
  deidDictionarySignaturePayload,
  generateSm2KeyPair,
  publicKeyFromPrivateKey,
  publicKeyKid,
  sm2Sign,
} from '@medtrust/mdop';
import { sm3Hex } from '../sm3';
import {
  DeidDictionaryRejected,
  DeidDictionaryStore,
  verifyDeidDictionaryManifest,
  type DeidDictionaryRevocationList,
} from './dictionary-manifest';

const KEYS = generateSm2KeyPair();
const PUB = KEYS.publicKey;
const KID = publicKeyKid(PUB);

function manifest(over: Record<string, unknown> = {}, privateKey = KEYS.privateKey) {
  const sm3 = (over.sm3 as string) ?? sm3Hex('deid:cn-names:v2\n张三\n李四\n');
  return {
    dictionaryId: 'deid:cn-names',
    version: 2,
    sm3,
    byteSize: 4096,
    keyId: publicKeyKid(publicKeyFromPrivateKey(privateKey)),
    issuedAt: new Date(Date.now() - 1000).toISOString(),
    notAfter: new Date(Date.now() + 86_400_000).toISOString(),
    signature: sm2Sign(deidDictionarySignaturePayload(sm3), privateKey, {
      publicKey: publicKeyFromPrivateKey(privateKey),
    }),
    signaturePayload: deidDictionarySignaturePayload(sm3),
    ...over,
  };
}

describe('verifyDeidDictionaryManifest', () => {
  it('接受平台用注册中心密钥签出的清单', () => {
    const stored = verifyDeidDictionaryManifest(manifest(), new Date(), PUB);
    expect(stored.ref).toBe('deid:cn-names:v2');
    expect(stored.version).toBe(2);
  });

  it('没配置注册中心公钥 → 拒', () => {
    expect(() => verifyDeidDictionaryManifest(manifest(), new Date(), '')).toThrow(
      /DICTIONARY_KEY_NOT_CONFIGURED/,
    );
  });

  it('kid 不是部署固定的那把 → 拒', () => {
    const other = generateSm2KeyPair();
    const forged = manifest({}, other.privateKey);
    expect(() => verifyDeidDictionaryManifest(forged, new Date(), PUB)).toThrow(
      /DICTIONARY_KEY_ID_MISMATCH/,
    );
  });

  it('签名对不上（用错密钥）→ 拒', () => {
    const other = generateSm2KeyPair();
    const forged = manifest({ keyId: KID }, other.privateKey);
    expect(() => verifyDeidDictionaryManifest(forged, new Date(), PUB)).toThrow(
      /DICTIONARY_SIGNATURE_INVALID|DICTIONARY_KEY_ID_MISMATCH/,
    );
  });

  it('签名载荷口径被换成规格前缀 → 拒', () => {
    const pkg = manifest();
    pkg.signaturePayload = `medtrust.deid-spec.v1:${pkg.sm3}`;
    expect(() => verifyDeidDictionaryManifest(pkg, new Date(), PUB)).toThrow(
      /DICTIONARY_SIGNATURE_PAYLOAD_MISMATCH/,
    );
  });

  it('形状非法 / 体量越界 → 拒', () => {
    expect(() => verifyDeidDictionaryManifest({}, new Date(), PUB)).toThrow(
      /DICTIONARY_SHAPE_INVALID/,
    );
    expect(() =>
      verifyDeidDictionaryManifest(manifest({ byteSize: 64 * 1024 * 1024 }), new Date(), PUB),
    ).toThrow(/DICTIONARY_SHAPE_INVALID/);
  });

  it('过期 → 拒', () => {
    expect(() =>
      verifyDeidDictionaryManifest(
        manifest({ notAfter: new Date(Date.now() - 1000).toISOString() }),
        new Date(),
        PUB,
      ),
    ).toThrow(/DICTIONARY_EXPIRED/);
  });
});

describe('DeidDictionaryStore', () => {
  const revokedList = (version: number, sm3: string): DeidDictionaryRevocationList => ({
    version,
    issuedAt: new Date().toISOString(),
    revoked: [
      {
        dictionaryId: 'deid:cn-names',
        version: 2,
        sm3,
        reason: '词表撤回',
        revokedAt: new Date().toISOString(),
        revokedBy: 'compliance-01',
      },
    ],
  });

  it('装载后可 require；同版本重发幂等', () => {
    const store = new DeidDictionaryStore();
    expect(store.applyManifests([manifest()], PUB).applied).toEqual(['deid:cn-names:v2']);
    expect(store.applyManifests([manifest()], PUB).applied).toEqual([]);
    expect(store.require('deid:cn-names:v2').version).toBe(2);
  });

  it('本地只有旧版本时，引用更高版本的规格失败（旧清单不能顶替）', () => {
    const store = new DeidDictionaryStore();
    store.applyManifests([manifest()], PUB);
    expect(() => store.require('deid:cn-names:v9')).toThrow(/DICTIONARY_NOT_AVAILABLE/);
  });

  it('低版本回放 → 拒（版本单调）', () => {
    const store = new DeidDictionaryStore();
    store.applyManifests([manifest()], PUB);
    const stale = store.applyManifests([manifest({ version: 1 })], PUB);
    expect(stale.rejected[0]?.code).toBe('DICTIONARY_VERSION_STALE');
    expect(store.require('deid:cn-names:v2').version).toBe(2);
  });

  it('没有清单时 require 直接拒（默认 fail-closed）', () => {
    const store = new DeidDictionaryStore();
    expect(() => store.require('deid:cn-names:v2')).toThrow(DeidDictionaryRejected);
  });

  it('ref 形态非法 → 拒', () => {
    const store = new DeidDictionaryStore();
    expect(() => store.require('deid:cn-names')).toThrow(/DICTIONARY_SHAPE_INVALID/);
  });

  it('吊销命中即从本地清掉，require 失败', () => {
    const store = new DeidDictionaryStore();
    const pkg = manifest();
    store.applyManifests([pkg], PUB);
    expect(store.applyRevocationList(revokedList(1, String(pkg.sm3)))).toBe(true);
    expect(store.list()).toHaveLength(0);
    expect(() => store.require('deid:cn-names:v2')).toThrow(/DICTIONARY_NOT_AVAILABLE/);
  });

  it('吊销名单版本只增不减：旧名单回放无效', () => {
    const store = new DeidDictionaryStore();
    expect(store.applyRevocationList(revokedList(2, 'a'.repeat(64)))).toBe(true);
    expect(store.applyRevocationList(revokedList(1, 'b'.repeat(64)))).toBe(false);
    expect(store.currentRevocationVersion()).toBe(2);
  });

  it('坏清单不影响同批其它清单', () => {
    const store = new DeidDictionaryStore();
    const good = manifest();
    const broken = { ...manifest({ version: 3 }), signature: 'deadbeef' };
    const outcome = store.applyManifests([good, broken], PUB);
    expect(outcome.applied).toEqual(['deid:cn-names:v2']);
    expect(outcome.rejected).toHaveLength(1);
  });

  it('过期清单即使已装载也不可用', () => {
    let clock = new Date();
    const store = new DeidDictionaryStore(() => clock);
    store.applyManifests([manifest({ notAfter: new Date(Date.now() + 60_000).toISOString() })], PUB);
    clock = new Date(Date.now() + 2 * 86_400_000);
    expect(() => store.require('deid:cn-names:v2')).toThrow(/DICTIONARY_EXPIRED/);
  });
});
