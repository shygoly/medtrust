import { sm2 } from 'sm-crypto';
import { generateSm2KeyPair } from '@medtrust/mdop';
import {
  PLATFORM_KEY_ENV,
  platformPublicKey,
  verifyByPurpose,
} from './platform-keys';
import { signSm2 } from './sm2-sign';

const ENV_KEYS = Object.values(PLATFORM_KEY_ENV);

describe('连接器固定的三把平台公钥按用途验签（D-MDOP-3）', () => {
  const ca = generateSm2KeyPair();
  const node = generateSm2KeyPair();
  const registry = generateSm2KeyPair();

  beforeEach(() => {
    process.env.CONNECTOR_PLATFORM_CA_PUBKEY = ca.publicKey;
    process.env.CONNECTOR_PLATFORM_NODE_PUBKEY = node.publicKey;
    process.env.CONNECTOR_REGISTRY_PUBKEY = registry.publicKey;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('三把公钥各归其位：只有对应用途的密钥验得过', () => {
    const message = 'medtrust.connector-task.v1:' + 'a'.repeat(64);
    const signed = signSm2(message, node.privateKey, node.publicKey);

    expect(verifyByPurpose('platform-node', message, signed)).toMatchObject({ ok: true });
    // 用错密钥一律拒 —— 这正是「用 CA 根钥签的信封被拒」的落点
    expect(verifyByPurpose('certificate', message, signed)).toMatchObject({
      ok: false,
      reason: 'signature-invalid',
    });
    expect(verifyByPurpose('registry', message, signed)).toMatchObject({
      ok: false,
      reason: 'signature-invalid',
    });
  });

  it('注册中心密钥签的模块摘要只认注册中心公钥', () => {
    const message = 'medtrust.algorithm-module.v1:' + 'c'.repeat(64);
    const signed = signSm2(message, registry.privateKey, registry.publicKey);
    expect(verifyByPurpose('registry', message, signed)).toMatchObject({ ok: true });
    expect(verifyByPurpose('platform-node', message, signed).ok).toBe(false);
  });

  it('未配置对应公钥 → fail-closed（不做「随便哪把都行」的兜底）', () => {
    delete process.env.CONNECTOR_REGISTRY_PUBKEY;
    expect(platformPublicKey('registry')).toBe('');
    const message = 'x';
    const signed = signSm2(message, registry.privateKey, registry.publicKey);
    expect(verifyByPurpose('registry', message, signed)).toMatchObject({
      ok: false,
      reason: 'key-not-configured',
    });
  });

  it('线上路径拒旧格式签名；历史核验面（acceptHistorical）才接受它', () => {
    const message = 'medtrust.result-endorsement.v1:' + 'd'.repeat(64);
    // 旧格式：不做 Z_A、原始 r‖s（切换前连接器的口径）
    const legacySignature = sm2.doSignature(message, node.privateKey);

    expect(verifyByPurpose('platform-node', message, legacySignature)).toMatchObject({
      ok: false,
      reason: 'signature-invalid',
    });
    expect(
      verifyByPurpose('platform-node', message, legacySignature, { acceptHistorical: true }),
    ).toMatchObject({ ok: true, alg: 'SM2-legacy-raw' });
  });

  it('篡改消息即验不过', () => {
    const signed = signSm2('original', node.privateKey, node.publicKey);
    expect(verifyByPurpose('platform-node', 'tampered', signed).ok).toBe(false);
  });
});
