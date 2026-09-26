import {
  LocalDevKms,
  createAttestationVerifier,
  generateSm2KeyPair,
  mapVendorQuote,
  publicKeyFromPrivateKey,
  type AttestationPolicy,
  type KeyReleaseRequest,
  type SessionWitness,
} from '@medtrust/mdop';
import { NodeWitnessVerifier } from './witness-verify';

/**
 * 持有方侧对**会话见证**的独立核验（任务 6.7 / D13）。
 *
 * 要证明的是一条界线：本院只信**部署配置里的 KMS 公钥**与**本地合约副本的策略**——
 * 平台转发来的东西本身不构成结论。通过/拒绝都要有留痕（拒绝不是「没看见」）。
 */

const NOW = new Date();
const NODE = 'urn:tds:sh-med:participant:tee-1';
const MEAS = `sm3:${'a'.repeat(64)}`;
const KMS_KEY = generateSm2KeyPair();
const EPH = generateSm2KeyPair();
const POLICY: AttestationPolicy = {
  tee: ['tdx'],
  min_tcb: { tdx: '3.1.0' },
  allowed_measurements: [MEAS],
};

async function makeWitness(): Promise<SessionWitness> {
  const report = mapVendorQuote({
    vendor: 'tdx',
    measurement: MEAS,
    tcb: '3.1.2',
    quote: 'dGR4LXF1b3Rl',
    signed_at: new Date(NOW.getTime() - 30_000).toISOString(),
    valid_until: new Date(NOW.getTime() + 300_000).toISOString(),
    ephemeral_public_key: EPH.publicKey,
    node: NODE,
  });
  const kms = new LocalDevKms({
    privateKey: KMS_KEY.privateKey,
    verifier: createAttestationVerifier([{ kind: 'tdx', verifyQuoteDigest: () => true }]),
    keys: new Map([['k-1', new Uint8Array(32).fill(3)]]),
    now: () => NOW,
  });
  kms.registerKey({
    keyId: 'k-1',
    dek: new Uint8Array(32).fill(3),
    owner: { job_id: 'job-1', contract_id: 'ctr-1' },
  });
  const req: KeyReleaseRequest = {
    key_id: 'k-1',
    key_owner: { job_id: 'job-1', contract_id: 'ctr-1' },
    context: { job_id: 'job-1', credential_id: 'tkt-1', contract_id: 'ctr-1' },
    report,
    policy: POLICY,
    credential_valid: true,
    contract_active: true,
    now: NOW,
  };
  return {
    job_id: 'job-1',
    credential_id: 'tkt-1',
    contract_id: 'ctr-1',
    key_id: 'k-1',
    node: NODE,
    report,
    warrant: await kms.requestRelease(req),
  };
}

const verifier = () =>
  new NodeWitnessVerifier({
    kmsPublicKey: publicKeyFromPrivateKey(KMS_KEY.privateKey),
    now: () => NOW,
  });

describe('会话见证的持有方独立核验（任务 6.7 / D13）', () => {
  it('凭据验签通过且与凭证里冻结的期望一致 → 记通过并留下凭据摘要', async () => {
    const witness = await makeWitness();
    const v = verifier();
    const record = v.verify({
      witness,
      policy: POLICY,
      expectation: { tee: 'tdx', measurement: MEAS, min_tcb: '3.1.0' },
    });
    expect(record.verified).toBe(true);
    expect(record.warrant_digest).toBe(witness.warrant.warrant_digest);
    expect(record.reason).toBeNull();
    expect(v.recordsLog()).toHaveLength(1);
  });

  it('换了代码（与本院签下的期望不符）→ 记拒绝，且拒绝原因带错误码', async () => {
    const witness = await makeWitness();
    const v = verifier();
    const record = v.verify({
      witness,
      policy: POLICY,
      expectation: { tee: 'tdx', measurement: `sm3:${'b'.repeat(64)}`, min_tcb: '3.1.0' },
    });
    expect(record.verified).toBe(false);
    expect(record.warrant_digest).toBeNull();
    // 错误码是**独立字段**（下游按码统计/告警，不去解析自然语言）
    expect(record.code).toBe('E_MEASUREMENT_NOT_ALLOWED');
    expect(record.reason).toContain('E_MEASUREMENT_NOT_ALLOWED');
    expect(v.recordsLog()).toHaveLength(1);
  });

  it('KMS 公钥不是签发方（换成别家的公钥）→ 记拒绝', async () => {
    const witness = await makeWitness();
    const v = new NodeWitnessVerifier({
      kmsPublicKey: publicKeyFromPrivateKey(generateSm2KeyPair().privateKey),
      now: () => NOW,
    });
    const record = v.verify({ witness, policy: POLICY });
    expect(record.verified).toBe(false);
    expect(record.reason).toContain('E_KEY_RELEASE_DENIED');
  });

  it('未配置 KMS 公钥（部署没给它）→ 一律记拒绝，不「默认通过」', async () => {
    const witness = await makeWitness();
    const v = new NodeWitnessVerifier({ kmsPublicKey: '', now: () => NOW });
    const record = v.verify({ witness, policy: POLICY });
    expect(record.verified).toBe(false);
    expect(record.reason).toContain('未配置 KMS 公钥');
  });

  it('合约策略收紧（度量白名单不含该度量）→ 记拒绝', async () => {
    const witness = await makeWitness();
    const v = verifier();
    const record = v.verify({
      witness,
      policy: { ...POLICY, allowed_measurements: [`sm3:${'c'.repeat(64)}`] },
    });
    expect(record.verified).toBe(false);
    expect(record.reason).toContain('E_MEASUREMENT_NOT_ALLOWED');
  });
});
