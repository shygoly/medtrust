import { SoftwareTee, type SealedInput } from '../domain/tee';
import {
  SoftwareAttestationProvider,
  anchorChainHead,
  canonicalSm3,
  createAttestationVerifier,
  evaluateKeyRelease,
  mapVendorQuote,
  reportDataBinding,
  type AttestationProvider,
  type AttestationReport,
  type TrustedRoot,
} from '@medtrust/mdop';

/**
 * 试点骨架的**连接器侧**版本（§3.1）：用**仓库既有的** `TeeEnclave` / `SoftwareTee` 跑一遍
 * 「封存 → 证明 → 释放判定 → 节点内执行 → 发布审查 → 只出 C3 → 回执链」。
 *
 * 为什么这一版有意义（而不是重复 `packages/mdop` 的那份）：
 *  - **执行那一半用既有抽象**：`TeeEnclave.seal/run` 是仓库早于本变更就有的契约，硬件到位时替换的是
 *    它的实现（软件 → CSV/TDX/SEV 飞地），调用点一行不动。本用例把这一点钉住。
 *  - **证明那一半分开**：`SoftwareTee.run()` 给出的证明恒为 `level=software` / `isolation=none`——
 *    它**过不了 C2 判定**（这是设计意图）。因此骨架里证明来自独立的提供者：软件提供者只用于证明
 *    「接口与管线通」，硬件替身用于验证「换实现不动调用点」。
 *
 * 用一句话概括本用例要证明的事：**换硬件时改的是两个类（证明提供者、KMS 客户端），
 * 而不是管线的形状**。
 */

const NOW = new Date('2026-09-25T10:00:00.000Z');
const MEAS = `sm3:${'a'.repeat(64)}`;

/** 硬件证明代理的替身（真实实现由 `apps/tee-node` 的证明代理替换）。 */
class HardwareProviderDouble implements AttestationProvider {
  readonly providerKind = 'tdx' as const;
  constructor(private readonly now: () => Date) {}
  async prove(): Promise<AttestationReport> {
    const now = this.now();
    return mapVendorQuote({
      vendor: 'tdx',
      measurement: MEAS,
      tcb: '3.1.2',
      quote: 'dGR4LXF1b3Rl',
      signed_at: now.toISOString(),
      valid_until: new Date(now.getTime() + 300_000).toISOString(),
      ephemeral_public_key: '04' + '7'.repeat(128),
      report_data: reportDataBinding('04' + '7'.repeat(128)),
      node: 'urn:tds:sh-med:participant:tee-1',
    });
  }
}

/** 节点内的一条最小管线：解封（TeeEnclave）→ 发布审查 → 只出 C3。 */
function runNodePipeline(input: {
  tee: SoftwareTee;
  sealed: SealedInput;
  minCell: number;
  receipt: (event: string, detail: Record<string, unknown>) => void;
}) {
  const gated = input.tee.run(input.sealed, (data: { cells: number[] }) => {
    let suppressed = 0;
    const cells = data.cells.map((c) => {
      if (c > 0 && c < input.minCell) {
        suppressed += 1;
        return 0;
      }
      return c;
    });
    return { cells, suppressed };
  });
  // 关键：执行用的既有抽象自己给出的证明是 software/none → 只能用于留痕，不能当 C2 凭据
  input.receipt('EXECUTED', {
    level: gated.attestation.level,
    isolation: gated.attestation.isolation,
    suppressed: gated.output.suppressed,
  });
  if (gated.attestation.level !== 'software' || gated.attestation.isolation !== 'none')
    throw new Error('SoftwareTee 的证明应当如实是 software/none（不得升级表述）');

  const artifact = { label: 'C3' as const, body: gated.output };
  input.receipt('EXITED', { label: artifact.label });
  return artifact;
}

describe('试点骨架（连接器侧）：既有 TeeEnclave/SoftwareTee 作为节点内执行的那一半', () => {
  const now = () => NOW;
  const rootsOf = (report: AttestationReport): TrustedRoot[] => [
    { kind: report.kind!, verifyQuoteDigest: (d) => d === report.quote_digest },
  ];

  it('管线跑通：封存 → 释放判定 → 节点内执行 → 只出 C3 → 回执链成链', async () => {
    const tee = new SoftwareTee();
    const sealed = tee.seal({ cells: [12, 3, 40] });

    const provider = new HardwareProviderDouble(now);
    const report = await provider.prove();
    const release = evaluateKeyRelease({
      report,
      policy: { tee: ['tdx'], min_tcb: { tdx: '3.1.0' } },
      verifier: createAttestationVerifier(rootsOf(report)),
      job_id: 'job-1',
      credential_id: 'tkt-1',
      contract_id: 'ctr-1',
      key_id: 'k-1',
      key_owner: { job_id: 'job-1', contract_id: 'ctr-1' },
      credential_valid: true,
      contract_active: true,
      now: NOW,
    });

    const chain: Array<{ event: string; hash: string; prev: string | null }> = [];
    const receipt = (event: string, detail: Record<string, unknown>) => {
      const prev = chain.length ? chain[chain.length - 1].hash : null;
      chain.push({ event, prev, hash: canonicalSm3({ event, prev, detail }) });
    };
    receipt('RELEASED', { warrant: release.warrant_digest });
    const out = runNodePipeline({ tee, sealed, minCell: 5, receipt });

    expect(out).toEqual({ label: 'C3', body: { cells: [12, 0, 40], suppressed: 1 } });
    expect(chain.map((c) => c.event)).toEqual(['RELEASED', 'EXECUTED', 'EXITED']);
    // 回执链成链：逐条 prev = 上一条 hash
    chain.forEach((e, i) => expect(e.prev).toBe(i === 0 ? null : chain[i - 1].hash));
    expect(chain[chain.length - 1].hash).toMatch(/^sm3:[0-9a-f]{64}$/);

    // 链头锚定（协议 §10）：有存证写入端 → anchored；未接链 → pending 且**没有** tx_id
    const head = chain[chain.length - 1].hash;
    const anchored = await anchorChainHead({
      job_id: 'job-1',
      node: 'urn:tds:sh-med:participant:tee-1',
      chain_head: head,
      sink: { anchor: async () => ({ tx_id: '0xchain-1' }) },
      now,
    });
    expect(anchored).toEqual({
      node: 'urn:tds:sh-med:participant:tee-1',
      chain_head: head,
      status: 'anchored',
      tx_id: '0xchain-1',
      anchored_at: NOW.toISOString(),
    });
    const pending = await anchorChainHead({
      job_id: 'job-1',
      node: 'urn:tds:sh-med:participant:tee-1',
      chain_head: head,
    });
    expect(pending.status).toBe('pending');
    expect('tx_id' in pending).toBe(false);
  });

  it('换实现不动调用点：软件提供者与硬件替身都过不去/过得了 C2 判定，**管线一行不改**', async () => {
    const tee = new SoftwareTee();
    const sealed = tee.seal({ cells: [7, 2] });
    const policy = { tee: ['csv', 'tdx'], min_tcb: { csv: '2026-06', tdx: '3.1.0' } };

    // ① 软件提供者：证明恒 software/none → 释放判定直接拒（哪怕政策三链全开）
    const software = new SoftwareAttestationProvider({ measurement: MEAS, now });
    const softwareReport = await software.prove();
    expect(() =>
      evaluateKeyRelease({
        report: softwareReport,
        policy,
        verifier: createAttestationVerifier([]),
        job_id: 'job-1',
        credential_id: 'tkt-1',
        contract_id: 'ctr-1',
        key_id: 'k-1',
        key_owner: { job_id: 'job-1', contract_id: 'ctr-1' },
        credential_valid: true,
        contract_active: true,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: 'E_CAPABILITY_MISMATCH' }));

    // ② 换成硬件替身：同一段管线 + 同一段节点内执行，照跑
    const hw = new HardwareProviderDouble(now);
    const hwReport = await hw.prove();
    const release = evaluateKeyRelease({
      report: hwReport,
      policy,
      verifier: createAttestationVerifier(rootsOf(hwReport)),
      job_id: 'job-1',
      credential_id: 'tkt-1',
      contract_id: 'ctr-1',
      key_id: 'k-1',
      key_owner: { job_id: 'job-1', contract_id: 'ctr-1' },
      credential_valid: true,
      contract_active: true,
      now: NOW,
    });
    expect(release.released).toBe(true);
    const chain: Array<{ event: string; hash: string; prev: string | null }> = [];
    const out = runNodePipeline({
      tee,
      sealed,
      minCell: 5,
      receipt: (event, detail) => {
        const prev = chain.length ? chain[chain.length - 1].hash : null;
        chain.push({ event, prev, hash: canonicalSm3({ event, prev, detail }) });
      },
    });
    // 节点内执行那一半（TeeEnclave）两次完全相同——换的是证明与 KMS，不是管线
    expect(out.body).toEqual({ cells: [7, 0], suppressed: 1 });
  });

  it('软件隔离不得升级表述：SoftwareTee 的证明恒 software/none（CTL-09 / D9）', () => {
    const tee = new SoftwareTee();
    const sealed = tee.seal({ cells: [1, 2] });
    const { attestation } = tee.run(sealed, (d: unknown) => d);
    expect(attestation.level).toBe('software');
    expect(attestation.isolation).toBe('none');
    expect(attestation.measurement).toMatch(/^sm3:[0-9a-f]{64}$/);
  });
});
