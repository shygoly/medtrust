import { createDecipheriv } from 'crypto';
import { canonicalize, parseDataEnvelope, type AttestationPolicy } from '@medtrust/mdop';
import { buildSealedEnvelope, type SealContractTerms, type SealOperatorDeps } from './seal';

const POLICY: AttestationPolicy = { tee: ['tdx'], min_tcb: '3.1.0' };
const CONTRACT: SealContractTerms = {
  contract_id: 'ctr-1',
  data_product_id: 'dp-1',
  allowed_ops: ['sm3:' + 'a'.repeat(64)],
  attestation_policy: POLICY,
  valid_until: '2027-09-30T00:00:00.000Z',
};

function deps(over: Partial<SealOperatorDeps> = {}): SealOperatorDeps {
  return {
    kmsRef: 'kms://space.example.cn',
    watermarkPrefix: 'wm:site-a:sh-med',
    signer: 'urn:tds:sh-med:participant:p-huashan',
    sign: () => ({ alg: 'SM2-SM3', value: '3045...' }),
    depositor: { depositKey: async () => undefined },
    now: () => new Date('2026-09-25T10:00:00.000Z'),
    randomKey: () => Buffer.alloc(32, 7),
    ...over,
  };
}

const input = (over: Record<string, unknown> = {}) => ({
  jobId: 'job-1',
  credentialId: 'tkt-1',
  contract: CONTRACT,
  projection: { productId: 'dp-1', n: 3, rows: [{ subjectKey: 'sk-1', ageBand: '50-59' }] },
  dataProductId: 'dp-1',
  allowedOps: CONTRACT.allowed_ops ?? [],
  ...over,
});

describe('封装算子 seal.envelope（任务 6.2）', () => {
  it('产出的信封能过协议解析，且 AAD 绑定作业/凭证/合约', async () => {
    const { envelope } = await buildSealedEnvelope(input(), deps());
    expect(parseDataEnvelope(envelope).envelope).toBe('mdop.env/1.0');
    expect(envelope.aad).toEqual({ job_id: 'job-1', credential_id: 'tkt-1', contract_id: 'ctr-1' });
    expect(envelope.policy.export).toBe('C3_only');
    expect(envelope.policy.attestation_policy).toEqual(POLICY);
    expect(envelope.payload.cipher).toBe('AES-256-GCM');
    expect(envelope.wrapped_key.kms).toBe('kms://space.example.cn');
    expect(envelope.watermark).toMatch(/^wm:site-a:sh-med:\d{8}$/);
  });

  it('密文里不含明文投影；DEK 已交给保管方（无 KMS 即拒）', async () => {
    const deposited: string[] = [];
    const { ciphertext, iv, tag, envelope } = await buildSealedEnvelope(
      input(),
      deps({
        depositor: {
          depositKey: async ({ keyId, dek }) => {
            deposited.push(keyId);
            expect(dek).toHaveLength(32);
          },
        },
      }),
    );
    // 密文是 base64 的 AEAD 输出：既没有明文标记，解密也要密钥与 AAD 同时正确
    expect(ciphertext).not.toContain('subjectKey');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.alloc(32, 7), Buffer.from(iv, 'hex'));
    decipher.setAAD(Buffer.from(canonicalize(envelope.aad), 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    expect(plain).toContain('sk-1');
    expect(deposited).toEqual([envelope.wrapped_key.key_id]);

    // 没有 KMS 保管 → 拒绝产出信封（不「先出信封、密钥稍后补」）
    await expect(buildSealedEnvelope(input(), deps({ depositor: undefined }))).rejects.toMatchObject({
      code: 'E_KEY_RELEASE_DENIED',
    });
  });

  it('AAD 被改（换作业）→ 解不开（认证失败）', async () => {
    const { ciphertext, iv, tag, envelope } = await buildSealedEnvelope(input(), deps());
    const decipher = createDecipheriv('aes-256-gcm', Buffer.alloc(32, 7), Buffer.from(iv, 'hex'));
    decipher.setAAD(
      Buffer.from(canonicalize({ ...envelope.aad, job_id: 'job-2' }), 'utf8'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    expect(() => decipher.final()).toThrow();
    void ciphertext;
  });

  it('合约未声明证明策略 / 数据产品不在合约范围内 → 拒（fail-closed）', async () => {
    await expect(
      buildSealedEnvelope(
        input({ contract: { ...CONTRACT, attestation_policy: undefined } }),
        deps(),
      ),
    ).rejects.toMatchObject({ code: 'E_ENVELOPE_POLICY' });

    await expect(
      buildSealedEnvelope(input({ dataProductId: 'dp-other' }), deps()),
    ).rejects.toMatchObject({ code: 'E_ENVELOPE_POLICY' });
  });

  it('保管失败 → 直接拒（不留半份信封）', async () => {
    await expect(
      buildSealedEnvelope(
        input(),
        deps({
          depositor: {
            depositKey: async () => {
              throw new Error('KMS 不可达');
            },
          },
        }),
      ),
    ).rejects.toThrow(/KMS 不可达/);
  });

  it('同一作业同一数据产品：两家持有方各封一份必定是两个 key_id（不得撞成一把）', async () => {
    // 同一毫秒、同一作业/合约/产品，只有持有方不同——key_id 必须不同，
    // 否则 KMS 会把两条密钥记录当成一条（一方释放＝替另一方释放）。
    const fixed = () => new Date('2026-09-25T10:00:00.000Z');
    const a = await buildSealedEnvelope(
      input(),
      deps({ signer: 'urn:tds:sh-med:participant:p-huashan', now: fixed }),
    );
    const b = await buildSealedEnvelope(
      input(),
      deps({ signer: 'urn:tds:sh-med:participant:p-ruijin', now: fixed }),
    );
    expect(a.envelope.wrapped_key.key_id).not.toBe(b.envelope.wrapped_key.key_id);
  });
});
