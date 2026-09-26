import {
  SoftwareAttestationProvider,
  generateSm2KeyPair,
  mapVendorQuote,
  signEndorsementPush,
  type AttestationProvider,
  type AttestationReport,
  type VendorQuote,
} from '@medtrust/mdop';
import { runAttestationProbe } from './attestation-probe';

/**
 * 节点侧证明探针（任务 5.9 / D-TEE-6）。
 *
 * 要钉住的是「节点的这一半」：真跑证明 → 带节点签名交给校验方 → **自己验**校验方回传的背书，
 * 并核对背书绑定的就是本次这份证明；软件提供者不送（拿不到背书是设计意图）。
 */

const NOW = new Date('2026-09-25T10:00:00.000Z');
const NODE = 'urn:tds:sh-med:participant:tee-1';
const MEAS = `sm3:${'a'.repeat(64)}`;
const QUOTE = `sm3:${'b'.repeat(64)}`;
const KMS_KEYS = generateSm2KeyPair();
const NODE_KEYS = generateSm2KeyPair();

class HardwareDouble implements AttestationProvider {
  readonly providerKind = 'tdx' as const;
  async prove(): Promise<AttestationReport> {
    const eph = generateSm2KeyPair();
    const quote: VendorQuote = {
      vendor: 'tdx',
      measurement: MEAS,
      tcb: '3.1.2',
      quote: 'dGR4LXF1b3Rl',
      signed_at: new Date(NOW.getTime() - 30_000).toISOString(),
      valid_until: new Date(NOW.getTime() + 300_000).toISOString(),
      ephemeral_public_key: eph.publicKey,
      node: NODE,
    };
    return mapVendorQuote(quote);
  }
}

function endorsement(over: { node?: string; quoteDigest?: string } = {}) {
  return signEndorsementPush({
    verifier: 'kms-1',
    endorsement: {
      node: over.node ?? NODE,
      kind: 'tdx',
      measurement: MEAS,
      tcb: '3.1.2',
      quoteDigest: over.quoteDigest ?? QUOTE,
      verifiedAt: new Date(NOW.getTime() - 10_000).toISOString(),
      expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    },
    privateKey: KMS_KEYS.privateKey,
    publicKey: KMS_KEYS.publicKey,
  });
}

function deps(over: {
  provider?: AttestationProvider;
  endorsement?: unknown;
  accepted?: boolean;
  status?: number;
  report?: AttestationReport;
} = {}) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body,
    });
    // 校验方回传的背书必须绑定**节点刚送去的这份证明**：这里用送来的 report.quote_digest 造背书
    const report = body.report as AttestationReport;
    return {
      ok: (over.status ?? 200) < 400,
      status: over.status ?? 200,
      json: async () => ({
        accepted: over.accepted ?? true,
        endorsement:
          over.endorsement === undefined
            ? endorsement({ quoteDigest: report.quote_digest ?? QUOTE })
            : over.endorsement,
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return {
    calls,
    deps: {
      node: NODE,
      participantId: 'tee-1',
      privateKey: NODE_KEYS.privateKey,
      provider: over.provider ?? new HardwareDouble(),
      verifierUrl: 'https://verifier.example/attest',
      kmsPublicKey: KMS_KEYS.publicKey,
      trustedVerifiers: ['kms-1'],
      fetchImpl,
      now: () => NOW,
    },
  };
}

describe('节点证明探针（任务 5.9 / D-TEE-6）', () => {
  it('真跑一次证明 → 带节点签名交给校验方 → 回传背书自己验通过', async () => {
    const h = deps();
    const out = await runAttestationProbe(h.deps);
    expect(out).toMatchObject({ accepted: true, endorsed: true });
    expect(out.expiresAt).toBe(endorsement().endorsement.expiresAt);
    // 请求形状：地址、节点签名头、body 里是本节点 + 本次报告
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe('https://verifier.example/attest');
    expect(h.calls[0].headers['X-Connector-Participant']).toBe('tee-1');
    expect(h.calls[0].headers['X-Connector-Signature']).toMatch(/^[0-9a-f]{100,}$/i);
    expect(h.calls[0].body.node).toBe(NODE);
    expect((h.calls[0].body.report as AttestationReport).level).toBe('hardware');
    // 送出去的是**报告本体**（证明与身份绑定），不含任何密钥材料
    expect(JSON.stringify(h.calls[0].body)).not.toContain('privateKey');
  });

  it('校验方回传的背书换成别人的 / 换成别的证明 → 拒（不把别人的背书当我自己的）', async () => {
    const foreignNode = deps({ endorsement: endorsement({ node: 'urn:tds:sh-med:participant:tee-9' }) });
    await expect(runAttestationProbe(foreignNode.deps)).rejects.toThrow(/别的节点/);
    const foreignQuote = deps({ endorsement: endorsement({ quoteDigest: `sm3:${'c'.repeat(64)}` }) });
    await expect(runAttestationProbe(foreignQuote.deps)).rejects.toThrow(/不是本次这份证明/);
  });

  it('背书签名验不过（不是部署配置里的校验方签的）→ 拒', async () => {
    const stranger = generateSm2KeyPair();
    const forged = signEndorsementPush({
      verifier: 'kms-1',
      endorsement: endorsement().endorsement,
      privateKey: stranger.privateKey,
      publicKey: stranger.publicKey,
    });
    const h = deps({ endorsement: forged });
    await expect(runAttestationProbe(h.deps)).rejects.toMatchObject({
      code: 'E_ATTESTATION_FAILED',
    });
  });

  it('校验方说「不接受」→ 如实返回，不伪造背书', async () => {
    const h = deps({ accepted: false });
    const out = await runAttestationProbe(h.deps);
    expect(out).toMatchObject({ accepted: false, endorsed: false });
  });

  it('软件提供者 → 本地就拒（不发请求：拿不到背书是设计意图）', async () => {
    const h = deps({ provider: new SoftwareAttestationProvider({ measurement: MEAS }) });
    await expect(runAttestationProbe(h.deps)).rejects.toMatchObject({
      code: 'E_ATTESTATION_FAILED',
    });
    expect(h.calls).toHaveLength(0);
  });

  it('探针地址缺失 / 校验方 5xx → 拒（不静默降级）', async () => {
    const h = deps();
    await expect(runAttestationProbe({ ...h.deps, verifierUrl: '' })).rejects.toThrow(/探针地址/);
    const failing = deps({ status: 503 });
    await expect(runAttestationProbe(failing.deps)).rejects.toThrow(/HTTP 503/);
  });
});
