// 脱敏规格包：验签 / 摘要 / kid / 时效 / 版本单调 / 吊销（connector-agent-deidentification）。
//
// 这里覆盖的是"连接器凭什么相信一份规格"的全部判据 —— 每一条都必须有负例，
// 否则 fail-closed 只是写在文档里的一句话。
import {
  deidSpecSignaturePayload,
  generateSm2KeyPair,
  publicKeyFromPrivateKey,
  publicKeyKid,
  sm2Sign,
  type DeidSpec,
} from '@medtrust/mdop';
import { stableStringify } from '../canonical-json';
import { sm3Hex } from '../sm3';
import {
  DeidSpecRejected,
  DeidSpecStore,
  verifySignedDeidSpec,
  type SignedDeidSpec,
} from './spec-package';

const KEYS = generateSm2KeyPair();
const PUB = KEYS.publicKey;
const KID = publicKeyKid(PUB);

function spec(): DeidSpec {
  return {
    version: 1,
    id: 'deid.ckd.v3',
    scope: { product: 'urn:tds:sp:ckd-cohort', level: 'C0_internal' },
    transforms: [
      { field: 'patientId', op: 'hmac_pseudonym', params: { saltRef: 'hosp-kms:ckd', outLen: 32 } },
      { field: 'name', op: 'drop' },
      { field: 'birthDate', op: 'generalize', params: { to: 'age_band_10' } },
      { field: 'labValue', op: 'keep' },
    ],
    quasiIdentifierPolicy: { k: 5, suppressIfBelow: true, columns: ['ageBand', 'sex'] },
    denyIfTransformMissing: ['patientId', 'name'],
  };
}

function packageOf(
  body: DeidSpec = spec(),
  overrides: Partial<SignedDeidSpec> = {},
  privateKey: string = KEYS.privateKey,
): SignedDeidSpec {
  const specJson = stableStringify(body);
  const specSm3 = sm3Hex(specJson);
  const keyId = publicKeyKid(publicKeyFromPrivateKey(privateKey));
  return {
    specId: body.id,
    version: 1,
    specJson,
    specSm3,
    signature: sm2Sign(deidSpecSignaturePayload(specSm3), privateKey, {
      publicKey: publicKeyFromPrivateKey(privateKey),
    }),
    keyId,
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    notAfter: new Date(Date.now() + 86_400_000).toISOString(),
    signaturePayload: deidSpecSignaturePayload(specSm3),
    ...overrides,
  };
}

describe('verifySignedDeidSpec —— 平台签发规格的接收判据', () => {
  it('接受平台用注册中心密钥签出的规格', () => {
    const stored = verifySignedDeidSpec(packageOf(), new Date(), PUB);
    expect(stored.specId).toBe('deid.ckd.v3');
    expect(stored.version).toBe(1);
    expect(stored.specSm3).toBe(sm3Hex(stableStringify(spec())));
  });

  it('没有配置注册中心公钥 → 拒（fail-closed，不是"跳过验签"）', () => {
    expect(() => verifySignedDeidSpec(packageOf(), new Date(), '')).toThrow(
      /SPEC_KEY_NOT_CONFIGURED/,
    );
  });

  it('规格内容被改过（摘要不符）→ 拒', () => {
    const tampered = packageOf();
    const mutated = { ...spec(), id: 'deid.ckd.v3' } as DeidSpec;
    tampered.specJson = stableStringify({
      ...mutated,
      transforms: [...mutated.transforms, { field: 'phone', op: 'keep' }],
    });
    expect(() => verifySignedDeidSpec(tampered, new Date(), PUB)).toThrow(
      /SPEC_SM3_MISMATCH/,
    );
  });

  it('别人（非注册中心密钥）签的规格 → 拒', () => {
    const other = generateSm2KeyPair();
    const forged = packageOf(spec(), { keyId: publicKeyKid(other.publicKey) }, other.privateKey);
    expect(() => verifySignedDeidSpec(forged, new Date(), PUB)).toThrow(
      /SPEC_KEY_ID_MISMATCH/,
    );
  });

  it('kid 伪装成正确的、但签名对不上 → 拒', () => {
    const other = generateSm2KeyPair();
    const forged = packageOf(spec(), { keyId: KID }, other.privateKey);
    expect(() => verifySignedDeidSpec(forged, new Date(), PUB)).toThrow(
      /SPEC_SIGNATURE_INVALID|SPEC_KEY_ID_MISMATCH/,
    );
  });

  it('签名载荷口径漂移（前缀不一致）→ 拒', () => {
    const pkg = packageOf();
    pkg.signaturePayload = `medtrust.algorithm-module.v1:${pkg.specSm3}`;
    expect(() => verifySignedDeidSpec(pkg, new Date(), PUB)).toThrow(
      /SPEC_SIGNATURE_PAYLOAD_MISMATCH/,
    );
  });

  it('规格本体越界（k<5）→ 拒（签名对也不行：schema 是硬边界）', () => {
    const bad = { ...spec(), quasiIdentifierPolicy: { k: 1, suppressIfBelow: true, columns: [] } };
    const pkg = packageOf(bad as DeidSpec);
    expect(() => verifySignedDeidSpec(pkg, new Date(), PUB)).toThrow(/SPEC_SCHEMA_INVALID/);
  });

  it('过期 → 拒', () => {
    const pkg = packageOf(spec(), { notAfter: new Date(Date.now() - 1000).toISOString() });
    expect(() => verifySignedDeidSpec(pkg, new Date(), PUB)).toThrow(/SPEC_EXPIRED/);
  });

  it('形状非法 → 拒', () => {
    expect(() => verifySignedDeidSpec({ specId: 'x' }, new Date(), PUB)).toThrow(
      /SPEC_SHAPE_INVALID/,
    );
  });

  it('包内 specId 与规格 id 不一致 → 拒', () => {
    const pkg = packageOf(spec(), { specId: 'deid.other.v1' });
    expect(() => verifySignedDeidSpec(pkg, new Date(), PUB)).toThrow(/SPEC_SHAPE_INVALID/);
  });
});

describe('DeidSpecStore —— 版本单调 + 吊销', () => {
  function store(): DeidSpecStore {
    return new DeidSpecStore(() => new Date());
  }

  it('收下规格后 requireActive 可用；同版本重发幂等', () => {
    const s = store();
    const pkg = packageOf();
    expect(s.applyPackages([pkg], PUB).applied).toHaveLength(1);
    expect(s.applyPackages([pkg], PUB).applied).toHaveLength(0);
    expect(s.requireActive('deid.ckd.v3').version).toBe(1);
  });

  it('低版本回放 → 拒（版本单调）', () => {
    const s = store();
    s.applyPackages([packageOf(spec(), { version: 2 })], PUB);
    const stale = s.applyPackages([packageOf(spec(), { version: 1 })], PUB);
    expect(stale.rejected[0]?.code).toBe('SPEC_VERSION_STALE');
    expect(s.requireActive('deid.ckd.v3').version).toBe(2);
  });

  it('坏包不影响同批好包，也不清空已有规格', () => {
    const s = store();
    s.applyPackages([packageOf()], PUB);
    const broken = { ...packageOf(spec(), { version: 2 }), specSm3: 'f'.repeat(64) };
    const outcome = s.applyPackages([broken], PUB);
    expect(outcome.rejected).toHaveLength(1);
    expect(s.requireActive('deid.ckd.v3').version).toBe(1);
  });

  it('吊销名单命中即清缓存，之后 requireActive 抛 SPEC_NOT_AVAILABLE', () => {
    const s = store();
    s.applyPackages([packageOf()], PUB);
    const digest = sm3Hex(stableStringify(spec()));
    expect(
      s.applyRevocationList({
        version: 1,
        issuedAt: new Date().toISOString(),
        revoked: [
          {
            specSm3: digest,
            specId: 'deid.ckd.v3',
            version: 1,
            reason: '口径撤回',
            revokedAt: new Date().toISOString(),
            revokedBy: 'platform',
          },
        ],
      }),
    ).toBe(true);
    expect(() => s.requireActive('deid.ckd.v3')).toThrow(DeidSpecRejected);
  });

  it('吊销名单版本只增不减：旧名单回放不生效', () => {
    const s = store();
    const digest = sm3Hex(stableStringify(spec()));
    const list = (version: number, revoked: unknown[]) => ({
      version,
      issuedAt: new Date().toISOString(),
      revoked,
    });
    const entry = {
      specSm3: digest,
      specId: 'deid.ckd.v3',
      version: 1,
      reason: 'r',
      revokedAt: new Date().toISOString(),
      revokedBy: 'p',
    };
    expect(s.applyRevocationList(list(2, [entry]))).toBe(true);
    expect(s.applyRevocationList(list(1, []))).toBe(false);
    expect(s.currentRevocationVersion()).toBe(2);
  });

  it('过期规格即使被缓存也不可用', () => {
    let clock = new Date();
    const s = new DeidSpecStore(() => clock);
    const pkg = packageOf(spec(), { notAfter: new Date(Date.now() + 60_000).toISOString() });
    s.applyPackages([pkg], PUB); // 装载时未过期
    expect(s.requireActive('deid.ckd.v3').version).toBe(1);
    clock = new Date(Date.now() + 2 * 86_400_000); // 时间推进到过期之后
    expect(() => s.requireActive('deid.ckd.v3')).toThrow(/SPEC_EXPIRED/);
  });
});
