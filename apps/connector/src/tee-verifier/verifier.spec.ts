import {
  generateSm2KeyPair,
  sm2Decrypt,
  sm2Encrypt,
  verifyEndorsementPush,
  verifyReleaseWarrant,
  type AttestationReport,
} from '@medtrust/mdop';
import { signSm2 } from '../domain/sm2-sign';
import { TdxAttestationProvider } from '../tee-node/tdx/provider';
import { ExecTdxQuoteSource, type SidecarRunner } from '../tee-node/tdx/sidecar';
import {
  AttestationVerifierService,
  keyDepositMessage,
  type KeyDepositRequest,
  type ProbeRequest,
  type VerifierPolicy,
} from './verifier';

const NOW = new Date('2026-10-03T00:00:00.000Z');
const PID = 'tee-node-a';
const NODE = `urn:tds:sh-med:participant:${PID}`;
const MEASUREMENT = `sm3:${'ab'.repeat(32)}`;
const QUOTE = Buffer.from('synthetic-tdx-quote-bytes').toString('base64');

const nodeKey = generateSm2KeyPair();
const verifierKey = generateSm2KeyPair();

/** 模拟 sidecar：`quote` 记下节点请求的 REPORTDATA，`verify` 把它当作 quote 覆盖的值回报。 */
function fakeSidecar(overrides: { verify?: Record<string, unknown>; verifyFails?: string } = {}) {
  let reportData = '';
  const facts = () => ({
    report_data: reportData,
    mr_td: 'e0'.repeat(48),
    measurement: MEASUREMENT,
    tee_tcb_svn: '05010300000000000000000000000000',
    tcb: '5.1.3',
  });
  const run: SidecarRunner = async (args) => {
    if (args[0] === 'quote') {
      reportData = args[2];
      return {
        ok: true,
        quote_b64: QUOTE,
        facts: facts(),
        collateral: [
          { kind: 'crl', digest: `sm3:${'11'.repeat(32)}`, fetched_at: '2026-10-02T23:59:00.000Z', next_update: '2026-11-01T00:00:00.000Z' },
          { kind: 'qvl', digest: `sm3:${'22'.repeat(32)}`, fetched_at: '2026-10-02T23:59:00.000Z', next_update: '2026-11-01T00:00:00.000Z' },
        ],
      };
    }
    if (overrides.verifyFails) throw new Error(overrides.verifyFails);
    return { ok: true, facts: { ...facts(), ...overrides.verify } };
  };
  return run;
}

async function prove(run: SidecarRunner): Promise<{ report: AttestationReport; quote: string }> {
  const provider = new TdxAttestationProvider({
    node: NODE,
    quoteSource: new ExecTdxQuoteSource(run),
    now: () => NOW,
  });
  const report = await provider.prove();
  return { report, quote: provider.evidenceFor(report.quote_digest ?? '') ?? '' };
}

function policy(overrides: Partial<VerifierPolicy> = {}): VerifierPolicy {
  return {
    verifierId: 'verifier-domain-b',
    spaceId: 'sh-med',
    nodeKeys: new Map([[PID, nodeKey.publicKey]]),
    measurements: [MEASUREMENT],
    minTcb: '5.1.3',
    collateralMaxStalenessMinutes: 60,
    endorsementTtlMinutes: 30,
    clockSkewMs: 300_000,
    kmsRef: 'kms://verifier-domain-b',
    holderKeys: new Map(),
    ...overrides,
  };
}

function probe(body: unknown, overrides: Partial<ProbeRequest> = {}): ProbeRequest {
  const timestamp = String(NOW.getTime());
  return {
    participantId: PID,
    timestamp,
    signature: signSm2(`${timestamp}:${PID}`, nodeKey.privateKey),
    body,
    ...overrides,
  };
}

function service(run: SidecarRunner, p: VerifierPolicy = policy()) {
  return new AttestationVerifierService({
    policy: p,
    privateKey: verifierKey.privateKey,
    publicKey: verifierKey.publicKey,
    runSidecar: run,
    now: () => NOW,
  });
}

async function expectRejected(verdict: Promise<unknown>, reason: string) {
  const out = (await verdict) as { accepted: boolean; detail?: string };
  expect(out.accepted).toBe(false);
  expect(out.detail).toContain(reason);
}

describe('AttestationVerifierService', () => {
  it('对验签通过且绑定正确的证明签背书，背书可被部署公钥验证', async () => {
    const run = fakeSidecar();
    const { report, quote } = await prove(run);
    const verdict = await service(run).handleProbe(probe({ node: NODE, report, evidence: { quote } }));

    expect(verdict.accepted).toBe(true);
    if (!verdict.accepted) return;
    const { endorsement } = verifyEndorsementPush({
      push: verdict.endorsement,
      verifierPublicKey: verifierKey.publicKey,
      now: NOW,
    });
    expect(endorsement).toMatchObject({
      node: NODE,
      kind: 'tdx',
      measurement: MEASUREMENT,
      tcb: '5.1.3',
      quoteDigest: report.quote_digest,
      expiresAt: '2026-10-03T00:30:00.000Z',
    });
  });

  it('拒：未登记的节点 / 签名无效 / 时间戳出窗', async () => {
    const run = fakeSidecar();
    const { report, quote } = await prove(run);
    const body = { node: NODE, report, evidence: { quote } };
    await expectRejected(service(run).handleProbe(probe(body, { participantId: 'stranger' })), '未登记');
    await expectRejected(
      service(run).handleProbe(probe(body, { signature: signSm2('x', generateSm2KeyPair().privateKey) })),
      '签名无效',
    );
    await expectRejected(
      service(run).handleProbe(probe(body, { timestamp: String(NOW.getTime() - 3_600_000) })),
      '时间戳',
    );
  });

  it('拒：没带原生 quote，或 quote 原文与摘要不符', async () => {
    const run = fakeSidecar();
    const { report } = await prove(run);
    await expectRejected(service(run).handleProbe(probe({ node: NODE, report })), '未随带原生 quote');
    await expectRejected(
      service(run).handleProbe(probe({ node: NODE, report, evidence: { quote: 'AAAA' } })),
      'quote_digest 不符',
    );
  });

  it('拒：链验不过（sidecar 失败即拒，不出背书）', async () => {
    const good = fakeSidecar();
    const { report, quote } = await prove(good);
    const failing: SidecarRunner = async () => {
      const { MdopError } = await import('@medtrust/mdop');
      throw new MdopError('E_ATTESTATION_FAILED', {}, '链未验到 Intel 证明根');
    };
    await expectRejected(
      service(failing).handleProbe(probe({ node: NODE, report, evidence: { quote } })),
      'Intel 证明根',
    );
  });

  it('拒：quote 覆盖的 REPORTDATA 与报告不符（硬件覆盖核验）', async () => {
    const run = fakeSidecar();
    const { report, quote } = await prove(run);
    const tampered = fakeSidecar({ verify: { report_data: `${'cd'.repeat(32)}${'00'.repeat(32)}` } });
    await expectRejected(
      service(tampered).handleProbe(probe({ node: NODE, report, evidence: { quote } })),
      'REPORTDATA',
    );
  });

  it('拒：报告自述的度量 / TCB 与 quote 不符', async () => {
    const run = fakeSidecar();
    const { report, quote } = await prove(run);
    const body = { node: NODE, report, evidence: { quote } };
    const base = { report_data: Buffer.from(hexOf(report)).toString() };
    await expectRejected(
      service(fakeSidecar({ verify: { ...base, measurement: `sm3:${'ff'.repeat(32)}` } })).handleProbe(probe(body)),
      '度量与 quote 不符',
    );
    await expectRejected(
      service(fakeSidecar({ verify: { ...base, tcb: '9.9.9' } })).handleProbe(probe(body)),
      'TCB 与 quote 不符',
    );
  });

  it('拒：度量不在白名单 / TCB 低于下限 / collateral 超窗', async () => {
    const run = fakeSidecar();
    const { report, quote } = await prove(run);
    const body = { node: NODE, report, evidence: { quote } };
    const replay = fakeSidecar({ verify: { report_data: hexOf(report) } });
    await expectRejected(service(replay, policy({ measurements: [] })).handleProbe(probe(body)), '白名单');
    await expectRejected(service(replay, policy({ minTcb: '6.0.0' })).handleProbe(probe(body)), '低于下限');
    await expectRejected(
      service(replay, policy({ collateralMaxStalenessMinutes: 0 })).handleProbe(probe(body)),
      'collateral',
    );
  });

  it('拒：证明绑定的是别的节点', async () => {
    const run = fakeSidecar();
    const { report, quote } = await prove(run);
    await expectRejected(
      service(run).handleProbe(probe({ node: 'urn:tds:sh-med:participant:other', report, evidence: { quote } })),
      '未绑定',
    );
  });
});

describe('试点形态的密钥托付与释放', () => {
  const holderKey = generateSm2KeyPair();
  const HOLDER = 'p-demohospa';
  const DEK = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  const CONTEXT = { job_id: 'job-1', credential_id: 'tkt-1', contract_id: 'c-1' };
  const POLICY = { tee: ['tdx' as const], min_tcb: { tdx: '5.1.3' }, allowed_measurements: [MEASUREMENT] };

  const kmsPolicy = (overrides: Partial<VerifierPolicy> = {}) =>
    policy({ holderKeys: new Map([[HOLDER, holderKey.publicKey]]), ...overrides });

  function deposit(overrides: Partial<KeyDepositRequest> = {}): KeyDepositRequest {
    const signed = {
      holder: HOLDER,
      key_id: 'k-1',
      job_id: CONTEXT.job_id,
      contract_id: CONTEXT.contract_id,
      wrapped_dek: sm2Encrypt(DEK, verifierKey.publicKey),
      timestamp: String(NOW.getTime()),
      ...overrides,
    };
    return { ...signed, signature: signSm2(keyDepositMessage(signed), holderKey.privateKey) };
  }

  async function ask(svc: AttestationVerifierService, run: SidecarRunner, context = CONTEXT) {
    const provider = new TdxAttestationProvider({
      node: NODE,
      quoteSource: new ExecTdxQuoteSource(run),
      now: () => NOW,
    });
    const report = await provider.prove();
    const out = await svc.releaseKey(
      probe({
        request: {
          key_id: 'k-1',
          context,
          report,
          policy: POLICY,
          credential_valid: true,
          contract_active: true,
        },
        evidence: { quote: provider.evidenceFor(report.quote_digest ?? '') },
      }),
    );
    return { out, report, provider };
  }

  it('托付 → 证明通过 → 释放：密钥只有证明里的一次性私钥解得开，凭据可被部署公钥核验', async () => {
    const run = fakeSidecar();
    const svc = service(run, kmsPolicy());
    expect(svc.depositKey(deposit())).toEqual({ accepted: true });

    const { out, report, provider } = await ask(svc, run);
    expect(out.released).toBe(true);
    if (!out.released) return;
    expect(out.warrant.kms).toBe('kms://verifier-domain-b');
    verifyReleaseWarrant({
      warrant: out.warrant,
      kmsPublicKey: verifierKey.publicKey,
      report,
      context: { ...CONTEXT, key_id: 'k-1' },
      expectedKms: 'kms://verifier-domain-b',
      now: NOW,
    });
    const priv = provider.ephemeralPrivateKeyFor(out.warrant.ephemeral_key_digest);
    expect(Array.from(sm2Decrypt(out.warrant.wrapped_key, priv ?? ''))).toEqual(Array.from(DEK));
  });

  it('拒托付：未登记的持有方 / 签名不符 / 改写已登记的 key_id', () => {
    const svc = service(fakeSidecar(), kmsPolicy());
    expect(svc.depositKey(deposit({ holder: 'p-unknown' })).accepted).toBe(false);
    expect(svc.depositKey({ ...deposit(), job_id: 'job-other' }).accepted).toBe(false);
    expect(svc.depositKey(deposit()).accepted).toBe(true);
    expect(svc.depositKey(deposit()).accepted).toBe(false);
  });

  it('拒释放：未托付的密钥 / 串作业 / 度量不在白名单', async () => {
    const run = fakeSidecar();
    const none = await ask(service(run, kmsPolicy()), run);
    expect(none.out).toMatchObject({ released: false });

    const svc = service(run, kmsPolicy());
    svc.depositKey(deposit());
    const cross = await ask(svc, run, { ...CONTEXT, job_id: 'job-other' });
    expect(cross.out).toMatchObject({ released: false });

    const strict = service(run, kmsPolicy({ measurements: [] }));
    strict.depositKey(deposit());
    const denied = await ask(strict, run);
    expect(denied.out).toMatchObject({ released: false });
  });
});

/** 报告的 `report_data`（sm3 标签）按装填约定还原成 128 位十六进制（前 32 字节摘要 + 32 字节零）。 */
function hexOf(report: AttestationReport): string {
  return `${(report.report_data ?? '').replace(/^sm3:/, '')}${'00'.repeat(32)}`;
}
