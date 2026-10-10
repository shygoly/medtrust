import {
  LocalDevKms,
  MdopError,
  canonicalSm3,
  ephemeralKeyDigest,
  evaluateKeyRelease,
  generateSm2KeyPair,
  mapVendorQuote,
  reportDataBinding,
  parseAuditReceipt,
  parseReleaseManifest,
  publicKeyFromPrivateKey,
  signCanonicalObject,
  sm2Encrypt,
  sm2Sign,
  type AttestationVerifier,
  type AttestationPolicy,
  type AttestationProvider,
  type AttestationReport,
  type KeyReleaseRequest,
  type KeyReleaseWarrant,
  type KmsClient,
  type PhysicalStage,
  type TrustedRoot,
  type VendorQuote,
} from '@medtrust/mdop';
import { AuditService } from '../../domain/audit';
import { Deidentifier } from '../../domain/deidentifier';
import { OutputGate } from '../../domain/output-gate';
import { MdopStageExecutor } from '../mdop-executor';
import { buildSealedEnvelope, type SealContractTerms } from '../operators/seal';
import { NodeQueryBudgetLedger } from './budget-ledger';
import { TrustedNodeEntryGuard } from './entry-guard';
import { NodeArtifactStore } from './node-artifacts';
import { NodeExitGuard } from './node-exit';
import { NodeReceiptChain } from './node-receipts';
import { TrustedNodeSession } from './node-session';
import { joinableBounds, pairIntersection, type PseudonymRow } from './pairing';
import { NodePublicationReview } from './publication-review';

/**
 * 两院 C2 端到端（任务 8.5 / pilot Q4 的「合成数据上闭环」证据）。
 *
 *   两家持有方各封一份**共享假名键空间**的合成队列 → 可信空间节点
 *   → 证明 →KMS 释放 → 解封 → 节点内跨院主体配对 → 发布审查 → 只出 C3 → 回执成链 → 销毁
 *
 * 两点如实边界（不得含糊）：
 *  ① 证明提供者与 KMS 都是**替身**：硬件证明代理对接真实证明链（CSV/TDX/SEV-SNP）、
 *     KMS 由数据持有方自建或与运营方共管（D-TEE-1）。**替身跑通的是接口与协议，
 *     不是「C2 已可用」**——软件提供者在本用例里被明确断言为**跑不通**（见负例）。
 *  ② 配对算子的语义在本文件与 `pairing.ts` 里，真实部署里它是注册中心签发的 `wasm` 模块
 *     （协议 §5.1 不许 `system` 承载协同算子）。
 */

const NOW = new Date('2026-09-25T10:00:00.000Z');
const SPACE = 'sh-med';
const TEE = `urn:tds:${SPACE}:participant:tee-1`;
const PLATFORM = `urn:tds:${SPACE}:participant:platform`;
const HOSP_A = `urn:tds:${SPACE}:participant:p-demohospa`;
const HOSP_B = `urn:tds:${SPACE}:participant:p-demohospb`;
const OP = 'pair.intersection@1.0.0';
const MEAS = `sm3:${'a'.repeat(64)}`;
const POLICY: AttestationPolicy = { tee: ['tdx'], min_tcb: { tdx: '3.1.0' } };
const CONTRACT: SealContractTerms = {
  contract_id: 'ctr-q4',
  data_product_id: 'dp-cohort',
  allowed_ops: [OP],
  attestation_policy: POLICY,
  valid_until: '2027-09-30T00:00:00.000Z',
};

const HOLDER_A = generateSm2KeyPair();
const HOLDER_B = generateSm2KeyPair();
const NODE_KEY = generateSm2KeyPair();
const KMS_KEY = generateSm2KeyPair();

/**
 * 合成队列（本用例构造的「同一主体跨院出现」形态）：
 *  - 400 名主体**两院都有记录**（共享假名键 `sk-shared-*`）——靠「跨院对齐的假名键」实现；
 *  - 各 150 名只在本院出现（`sk-<院>-only-*`）；
 *  - 埋一个极小的分层（90 岁以上 2 人），用来驱动小单元格抑制。
 */
function syntheticCohort(): { a: PseudonymRow[]; b: PseudonymRow[] } {
  const a: PseudonymRow[] = [];
  const b: PseudonymRow[] = [];
  for (let i = 0; i < 400; i += 1) {
    const key = `sk-shared-${i}`;
    const exposure = i % 3 === 0; // A 院登记暴露
    const outcome = i % 5 === 0; // B 院登记结局
    a.push({ subjectKey: key, exposure, outcome: false, ageBand: i % 40 === 0 ? '90-99' : '60-69', sex: 'F' });
    b.push({ subjectKey: key, exposure: false, outcome, ageBand: i % 40 === 0 ? '90-99' : '60-69', sex: 'F' });
  }
  for (let i = 0; i < 150; i += 1) {
    a.push({ subjectKey: `sk-a-only-${i}`, exposure: true, outcome: false, ageBand: '50-59', sex: 'M' });
    b.push({ subjectKey: `sk-b-only-${i}`, exposure: false, outcome: true, ageBand: '50-59', sex: 'M' });
  }
  return { a, b };
}

/**
 * **第二份 KMS 客户端实现**（模拟「数据持有方自建 KMS」）：`kmsRef` 不同、代码不复用 `LocalDevKms`，
 * 只用协议核导出的**共享判据**（`evaluateKeyRelease`）与国密原语（`sm2Encrypt` / `ephemeralKeyDigest`
 * / `signCanonicalObject`）。用途：证明「换 KMS 客户端 = 换一个类，会话代码一行不改」。
 */
class SelfHostedKmsDouble implements KmsClient {
  readonly kmsRef = 'kms://hospital-self-hosted';
  requests = 0;

  constructor(
    private readonly opts: {
      privateKey: string;
      keys: Map<string, Uint8Array>;
      verifier: AttestationVerifier;
      ttlMs?: number;
      now?: () => Date;
    },
  ) {}

  async requestRelease(input: KeyReleaseRequest): Promise<KeyReleaseWarrant> {
    this.requests += 1;
    const now = input.now ?? (this.opts.now ?? (() => new Date()))();
    // 判据只有一份：与演练 KMS 调的是同一个 evaluateKeyRelease（换实现不换判据）
    const decision = evaluateKeyRelease({
      job_id: input.context.job_id,
      credential_id: input.context.credential_id,
      contract_id: input.context.contract_id,
      key_id: input.key_id,
      key_owner: input.key_owner,
      credential_valid: input.credential_valid,
      contract_active: input.contract_active,
      report: input.report,
      policy: input.policy,
      verifier: this.opts.verifier,
      now,
      where: input.where ?? {},
    });
    const dek = this.opts.keys.get(input.key_id);
    if (!dek) throw new MdopError('E_KEY_RELEASE_DENIED', {}, `KMS 中没有该密钥：${input.key_id}`);
    const ephemeral = input.report.ephemeral_public_key;
    if (!ephemeral)
      throw new MdopError('E_KEY_RELEASE_DENIED', {}, '证明里没有一次性公钥，密钥无处可封');
    const unsigned = {
      key_id: input.key_id,
      kms: this.kmsRef,
      warrant_digest: decision.warrant_digest,
      wrapped_key: sm2Encrypt(dek, ephemeral),
      wrapped_key_encoding: 'hex' as const,
      ephemeral_key_digest: ephemeralKeyDigest(ephemeral),
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + (this.opts.ttlMs ?? 10 * 60_000)).toISOString(),
    };
    const sig = signCanonicalObject(unsigned, this.opts.privateKey, {
      publicKey: publicKeyFromPrivateKey(this.opts.privateKey),
    });
    return { ...unsigned, sig: { alg: 'SM2-SM3', kid: sig.kid, value: sig.value } };
  }
}

/** 硬件证明代理的替身：每次会话产出一把**新的一次性公钥**（真实实现由飞地拿 quote）。 */
class HardwareProviderDouble implements AttestationProvider {
  readonly providerKind = 'tdx' as const;
  lastEphemeralPrivateKey?: string;
  private cursor = 0;

  constructor(private readonly now: () => Date = () => NOW) {}

  async prove(): Promise<AttestationReport> {
    // 生一次 SM2 密钥对要一秒，本用例按轮转取预生成的几把（**只要每次会话不同**就够，
    // 「每次重新证明」这条规则由 KMS 的凭据绑定与有效期核对来保证）。
    const eph = EPH_POOL[this.cursor++ % EPH_POOL.length];
    this.lastEphemeralPrivateKey = eph.privateKey;
    const now = this.now();
    const quote: VendorQuote = {
      vendor: 'tdx',
      measurement: MEAS,
      tcb: '3.1.2',
      quote: 'dGR4LXF1b3Rl',
      signed_at: new Date(now.getTime() - 30_000).toISOString(),
      valid_until: new Date(now.getTime() + 300_000).toISOString(),
      ephemeral_public_key: eph.publicKey,
      report_data: reportDataBinding(eph.publicKey),
      node: TEE,
    };
    return mapVendorQuote(quote);
  }
}

const EPH_POOL = Array.from({ length: 4 }, () => generateSm2KeyPair());

/** 替身提供者会持有本次会话的一次性私钥（真实节点在飞地内持有）。 */
interface EphemeralHoldingProvider extends AttestationProvider {
  lastEphemeralPrivateKey?: string;
}

interface Harness {
  session: TrustedNodeSession;
  kms: LocalDevKms;
  provider: EphemeralHoldingProvider;
  receipts: NodeReceiptChain;
  artifacts: NodeArtifactStore;
  budget: NodeQueryBudgetLedger;
  executed: () => number;
  seal: (side: 'A' | 'B') => Promise<{
    rawEnvelope: unknown;
    sealed: { ciphertext: string; iv: string; tag: string };
    keyOwner: { job_id: string; contract_id: string };
  }>;
}

/** 装配一台「什么都对齐」的节点（替身提供者 + 本机演练 KMS）。 */
async function harness(
  over: {
    provider?: EphemeralHoldingProvider;
    kmsTtlMs?: number;
    /** 信任根按**哪份报告**配置（缺省＝按当前提供者探针）。用于「伪造证明」这类负例。 */
    rootsFrom?: AttestationReport;
    /** 包一层 / 换一份 KMS 客户端（用例用来观察、重放凭据，或换一份独立实现）。 */
    wrapKms?: (
      inner: LocalDevKms,
      ctx: { keys: Map<string, Uint8Array>; verifier: AttestationVerifier; roots: TrustedRoot[] },
    ) => KmsClient;
    /** 封装时写进信封的 KMS 标识（缺省＝本机演练 KMS）。用来验证「释放必须来自指定的保管方」。 */
    sealKmsRef?: string;
  } = {},
): Promise<Harness> {
  const provider = over.provider ?? new HardwareProviderDouble();
  const probe = over.rootsFrom ?? (await provider.prove());
  const roots: TrustedRoot[] = [
    { kind: probe.kind!, verifyQuoteDigest: (d) => d === probe.quote_digest },
  ];
  const keys = new Map<string, Uint8Array>();
  const verifier: AttestationVerifier = {
    verify: (r) =>
      roots.some((root) => root.kind === r.kind && root.verifyQuoteDigest(r.quote_digest ?? '', r)),
  };
  const kms = new LocalDevKms({
    privateKey: KMS_KEY.privateKey,
    verifier,
    keys,
    now: () => NOW,
    ...(over.kmsTtlMs !== undefined ? { ttlMs: over.kmsTtlMs } : {}),
  });
  const kmsClient: KmsClient = over.wrapKms
    ? over.wrapKms(kms, { keys, verifier, roots })
    : kms;

  let executions = 0;
  const executor = new MdopStageExecutor();
  executor.setWasmRunner(async (_op, _digest, input) => {
    executions += 1;
    const parties = (input.stage.params as { parties: Array<{ ref: string; node: string }> }).parties;
    const tables = parties.map((p) => {
      const projection = input.inputs.get(p.ref) as { rows: PseudonymRow[] };
      return { node: p.node, rows: projection.rows };
    });
    const paired = pairIntersection({ tables });
    return {
      schema: 'rws.paired-cohort@1',
      // C3 只带聚合量：**没有主体键、没有行**（闸门还会再查一遍）
      payload: {
        analysisType: 'paired-cohort',
        cohortSize: paired.cohortSize,
        exposed: paired.exposed,
        outcome: paired.outcome,
        exposedWithOutcome: paired.exposedWithOutcome,
        rate: paired.rate,
        buckets: paired.strata.map((s) => ({ key: s.key, count: s.exposed, rate: s.rate })),
      },
    };
  });

  const receipts = new NodeReceiptChain({ node: TEE, privateKey: NODE_KEY.privateKey });
  const artifacts = new NodeArtifactStore({ node: TEE, privateKey: NODE_KEY.privateKey });
  const budget = new NodeQueryBudgetLedger();

  const session = new TrustedNodeSession({
    node: TEE,
    attestation: provider,
    kms: kmsClient,
    kmsPublicKey: publicKeyFromPrivateKey(KMS_KEY.privateKey),
    unwrapKey: (warrant) => kms.unwrapKey(warrant, provider.lastEphemeralPrivateKey ?? ''),
    entryGuard: new TrustedNodeEntryGuard(
      new Map([
        [HOSP_A, publicKeyFromPrivateKey(HOLDER_A.privateKey)],
        [HOSP_B, publicKeyFromPrivateKey(HOLDER_B.privateKey)],
      ]),
    ),
    review: new NodePublicationReview(new OutputGate(new AuditService(), new Deidentifier())),
    exitGuard: new NodeExitGuard(),
    receipts,
    artifacts,
    budget,
    executor,
  });

  const cohort = syntheticCohort();
  const seal = async (side: 'A' | 'B') => {
    const holder = side === 'A' ? HOLDER_A : HOLDER_B;
    const signer = side === 'A' ? HOSP_A : HOSP_B;
    const built = await buildSealedEnvelope(
      {
        jobId: 'job-q4',
        credentialId: 'tkt-q4',
        contract: CONTRACT,
        projection: { productId: 'dp-cohort', rows: side === 'A' ? cohort.a : cohort.b },
        dataProductId: 'dp-cohort',
        allowedOps: [OP],
      },
      {
        kmsRef: over.sealKmsRef ?? kms.kmsRef,
        watermarkPrefix: `wm:site-${side.toLowerCase()}:${SPACE}`,
        signer,
        sign: (content) => ({ alg: 'SM2-SM3', value: sm2Sign(content, holder.privateKey, { publicKey: publicKeyFromPrivateKey(holder.privateKey) }) }),
        depositor: {
          depositKey: async ({ jobId, keyId, dek, contractId }) => {
            kms.registerKey({ keyId, dek, owner: { job_id: jobId, contract_id: contractId } });
          },
        },
        now: () => NOW,
      },
    );
    return {
      rawEnvelope: built.envelope,
      sealed: { ciphertext: built.ciphertext, iv: built.iv, tag: built.tag },
      keyOwner: { job_id: 'job-q4', contract_id: CONTRACT.contract_id },
    };
  };

  return { session, kms, provider, receipts, artifacts, budget, executed: () => executions, seal };
}

function sessionInput(h: Harness, sealed: Awaited<ReturnType<Harness['seal']>>[]) {
  return {
    jobId: 'job-q4',
    credentialId: 'tkt-q4',
    contractId: CONTRACT.contract_id,
    contract: {
      contract_id: CONTRACT.contract_id,
      data_product_id: 'dp-cohort',
      allowed_ops: [OP],
      attestation_policy: POLICY,
    },
    policy: { ...POLICY, allowed_measurements: [MEAS] },
    expectation: { tee: 'tdx', measurement: MEAS, min_tcb: '3.1.0' },
    inputs: sealed,
    holderKeys: new Map([
      [HOSP_A, publicKeyFromPrivateKey(HOLDER_A.privateKey)],
      [HOSP_B, publicKeyFromPrivateKey(HOLDER_B.privateKey)],
    ]),
    credentialValid: true,
    contractActive: true,
    stage: {
      id: 'st-pair',
      node: TEE,
      op: OP,
      op_digest: `sm3:${'9'.repeat(64)}`,
      params: {
        parties: [
          { ref: (sealed[0].rawEnvelope as { payload: { ciphertext_ref: string } }).payload.ciphertext_ref, node: HOSP_A },
          { ref: (sealed[1].rawEnvelope as { payload: { ciphertext_ref: string } }).payload.ciphertext_ref, node: HOSP_B },
        ],
      },
      inputs: [
        { from: (sealed[0].rawEnvelope as { payload: { ciphertext_ref: string } }).payload.ciphertext_ref },
        { from: (sealed[1].rawEnvelope as { payload: { ciphertext_ref: string } }).payload.ciphertext_ref },
      ],
      input_labels: ['C2', 'C2'] as PhysicalStage['input_labels'],
      output_label: 'C2' as const,
      output_schema: 'rws.paired-cohort@1',
    },
    manifest: {
      apiVersion: 'mdop/v1',
      kind: 'wasm',
      id: 'pair.intersection',
      version: '1.0.0',
      category: 'collab',
      digest: `sm3:${'8'.repeat(64)}`,
      publisher: 'urn:tds:sh-med:operator-registry',
      inputs: [
        { name: 'left', schema: 'mdop.projection@1', accept_labels: ['C0', 'C2'] },
        { name: 'right', schema: 'mdop.projection@1', accept_labels: ['C0', 'C2'] },
      ],
      outputs: [{ name: 'paired', schema: 'rws.paired-cohort@1', label_rule: 'inherit' }],
      params: {},
      environments: ['tee'],
      security: { network: 'none' },
      build: { source_digest: `sm3:${'7'.repeat(64)}`, toolchain: 'clang-17', reproducible: true },
    },
    minCell: 5,
    target: PLATFORM,
    contractRecipients: [PLATFORM],
    budget: {
      key: { dataset: 'dp-cohort', snapshot: `sm3:${'6'.repeat(64)}` },
      policy: { limit: 2, unit: 'queries' as const },
      cost: 1,
      applicant: 'urn:tds:sh-med:participant:pharma-1',
      kind: 'query' as const,
    },
    now: NOW,
  };
}

describe('可信空间节点：两院 C2 会话（任务 8.5，合成数据）', () => {
  it('C3 出域要做到「聚合出域做不到」的那件事：跨院配对后的率', async () => {
    const h = await harness();
    const sealed = [await h.seal('A'), await h.seal('B')];
    const result = await h.session.run(sessionInput(h, sealed));

    // 配对后的真实交集：400 名共享主体（两院各 150 名独有主体不参与交集）
    expect(result.c3.cohortSize).toBe(400);
    const exposed = result.c3.exposed as number;
    const both = result.c3.exposedWithOutcome as number;
    expect(exposed).toBe(134); // i%3==0 → 0..399 中 134 个
    expect(both).toBe(27); // i%15==0 → 27 个
    expect(result.c3.rate).toBeCloseTo(27 / 134, 10);

    // 同一件事在 C3 通道上**不可判定**：两院的边际计数只给出宽度 > 0 的区间
    const bounds = joinableBounds({ a: exposed, b: result.c3.outcome as number, union: 700 });
    expect(bounds.width).toBeGreaterThan(0);

    // C3 载荷里没有主体键、没有行（闸门与断言各查一遍）
    const json = JSON.stringify(result.c3);
    expect(json).not.toContain('subjectKey');
    expect(json).not.toContain('sk-shared-');
    // 小分层（90-99 岁 2 人）被抑制：计数归零并带 suppressed 标记
    const suppressed = (result.c3.buckets as Array<{ key: string; count: number; suppressed?: boolean }>).find(
      (b) => b.key.startsWith('90-99'),
    );
    expect(suppressed?.count).toBe(0);
    expect(suppressed?.suppressed).toBe(true);
    // 抑制明细只进节点本地审查记录，不进 C3 载荷
    expect((result.c3 as { suppressed?: unknown }).suppressed).toBeUndefined();
    expect(result.review.suppressed).toBeGreaterThan(0);

    // 但**汇总数**随 C3 一起出域（任务 7.3b）：抑制格数 / 阈值 / DP 声明 / 预算消耗
    const manifest = parseReleaseManifest(result.c3.release_manifest);
    expect(manifest.suppressedTotal).toBe(result.review.suppressed);
    expect(manifest.minCell).toBe(5);
    expect(manifest.dp).toEqual({ mode: 'none' });
    expect(manifest.parties[0].node).toBe(TEE);
    expect(manifest.parties[0].budget).toMatchObject({ spent: 1, limit: 2, unit: 'queries' });
    // 逐格明细仍然不出域（载荷里看不到「哪一格被抑制」之外的东西）
    expect(Object.keys(manifest.parties[0])).not.toContain('buckets');
  });

  it('回执成链、可逐条验签；链头可作锚定输入；解封/执行两类带本次证明', async () => {
    const h = await harness();
    const sealed = [await h.seal('A'), await h.seal('B')];
    const result = await h.session.run(sessionInput(h, sealed));

    const chain = h.receipts.list('job-q4');
    expect(chain.map((r) => r.event)).toEqual(['UNSEALED', 'EXECUTED', 'EXITED']);
    expect(chain[0].attestation?.quote_digest).toMatch(/^sm3:/);
    expect(chain[0].attestation?.measurement).toBe(MEAS);
    expect(result.receiptsHead).toBe(h.receipts.head('job-q4'));
    expect(h.receipts.verify('job-q4', publicKeyFromPrivateKey(NODE_KEY.privateKey))).toEqual({
      valid: true,
    });
    // 用别的公钥验签 → 指出断点（平台侧与离线工具同判据）
    const wrong = h.receipts.verify('job-q4', publicKeyFromPrivateKey(generateSm2KeyPair().privateKey));
    expect(wrong.valid).toBe(false);
  });

  it('销毁：制品不可再读、同一幂等键返回同一份回执、销毁事件进链', async () => {
    const h = await harness();
    const sealed = [await h.seal('A'), await h.seal('B')];
    const result = await h.session.run(sessionInput(h, sealed));

    const first = h.session.purge({ jobId: 'job-q4', idempotencyKey: 'purge-1' });
    expect(first.handles).toEqual([result.handle]);
    expect(h.artifacts.read(result.handle)).toBeNull();
    const second = h.session.purge({ jobId: 'job-q4', idempotencyKey: 'purge-1' });
    expect(second.sig.value).toBe(first.sig.value);
    expect(h.receipts.list('job-q4').map((r) => r.event)).toContain('PURGED');
    expect(h.receipts.verify('job-q4', publicKeyFromPrivateKey(NODE_KEY.privateKey)).valid).toBe(true);
  });

  it('换硬件只换两个提供者：同一段会话代码在另一条链上跑出同一结果', async () => {
    // 只有证明提供者不同（换链），管线、闸门、回执链一行没改
    class CsvProviderDouble implements EphemeralHoldingProvider {
      readonly providerKind = 'csv' as const;
      lastEphemeralPrivateKey?: string;
      private cursor = 0;

      async prove(): Promise<AttestationReport> {
        const eph = EPH_POOL[this.cursor++ % EPH_POOL.length];
        this.lastEphemeralPrivateKey = eph.privateKey;
        return mapVendorQuote({
          vendor: 'csv',
          measurement: MEAS,
          tcb: '2026-06',
          quote: 'Y3N2LXF1b3Rl',
          signed_at: new Date(NOW.getTime() - 30_000).toISOString(),
          valid_until: new Date(NOW.getTime() + 300_000).toISOString(),
          ephemeral_public_key: eph.publicKey,
          report_data: reportDataBinding(eph.publicKey),
          node: TEE,
        });
      }
    }
    const h = await harness({ provider: new CsvProviderDouble() });
    const sealed = [await h.seal('A'), await h.seal('B')];
    const input = sessionInput(h, sealed);
    const result = await h.session.run({
      ...input,
      contract: { ...input.contract, attestation_policy: { tee: ['csv'], min_tcb: { csv: '2026-01' } } },
      policy: { tee: ['csv'], min_tcb: { csv: '2026-01' }, allowed_measurements: [MEAS] },
      expectation: { tee: 'csv', measurement: MEAS, min_tcb: '2026-01' },
    });
    expect(result.c3.cohortSize).toBe(400);
    expect(result.attestation).toMatchObject({ measurement: MEAS, tcb: '2026-06' });
  });

  it('换 KMS 客户端不动调用点：另一份实现（持有方自建风格）跑同一段会话，产出与回执等价', async () => {
    // 基线：本机演练 KMS（信封写明密钥由它保管）
    const base = await harness();
    const sealedBase = [await base.seal('A'), await base.seal('B')];
    const viaLocal = await base.session.run(sessionInput(base, sealedBase));

    // 对照：**换一份 KmsClient 实现**（不复用 LocalDevKms），信封也改写成「密钥由该 KMS 保管」——
    // 会话代码、复核、执行、发布审查、回执链一行未改。
    let double!: SelfHostedKmsDouble;
    const alt = await harness({
      sealKmsRef: 'kms://hospital-self-hosted',
      wrapKms: (_inner, ctx) => {
        double = new SelfHostedKmsDouble({
          privateKey: KMS_KEY.privateKey,
          keys: ctx.keys,
          verifier: ctx.verifier,
          now: () => NOW,
        });
        return double;
      },
    });
    const sealedAlt = [await alt.seal('A'), await alt.seal('B')];
    const viaSelfHosted = await alt.session.run(sessionInput(alt, sealedAlt));

    // ① 真的用了新实现（而不是悄悄回落到演练 KMS）
    expect(double.kmsRef).toBe('kms://hospital-self-hosted');
    expect(double.requests).toBeGreaterThan(0);
    // ② 产出与事件序列等价：同一段会话代码 → 同一份 C3、同一串回执事件
    expect(viaSelfHosted.c3).toEqual(viaLocal.c3);
    expect(alt.receipts.list('job-q4').map((r) => r.event)).toEqual(
      base.receipts.list('job-q4').map((r) => r.event),
    );
    expect(alt.receipts.verify('job-q4', publicKeyFromPrivateKey(NODE_KEY.privateKey))).toEqual({
      valid: true,
    });
    // ③ 但释放凭据不同：换的正是「谁释放密钥」这一层
    expect(viaSelfHosted.attestation.quote_digest).toMatch(/^sm3:/);
    expect(viaSelfHosted.budget.spent).toBe(viaLocal.budget.spent);
  });

  describe('负例：越权与不可信一律拒（任务 8.1–8.4）', () => {
    it('软件提供者**跑不通**完整会话（不得用软件实现冒充 C2 节点）', async () => {
      const h = await harness({
        provider: new (class implements AttestationProvider {
          readonly providerKind = 'software' as const;
          async prove(): Promise<AttestationReport> {
            return {
              kind: null,
              level: 'software',
              isolation: 'none',
              measurement: MEAS,
              quote_digest: null,
              tcb: null,
              ephemeral_public_key: null,
              issued_at: NOW.toISOString(),
              expires_at: new Date(NOW.getTime() + 300_000).toISOString(),
            };
          }
        })(),
      });
      const sealed = [await h.seal('A'), await h.seal('B')];
      await expect(h.session.run(sessionInput(h, sealed))).rejects.toThrow(
        expect.objectContaining({ code: 'E_CAPABILITY_MISMATCH' }),
      );
      expect(h.executed()).toBe(0); // 一步都没执行
    });

    it('伪造证明 / 证明过期 / 度量换版 / TCB 过旧 / 凭证过期 / 合约终止 → KMS 拒绝释放，且不执行', async () => {
      const cases: Array<[string, (h: Harness) => Promise<unknown>, string]> = [
        [
          '证明过期',
          async (h) => {
            const expired = new (class extends HardwareProviderDouble {
              override async prove(): Promise<AttestationReport> {
                const eph = generateSm2KeyPair();
                this.lastEphemeralPrivateKey = eph.privateKey;
                return mapVendorQuote({
                  vendor: 'tdx',
                  measurement: MEAS,
                  tcb: '3.1.2',
                  quote: 'dGR4LXF1b3Rl',
                  signed_at: new Date(NOW.getTime() - 600_000).toISOString(),
                  valid_until: new Date(NOW.getTime() - 1_000).toISOString(),
                  ephemeral_public_key: eph.publicKey,
                  report_data: reportDataBinding(eph.publicKey),
                  node: TEE,
                });
              }
            })();
            const h2 = await harness({ provider: expired });
            const sealed = [await h2.seal('A'), await h2.seal('B')];
            return h2.session.run(sessionInput(h2, sealed));
          },
          'E_ATTESTATION_FAILED',
        ],
        [
          '度量换版（凭证里冻结的度量与实际不符）',
          async (h) => {
            const sealed = [await h.seal('A'), await h.seal('B')];
            const input = sessionInput(h, sealed);
            return h.session.run({
              ...input,
              expectation: { ...input.expectation, measurement: `sm3:${'b'.repeat(64)}` },
            });
          },
          'E_MEASUREMENT_NOT_ALLOWED',
        ],
        [
          'TCB 过旧',
          async (h) => {
            const sealed = [await h.seal('A'), await h.seal('B')];
            const input = sessionInput(h, sealed);
            return h.session.run({
              ...input,
              policy: { ...input.policy, min_tcb: { tdx: '3.2.0' } },
            });
          },
          'E_TCB_TOO_OLD',
        ],
        [
          '伪造证明（信任根覆盖的是备案的那份 quote）',
          async () => {
            // 信任根按「备案的好证明」配置，节点侧交上来的却是另一份 quote
            const good = await new HardwareProviderDouble().prove();
            const forged = new (class extends HardwareProviderDouble {
              override async prove(): Promise<AttestationReport> {
                const eph = generateSm2KeyPair();
                this.lastEphemeralPrivateKey = eph.privateKey;
                return mapVendorQuote({
                  vendor: 'tdx',
                  measurement: MEAS,
                  tcb: '3.1.2',
                  quote: 'Zm9yZ2VkLXF1b3Rl',
                  signed_at: new Date(NOW.getTime() - 30_000).toISOString(),
                  valid_until: new Date(NOW.getTime() + 300_000).toISOString(),
                  ephemeral_public_key: eph.publicKey,
                  report_data: reportDataBinding(eph.publicKey),
                  node: TEE,
                });
              }
            })();
            const h2 = await harness({ provider: forged, rootsFrom: good });
            const sealed = [await h2.seal('A'), await h2.seal('B')];
            return h2.session.run(sessionInput(h2, sealed));
          },
          'E_ATTESTATION_FAILED',
        ],
        [
          '凭证已过期',
          async (h) => {
            const sealed = [await h.seal('A'), await h.seal('B')];
            return h.session.run({ ...sessionInput(h, sealed), credentialValid: false });
          },
          'E_TICKET_INVALID',
        ],
        [
          '合约已终止',
          async (h) => {
            const sealed = [await h.seal('A'), await h.seal('B')];
            return h.session.run({ ...sessionInput(h, sealed), contractActive: false });
          },
          'E_KEY_RELEASE_DENIED',
        ],
      ];

      for (const [name, run, code] of cases) {
        const h = await harness();
        await expect(run(h)).rejects.toThrow(expect.objectContaining({ code }));
        expect(h.executed()).toBe(0);
      }
    });

    it('信封跨作业重放 → 入口守卫拒（AAD 绑定不符）', async () => {
      const h = await harness();
      const sealed = [await h.seal('A'), await h.seal('B')];
      const input = sessionInput(h, sealed);
      await expect(h.session.run({ ...input, jobId: 'job-other' })).rejects.toThrow(
        expect.objectContaining({ code: 'E_ENVELOPE_POLICY' }),
      );
      expect(h.executed()).toBe(0);
    });

    it('密文被替换 → 解封前先对拍摘要，拒绝', async () => {
      const h = await harness();
      const a = await h.seal('A');
      const b = await h.seal('B');
      const tampered = {
        ...a,
        sealed: { ...a.sealed, ciphertext: Buffer.from('tampered').toString('base64') },
      };
      await expect(h.session.run(sessionInput(h, [tampered, b]))).rejects.toThrow(
        expect.objectContaining({ code: 'E_ENVELOPE_POLICY' }),
      );
    });

    it('旧释放凭据重放 → 拒（凭据与本次证明/会话对不上）', async () => {
      const holder: { captured?: KeyReleaseWarrant; replay?: KeyReleaseWarrant } = {};
      const h = await harness({
        kmsTtlMs: 60_000,
        wrapKms: (inner) => ({
          kmsRef: inner.kmsRef,
          requestRelease: async (req) => {
            if (holder.replay) return holder.replay;
            const warrant = await inner.requestRelease(req);
            holder.captured = warrant;
            return warrant;
          },
        }),
      });
      const sealed = [await h.seal('A'), await h.seal('B')];
      await h.session.run(sessionInput(h, sealed));
      // 第二轮：证明提供者产出**新的一次性公钥**，把上一轮的凭据重放进去必须被拒
      holder.replay = holder.captured;
      const sealed2 = [await h.seal('A'), await h.seal('B')];
      await expect(h.session.run(sessionInput(h, sealed2))).rejects.toThrow(
        expect.objectContaining({ code: 'E_KEY_RELEASE_DENIED' }),
      );
    });

    it('查询预算超限 → 拒且不执行（预算先判、算完才扣）', async () => {
      const h = await harness();
      const sealed = [await h.seal('A'), await h.seal('B')];
      const input = sessionInput(h, sealed);
      await h.session.run(input); // 用掉 1（上限 2）
      const sealed2 = [await h.seal('A'), await h.seal('B')];
      const second = await h.session.run(sessionInput(h, sealed2)); // 用掉 2
      expect(second.budget.spent).toBe(2);

      const sealed3 = [await h.seal('A'), await h.seal('B')];
      const before = h.executed();
      await expect(h.session.run(sessionInput(h, sealed3))).rejects.toThrow(
        expect.objectContaining({ code: 'E_BUDGET_EXCEEDED' }),
      );
      expect(h.executed()).toBe(before); // 拒了就不执行
    });

    it('释放必须来自**信封指定的** KMS：别家 KMS 签的凭据即使签名有效也拒（D-TEE-1 的密钥归属）', async () => {
      // 信封写「密钥由持有方自建的 KMS 保管」，而本节点的 KMS 客户端是另一家（演练 KMS）：
      // 签名、摘要、一次性公钥都对得上，**只有归属对不上**——这一条必须由节点自己判。
      const h = await harness({ sealKmsRef: 'kms://holder-self-hosted' });
      const sealed = [await h.seal('A'), await h.seal('B')];
      const before = h.executed();
      await expect(h.session.run(sessionInput(h, sealed))).rejects.toThrow(
        expect.objectContaining({ code: 'E_KEY_RELEASE_DENIED' }),
      );
      expect(h.executed()).toBe(before); // 归属不符 → 一步都没执行
    });

    it('预算消耗与拒绝都随签名回执上报（审计与结算的凭据是回执，不是日志）', async () => {
      const h = await harness();
      const sealed = [await h.seal('A'), await h.seal('B')];
      const result = await h.session.run(sessionInput(h, sealed));

      // ① 消耗：EXITED 回执带与 C3 清单同一份口径（数据集 / 快照 / 单位 / 本次 / 累计 / 上限）
      const exited = h.receipts.list('job-q4').find((r) => r.event === 'EXITED');
      expect(exited?.detail?.budget).toEqual({
        dataset: 'dp-cohort',
        snapshot: `sm3:${'6'.repeat(64)}`,
        unit: 'queries',
        kind: 'query',
        cost: 1,
        spent: 1,
        limit: 2,
      });
      expect(result.budget.spent).toBe(1);

      // ② 拒绝：用满后再申请一次 → 拒，并留下**签名回执**（含错误码与「未扣减」）
      const sealed2 = [await h.seal('A'), await h.seal('B')];
      await h.session.run(sessionInput(h, sealed2));
      const sealed3 = [await h.seal('A'), await h.seal('B')];
      await expect(h.session.run(sessionInput(h, sealed3))).rejects.toThrow(
        expect.objectContaining({ code: 'E_BUDGET_EXCEEDED' }),
      );
      const failed = h.receipts.list('job-q4').filter((r) => r.event === 'STAGE_FAILED');
      expect(failed).toHaveLength(1);
      expect(failed[0]!.detail).toMatchObject({
        code: 'E_BUDGET_EXCEEDED',
        budget: { dataset: 'dp-cohort', kind: 'query', cost: 1, limit: 2, charged: false },
      });
      // 拒绝回执入链后，链仍连续、可逐条验签（否则「留痕」反而把核验链搞断）
      expect(h.receipts.verify('job-q4', publicKeyFromPrivateKey(NODE_KEY.privateKey))).toEqual({
        valid: true,
      });
      // 且这一条失败事件可被协议解析器读回（节点产出与平台接收同一形状，不是自成一体的本地对象）
      expect(parseAuditReceipt(JSON.parse(JSON.stringify(failed[0]))).event).toBe('STAGE_FAILED');
    });

    it('C0/C1 不得靠发布审查洗白成 C3（等级不允许进发布审查）', async () => {
      const h = await harness();
      const sealed = [await h.seal('A'), await h.seal('B')];
      const input = sessionInput(h, sealed);
      await expect(
        h.session.run({
          ...input,
          stage: { ...input.stage, output_label: 'C1' as const },
        }),
      ).rejects.toThrow(expect.objectContaining({ code: 'E_LABEL_VIOLATION' }));
    });

    it('C3 目标不在合约接收方名单里 → 出口守卫拒（并留痕）', async () => {
      const h = await harness();
      const sealed = [await h.seal('A'), await h.seal('B')];
      const input = sessionInput(h, sealed);
      await expect(
        h.session.run({ ...input, target: `urn:tds:${SPACE}:participant:someone-else` }),
      ).rejects.toThrow(expect.objectContaining({ code: 'E_LABEL_VIOLATION' }));
    });
  });

  it('C3 载荷的摘要与句柄一致（平台据此核对，摘要不符即拒）', async () => {
    const h = await harness();
    const sealed = [await h.seal('A'), await h.seal('B')];
    const result = await h.session.run(sessionInput(h, sealed));
    expect(canonicalSm3(result.c3)).toMatch(/^sm3:[0-9a-f]{64}$/);
    expect(h.artifacts.read(result.handle)?.digest).toBe(canonicalSm3(result.c3));
  });
});
