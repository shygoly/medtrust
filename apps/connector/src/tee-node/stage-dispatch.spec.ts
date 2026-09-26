import {
  LocalDevKms,
  MdopError,
  canonicalSm3,
  canonicalize,
  generateSm2KeyPair,
  mapVendorQuote,
  parseMdopContract,
  parseReleaseManifest,
  publicKeyFromPrivateKey,
  publicKeyKid,
  sm2Sign,
  type AttestationPolicy,
  type AttestationReport,
  type PhysicalStage,
  type TrustedRoot,
  type VendorQuote,
} from '@medtrust/mdop';
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { OutputGate } from '../domain/output-gate';
import { MdopStageExecutor } from '../mdop/mdop-executor';
import { MdopOutboundClient } from '../mdop/mdop-client';
import { NodeQueryBudgetLedger } from '../mdop/node/budget-ledger';
import { TrustedNodeEntryGuard } from '../mdop/node/entry-guard';
import { NodeArtifactStore } from '../mdop/node/node-artifacts';
import { NodeExitGuard } from '../mdop/node/node-exit';
import { NodeReceiptChain } from '../mdop/node/node-receipts';
import { TrustedNodeSession } from '../mdop/node/node-session';
import { pairIntersection, type PseudonymRow } from '../mdop/node/pairing';
import { NodePublicationReview } from '../mdop/node/publication-review';
import { buildSealedEnvelope, type SealContractTerms } from '../mdop/operators/seal';
import { NodeContractStore } from './contract-store';
import { NODE_DECLASSIFY_OP, registerNodeDeclassifyOperator } from './declassify-op';
import { NodeReceiptReporter } from './receipt-report';
import {
  dispatchNodeStage,
  hasSameNodeDownstream,
  localArtifactHandle,
  type NodeStageDispatchDeps,
  type NodeStageDispatchInput,
} from './stage-dispatch';

/**
 * 节点侧**「配对 → 降密」两阶段**（任务 3.12d，合成数据）。
 *
 * 这个用例要钉住的是**落点**，而不是算子自身：
 *  ① 第一段（`pair`，吃两家持有方封存的 C2 信封）**不出节点**：C2 制品进本节点制品库，
 *     平台只收到句柄登记（`ArtifactReady`，label=C2）与每份释放的见证，**没有任何载荷投递**；
 *  ② 第二段（`decTee`，吃节点内制品）过发布审查 → C3 → 出口 → 投递载荷 + 登记句柄 + 回执成链；
 *  ③ 出口与否只看**片段里的结构事实**：本阶段产物有没有同节点下游；
 *  ④ 负例：没有发布审查记录就不许出口；上游制品不在本节点就不执行；中间阶段产出 C3 即拒。
 *
 * 如实边界：证明提供者与 KMS 仍是**替身**（真实链条见 §3.2 / §4.x），换的是接口不是结论；
 * 但本用例里跑的是节点组件的**真实装配**（入口守卫、KMS 释放判据、解封、审查、出口守卫、回执链）。
 */

const NOW = new Date('2026-09-25T10:00:00.000Z');
const SPACE = 'sh-med';
const NODE = `urn:tds:${SPACE}:participant:tee-1`;
const PLATFORM = `urn:tds:${SPACE}:participant:platform`;
const HOSP_A = `urn:tds:${SPACE}:participant:p-huashan`;
const HOSP_B = `urn:tds:${SPACE}:participant:p-ruijin`;
const PAIR_OP = 'rws.paired-cohort@1.0.0';
const JOB = 'job-paired';
const TICKET = 'tkt-paired';
const MEAS = `sm3:${'a'.repeat(64)}`;
const POLICY: AttestationPolicy = { tee: ['tdx'], min_tcb: { tdx: '3.1.0' } };
const CONTRACT: SealContractTerms = {
  contract_id: 'ctr-paired',
  data_product_id: 'dp-cohort',
  allowed_ops: [PAIR_OP, NODE_DECLASSIFY_OP],
  attestation_policy: POLICY,
  valid_until: '2027-09-30T00:00:00.000Z',
};

const HOLDER_A = generateSm2KeyPair();
const HOLDER_B = generateSm2KeyPair();
const PLATFORM_KEYS = generateSm2KeyPair();
const NODE_KEYS = generateSm2KeyPair();
const KMS_KEY = generateSm2KeyPair();
const EPH_POOL = Array.from({ length: 4 }, () => generateSm2KeyPair());

/** 硬件证明代理替身：每次证明产出一把**新的一次性公钥**（真实实现由飞地拿 quote）。 */
class HardwareProviderDouble {
  readonly providerKind = 'tdx' as const;
  lastEphemeralPrivateKey?: string;
  private cursor = 0;

  async prove(): Promise<AttestationReport> {
    const eph = EPH_POOL[this.cursor++ % EPH_POOL.length];
    this.lastEphemeralPrivateKey = eph.privateKey;
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

/** 合成队列：400 名主体两院都有记录、各 150 名只在本院，另埋一个 2 人的极小分层。 */
function syntheticCohort(): { a: PseudonymRow[]; b: PseudonymRow[] } {
  const a: PseudonymRow[] = [];
  const b: PseudonymRow[] = [];
  for (let i = 0; i < 400; i += 1) {
    const key = `sk-shared-${i}`;
    a.push({
      subjectKey: key,
      exposure: i % 3 === 0,
      outcome: false,
      ageBand: i % 40 === 0 ? '90-99' : '60-69',
      sex: 'F',
    });
    b.push({
      subjectKey: key,
      exposure: false,
      outcome: i % 5 === 0,
      ageBand: i % 40 === 0 ? '90-99' : '60-69',
      sex: 'F',
    });
  }
  for (let i = 0; i < 150; i += 1) {
    a.push({ subjectKey: `sk-a-only-${i}`, exposure: true, outcome: false, ageBand: '50-59', sex: 'M' });
    b.push({ subjectKey: `sk-b-only-${i}`, exposure: false, outcome: true, ageBand: '50-59', sex: 'M' });
  }
  return { a, b };
}

/** 节点收到的出站消息（控制面 message / 数据面 delivery 分开记）。 */
interface SentItem {
  kind: 'message' | 'delivery';
  msgType: string;
  body?: unknown;
  payload?: unknown;
}

interface Harness {
  deps: NodeStageDispatchDeps;
  fragment: unknown;
  pairInput: (sealed: Sealed[], over?: Partial<NodeStageDispatchInput>) => NodeStageDispatchInput;
  decInput: (over?: Partial<NodeStageDispatchInput>) => NodeStageDispatchInput;
  seal: (side: 'A' | 'B') => Promise<Sealed>;
  sent: SentItem[];
  artifacts: NodeArtifactStore;
  receipts: NodeReceiptChain;
  budget: NodeQueryBudgetLedger;
  executor: MdopStageExecutor;
  declassify: ReturnType<typeof registerNodeDeclassifyOperator>;
}

interface Sealed {
  rawEnvelope: unknown;
  sealed: { ciphertext: string; iv: string; tag: string };
}

const PAIR_STAGE: PhysicalStage = {
  id: 'pair',
  node: NODE,
  op: PAIR_OP,
  op_digest: `sm3:${'9'.repeat(64)}`,
  params: {},
  inputs: [{ from: 'ref-a' }, { from: 'ref-b' }],
  input_labels: ['C2', 'C2'],
  output_label: 'C2',
  output_schema: 'rws.paired-cohort@1',
};

const DEC_STAGE: PhysicalStage = {
  id: 'dec',
  node: NODE,
  op: NODE_DECLASSIFY_OP,
  op_digest: 'component:node-publication-review@1',
  params: { minCell: 5, contractId: CONTRACT.contract_id },
  inputs: [{ from: 'pair' }],
  input_labels: ['C2'],
  output_label: 'C3',
  output_schema: 'mdop.table/1.0',
};

const PAIR_MANIFEST = {
  apiVersion: 'mdop/v1',
  kind: 'wasm',
  id: 'rws.paired-cohort',
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
  build: { source_digest: `sm3:${'7'.repeat(64)}`, toolchain: 'asc@0.27.37', reproducible: true },
};

/** 节点内「吃 C0 产 C0」的机制算子清单（用例用来验 C0 制品不登记对外句柄）。 */
const LOCAL_MANIFEST = {
  apiVersion: 'mdop/v0.2',
  kind: 'system',
  id: 'merge.rows',
  version: '1.0.0',
  category: 'merge',
  digest: 'component:local@1',
  publisher: 'urn:tds:platform',
  inputs: [{ name: 'in', schema: 'mdop.table/1.0', accept_labels: ['C0'] }],
  outputs: [{ name: 'out', schema: 'mdop.table/1.0', label_rule: 'inherit' }],
  params: {},
  environments: ['tee'],
  security: { network: 'none' },
  component: 'merge-rows@1.0.0',
};

const DEC_MANIFEST = {
  apiVersion: 'mdop/v0.2',
  kind: 'system',
  id: 'declassify.small_cell',
  version: '1.0.0',
  category: 'declassify',
  digest: 'component:node-publication-review@1',
  publisher: 'urn:tds:platform',
  inputs: [{ name: 'in', schema: 'rws.paired-cohort@1', accept_labels: ['C2'] }],
  outputs: [{ name: 'out', schema: 'mdop.table/1.0', label_rule: 'C3' }],
  params: {},
  environments: ['tee'],
  security: { network: 'none' },
  component: 'node-publication-review@1.0.0',
};

/** 片段：两个阶段都在本节点，`dec` 吃 `pair` 的产物 → pair 是节点内中间阶段。 */
function fragmentWith(decNode = NODE): unknown {
  return {
    node: NODE,
    stages: [PAIR_STAGE, { ...DEC_STAGE, node: decNode }],
    edges: [
      { from_stage: 'pair', to_stage: 'dec', label: 'C2', from_node: NODE, to_node: decNode },
    ],
  };
}

/** 双签合约副本（持有方签名 + 平台副署；公钥来源都不取自消息）。 */
function contractCopy() {
  const canonical = canonicalize(
    parseMdopContract({
      apiVersion: 'mdop/v0.2',
      contract_id: CONTRACT.contract_id,
      data_product_id: CONTRACT.data_product_id,
      provider: HOSP_A,
      consumer: `urn:tds:${SPACE}:participant:p-meddata`,
      purpose: 'RWS.EFFECTIVENESS',
      retention: '阅后即焚',
      recipients: [
        { party: PLATFORM, role: 'merger', jurisdiction: 'CN' },
        { party: HOSP_A, role: 'final', jurisdiction: 'CN' },
      ],
      allowed_ops: [PAIR_OP, NODE_DECLASSIFY_OP],
      review: { mode: 'auto', deadline_hours: 24 },
      ethics: { required: false, ref: null, valid_until: null },
      provider_public_key_kid: publicKeyKid(HOLDER_A.publicKey),
      platform_public_key_kid: publicKeyKid(PLATFORM_KEYS.publicKey),
      pre_review_snapshot: null,
      publication: { minCell: 5 },
      valid_from: '2026-09-01T00:00:00.000Z',
      valid_until: '2027-09-01T00:00:00.000Z',
      attestation_policy: POLICY,
    }),
  );
  return {
    canonical,
    holderSignature: sm2Sign(canonical, HOLDER_A.privateKey, {
      publicKey: HOLDER_A.publicKey,
    }),
    platformCountersignature: sm2Sign(canonical, PLATFORM_KEYS.privateKey, {
      publicKey: PLATFORM_KEYS.publicKey,
    }),
  };
}

async function harness(): Promise<Harness> {
  const provider = new HardwareProviderDouble();
  const probe = await provider.prove();
  const roots: TrustedRoot[] = [
    { kind: 'tdx', verifyQuoteDigest: (d) => d === probe.quote_digest },
  ];
  const keys = new Map<string, Uint8Array>();
  const kms = new LocalDevKms({
    privateKey: KMS_KEY.privateKey,
    verifier: {
      verify: (r) => roots.some((root) => root.kind === r.kind && root.verifyQuoteDigest(r.quote_digest ?? '', r)),
    },
    keys,
    now: () => NOW,
  });

  const executor = new MdopStageExecutor();
  // 一个「吃节点内 C0、产出 C0」的本地机制算子（用例用来验「C0 制品不登记对外句柄」）
  executor.registerSystem('merge.rows@1.0.0', async () => ({
    label: 'C0' as const,
    schema: 'mdop.table/1.0',
    payload: { count: 3 },
  }));
  executor.setWasmRunner(async (_opRef, _digest, input) => {
    const parties = input.stage.params.parties as Array<{ ref: string; node: string }>;
    const tables = parties.map((p) => ({
      node: p.node,
      rows: (input.inputs.get(p.ref) as { rows: PseudonymRow[] }).rows,
    }));
    const paired = pairIntersection({ tables });
    return {
      schema: 'rws.paired-cohort@1',
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

  const receipts = new NodeReceiptChain({ node: NODE, privateKey: NODE_KEYS.privateKey });
  const artifacts = new NodeArtifactStore({ node: NODE, privateKey: NODE_KEYS.privateKey });
  const budget = new NodeQueryBudgetLedger();
  const review = new NodePublicationReview(new OutputGate(new AuditService(), new Deidentifier()));
  const declassify = registerNodeDeclassifyOperator(executor, {
    review,
    contractTerms: async () => JSON.parse(contractCopy().canonical) as Record<string, unknown>,
  });

  const session = new TrustedNodeSession({
    node: NODE,
    attestation: provider,
    kms,
    kmsPublicKey: publicKeyFromPrivateKey(KMS_KEY.privateKey),
    unwrapKey: (warrant) => kms.unwrapKey(warrant, provider.lastEphemeralPrivateKey ?? ''),
    entryGuard: new TrustedNodeEntryGuard(
      new Map([
        [HOSP_A, publicKeyFromPrivateKey(HOLDER_A.privateKey)],
        [HOSP_B, publicKeyFromPrivateKey(HOLDER_B.privateKey)],
      ]),
    ),
    review,
    exitGuard: new NodeExitGuard(),
    receipts,
    artifacts,
    budget,
    executor,
  });

  const outbound = new MdopOutboundClient({
    baseUrl: 'http://127.0.0.1:1/api/v1',
    participantId: 'tee-1',
    privateKey: NODE_KEYS.privateKey,
  });
  const sent: SentItem[] = [];
  (outbound as unknown as { sendMessage: unknown }).sendMessage = async (envelope: {
    msg_type: string;
    body: unknown;
  }) => {
    sent.push({ kind: 'message', msgType: envelope.msg_type, body: envelope.body });
    return { ok: true };
  };
  (outbound as unknown as { sendDelivery: unknown }).sendDelivery = async (
    envelope: { body: unknown },
    _handle: unknown,
    payload: unknown,
  ) => {
    sent.push({ kind: 'delivery', msgType: 'DELIVERY', body: envelope.body, payload });
    return { ok: true };
  };

  const contracts = new NodeContractStore();
  // 合约副本预先验签存档（与「随中继带来副本」是同一条判据；这里先存好，
  // 便于单独验证各阶段自身的护栏）
  contracts.verifyAndStore({
    ...contractCopy(),
    platformPublicKey: PLATFORM_KEYS.publicKey,
    holderPublicKey: publicKeyFromPrivateKey(HOLDER_A.privateKey),
    now: NOW,
  });
  const deps: NodeStageDispatchDeps = {
    node: NODE,
    session,
    artifacts,
    contracts,
    platformPublicKey: PLATFORM_KEYS.publicKey,
    outbound,
    platform: PLATFORM,
    declassify,
    receipts: new NodeReceiptReporter({ receipts, outbound, platform: PLATFORM }),
  };

  const cohort = syntheticCohort();
  const seal = async (side: 'A' | 'B'): Promise<Sealed> => {
    const holder = side === 'A' ? HOLDER_A : HOLDER_B;
    const signer = side === 'A' ? HOSP_A : HOSP_B;
    const built = await buildSealedEnvelope(
      {
        jobId: JOB,
        credentialId: TICKET,
        contract: CONTRACT,
        projection: { productId: 'dp-cohort', rows: side === 'A' ? cohort.a : cohort.b },
        dataProductId: 'dp-cohort',
        allowedOps: [PAIR_OP, NODE_DECLASSIFY_OP],
      },
      {
        kmsRef: kms.kmsRef,
        watermarkPrefix: `wm:site-${side.toLowerCase()}:${SPACE}`,
        signer,
        sign: (content) => ({
          alg: 'SM2-SM3',
          value: sm2Sign(content, holder.privateKey, {
            publicKey: publicKeyFromPrivateKey(holder.privateKey),
          }),
        }),
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
    };
  };

  const holderKeys = new Map([
    [HOSP_A, publicKeyFromPrivateKey(HOLDER_A.privateKey)],
    [HOSP_B, publicKeyFromPrivateKey(HOLDER_B.privateKey)],
  ]);
  const budgetInput = {
    key: { dataset: 'dp-cohort', snapshot: `sm3:${'6'.repeat(64)}` },
    policy: { limit: 3, unit: 'queries' as const },
    cost: 1,
    applicant: 'urn:tds:sh-med:participant:pharma-1',
  };

  const relayOf = (side: 'A' | 'B', sealed: Sealed) => ({
    data_envelope: sealed.rawEnvelope,
    sealed: sealed.sealed,
    holder: side === 'A' ? HOSP_A : HOSP_B,
    credential_id: TICKET,
  });

  const pairInput = (
    sealedList: Sealed[],
    over: Partial<NodeStageDispatchInput> = {},
  ): NodeStageDispatchInput => {
    const refs = sealedList.map(
      (s) => (s.rawEnvelope as { payload: { ciphertext_ref: string } }).payload.ciphertext_ref,
    );
    return {
      jobId: JOB,
      credentialId: TICKET,
      contractId: CONTRACT.contract_id,
      stage: {
        ...PAIR_STAGE,
        inputs: refs.map((from) => ({ from })),
        params: {
          parties: [
            { ref: refs[0], node: HOSP_A },
            { ref: refs[1], node: HOSP_B },
          ],
        },
      },
      manifest: PAIR_MANIFEST,
      minCell: 5,
      budget: budgetInput,
      policy: { ...POLICY, allowed_measurements: [MEAS] },
      expectation: { tee: 'tdx', measurement: MEAS, min_tcb: '3.1.0' },
      holderKeys,
      relays: [relayOf('A', sealedList[0]), relayOf('B', sealedList[1])],
      contractCopy: contractCopy(),
      now: NOW,
      ...over,
    };
  };

  const decInput = (over: Partial<NodeStageDispatchInput> = {}): NodeStageDispatchInput => ({
    jobId: JOB,
    credentialId: TICKET,
    contractId: CONTRACT.contract_id,
    stage: DEC_STAGE,
    manifest: DEC_MANIFEST,
    minCell: 5,
    budget: budgetInput,
    policy: { ...POLICY, allowed_measurements: [MEAS] },
    expectation: { tee: 'tdx', measurement: MEAS, min_tcb: '3.1.0' },
    holderKeys,
    fragment: fragmentWith(),
    // 原始持有方来自解封阶段（本阶段不从消息里取）
    originHolders: [HOSP_A, HOSP_B],
    now: NOW,
    ...over,
  });

  return {
    deps,
    fragment: fragmentWith(),
    pairInput,
    decInput,
    seal,
    sent,
    artifacts,
    receipts,
    budget,
    executor,
    declassify,
  };
}

describe('节点侧两阶段：配对（留在节点内）→ 降密（出口 C3）（任务 3.12d）', () => {
  it('第一段只留在节点本地：C2 制品不出域、只登记句柄与见证，没有任何载荷投递', async () => {
    const h = await harness();
    const sealed = [await h.seal('A'), await h.seal('B')];
    const pair = await dispatchNodeStage(h.deps, h.pairInput(sealed, { fragment: h.fragment }));

    expect(pair).toMatchObject({ label: 'C2', published: false, delivered: false, witnesses: 2 });
    expect(pair.handle).toBe(localArtifactHandle(NODE, JOB, 'pair'));

    // C2 中间制品在本节点制品库；第二段还没跑，所以 dec 的产物不存在
    expect(h.artifacts.read(pair.handle)?.label).toBe('C2');
    expect(h.artifacts.read(localArtifactHandle(NODE, JOB, 'dec'))).toBeNull();

    // 平台侧只看到句柄（label=C2）与两条见证，**没有**数据面投递
    expect(h.sent.filter((s) => s.kind === 'delivery')).toHaveLength(0);
    expect(h.sent.map((s) => s.msgType)).toEqual([
      'ArtifactReady',
      'AttestationReport',
      'AttestationReport',
      'AuditReceipt',
      'AuditReceipt',
      'StageStatus',
    ]);
    const ready = h.sent[0].body as { handle: { label: string; digest: string } };
    expect(ready.handle.label).toBe('C2');
    expect(ready.handle.digest).toBe(pair.digest);
    // 阶段状态也上报（平台据此把下游阶段置为就绪）；状态里只有摘要与等级
    const status = h.sent[5].body as { stage_id: string; status: string; label: string; attempt: number };
    expect(status).toMatchObject({ stage_id: 'pair', status: 'SUCCEEDED', label: 'C2', attempt: 1 });
    expect(JSON.stringify(status)).not.toContain('sk-shared-');

    // 明文一个字节都没出去（信封里是密文，句柄里只有摘要）
    const wire = JSON.stringify(h.sent);
    expect(wire).not.toContain('sk-shared-');
    expect(wire).not.toContain('subjectKey');

    // 回执链：解封 + 执行两个事件（没有出口事件——它没出口）
    expect(h.receipts.list(JOB).map((r) => r.event)).toEqual(['UNSEALED', 'EXECUTED']);
  });

  it('第二段吃节点内制品：过发布审查 → C3 → 投递载荷 + 回执成链 + 预算只扣一次', async () => {
    const h = await harness();
    const sealed = [await h.seal('A'), await h.seal('B')];
    await dispatchNodeStage(h.deps, h.pairInput(sealed, { fragment: h.fragment }));

    const dec = await dispatchNodeStage(h.deps, h.decInput());
    expect(dec).toMatchObject({ label: 'C3', published: true, delivered: true, witnesses: 0 });

    const deliveries = h.sent.filter((s) => s.kind === 'delivery');
    expect(deliveries).toHaveLength(1);
    const payload = deliveries[0].payload as Record<string, unknown>;
    // 跨院配对后的率：只有汇聚个体级数据才算得出的那件事
    expect(payload.cohortSize).toBe(400);
    expect(payload.exposedWithOutcome).toBe(27);
    // 载荷里没有主体键、没有行；小分层被抑制
    expect(JSON.stringify(payload)).not.toContain('subjectKey');
    const suppressed = (payload.buckets as Array<{ key: string; count: number; suppressed?: boolean }>).find(
      (b) => b.key.startsWith('90-99'),
    );
    expect(suppressed?.count).toBe(0);
    expect(suppressed?.suppressed).toBe(true);
    // 随行清单：抑制格数 / 阈值 / 预算消耗都出域（汇总数，不是逐格明细）
    const manifest = parseReleaseManifest(payload.release_manifest);
    expect(manifest.minCell).toBe(5);
    expect(manifest.suppressedTotal).toBeGreaterThan(0);
    expect(manifest.parties[0]).toMatchObject({ node: NODE });
    expect(manifest.parties[0].budget).toMatchObject({ spent: 1, limit: 3, unit: 'queries' });

    // 句柄登记在数据面投递之前（先控制面通报，再送载荷）
    const tail = h.sent.slice(6).map((s) => s.msgType);
    expect(tail[0]).toBe('ArtifactReady');
    expect(tail[1]).toBe('DELIVERY');
    expect(tail).toEqual(['ArtifactReady', 'DELIVERY', 'AuditReceipt', 'AuditReceipt', 'StageStatus']);
    const decStatus = h.sent[h.sent.length - 1].body as { stage_id: string; status: string; label: string };
    expect(decStatus).toMatchObject({ stage_id: 'dec', status: 'SUCCEEDED', label: 'C3' });

    // 回执链：解封 → 执行（配对）→ 执行（降密）→ 出口；链可逐条验签
    expect(h.receipts.list(JOB).map((r) => r.event)).toEqual([
      'UNSEALED',
      'EXECUTED',
      'EXECUTED',
      'EXITED',
    ]);
    expect(h.receipts.verify(JOB, publicKeyFromPrivateKey(NODE_KEYS.privateKey)).valid).toBe(true);
    expect(h.receipts.verify(JOB, publicKeyFromPrivateKey(HOLDER_A.privateKey)).valid).toBe(false);

    // 预算：解封阶段只判不扣，出口前扣一次 → 两阶段合计 1
    expect(h.budget.used({ dataset: 'dp-cohort', snapshot: `sm3:${'6'.repeat(64)}` })).toBe(1);
  });

  it('出口判据是**片段里的结构事实**：有同节点下游＝留在节点内，别处下游或没有下游＝可出口', () => {
    expect(hasSameNodeDownstream(fragmentWith(), 'pair', NODE)).toBe(true);
    expect(hasSameNodeDownstream(fragmentWith(), 'dec', NODE)).toBe(false);
    expect(hasSameNodeDownstream(fragmentWith(HOSP_A), 'pair', NODE)).toBe(false);
    // 片段非法（缺字段）→ fail-closed（抛错），不当成「没有下游」
    expect(() => hasSameNodeDownstream({ node: NODE, stages: [PAIR_STAGE] }, 'pair', NODE)).toThrow();
  });

  it('负例：上游制品不在本节点 → 拒执行（不猜、不空算）', async () => {
    const h = await harness();
    await expect(dispatchNodeStage(h.deps, h.decInput())).rejects.toThrow(
      expect.objectContaining({ code: 'E_RUNTIME' }),
    );
    // 一次都没执行，但**失败状态照报**：否则平台会一直等这一阶段
    expect(h.sent.map((s) => s.msgType)).toEqual(['StageStatus']);
    const status = h.sent[0].body as { status: string; code: string };
    expect(status).toMatchObject({ status: 'FAILED', code: 'E_RUNTIME' });
    expect(h.receipts.list(JOB)).toHaveLength(0);
  });

  it('负例：产出 C3 却没有发布审查记录 → 不许出口', async () => {
    const h = await harness();
    const sealed = [await h.seal('A'), await h.seal('B')];
    await dispatchNodeStage(h.deps, h.pairInput(sealed, { fragment: h.fragment }));
    const before = h.sent.length;
    await expect(
      dispatchNodeStage(
        // 记录来源与产物不匹配（例如算子没注册、或产物不是本节点审查出来的）
        { ...h.deps, declassify: { recordFor: () => undefined } },
        h.decInput(),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: 'E_RELEASE_CHECK_FAILED' }));
    expect(h.sent.filter((s) => s.kind === 'delivery')).toHaveLength(0);
    // 拒绝发生在出口之前：只多了一条「失败状态」，没有任何句柄/载荷出去
    expect(h.sent).toHaveLength(before + 1);
    const status = h.sent[h.sent.length - 1].body as { status: string; code: string };
    expect(status).toMatchObject({ status: 'FAILED', code: 'E_RELEASE_CHECK_FAILED' });
  });

  it('负例：声明为节点内中间阶段却产出 C3 → 拒（C3 是出口形态，不是节点内中间形态）', async () => {
    const h = await harness();
    const sealed = [await h.seal('A'), await h.seal('B')];
    const input = h.pairInput(sealed, { fragment: h.fragment });
    await expect(
      dispatchNodeStage(h.deps, { ...input, stage: { ...input.stage, output_label: 'C3' } }),
    ).rejects.toThrow(expect.objectContaining({ code: 'E_LABEL_VIOLATION' }));
    // 什么都没登记、什么都没投递；只有一条失败状态
    expect(h.sent.map((s) => s.msgType)).toEqual(['StageStatus']);
    expect((h.sent[0].body as { code: string }).code).toBe('E_LABEL_VIOLATION');
  });

  it('本地阶段产出 C0 → 只留节点本地，不登记对外句柄（规格「登记节点内的 C0 句柄」）', async () => {
    const h = await harness();
    // 先在节点制品库里放一份 C0 上游（模拟节点内已解封/本地产出的明文中间制品）
    h.artifacts.put({
      handle: localArtifactHandle(NODE, JOB, 'srcLocal'),
      jobId: JOB,
      label: 'C0',
      digest: canonicalSm3({ rows: 3 }),
      payload: { rows: 3 },
      expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    });
    const before = h.sent.length;
    const out = await dispatchNodeStage(h.deps, {
      ...h.decInput(),
      stage: {
        id: 'localCnt',
        node: NODE,
        op: 'merge.rows@1.0.0',
        op_digest: 'component:local@1',
        params: {},
        inputs: [{ from: 'srcLocal' }],
        input_labels: ['C0'],
        output_label: 'C0',
        output_schema: 'mdop.table/1.0',
      } as never,
      manifest: LOCAL_MANIFEST,
    });
    expect(out).toMatchObject({ label: 'C0', published: false, delivered: false });
    // 制品在节点本地（下游阶段按同一句柄取用）
    expect(h.artifacts.read(localArtifactHandle(NODE, JOB, 'localCnt'))?.label).toBe('C0');
    // **不登记对外句柄**：这一轮只发 StageStatus，没有 ArtifactReady、也没有载荷投递
    const outward = h.sent.slice(before);
    expect(outward.some((s) => s.msgType === 'ArtifactReady')).toBe(false);
    expect(outward.some((s) => s.kind === 'delivery')).toBe(false);
    const status = outward.find((s) => s.msgType === 'StageStatus')?.body as {
      stage_id: string;
      label: string;
      status: string;
    };
    expect(status).toMatchObject({ stage_id: 'localCnt', label: 'C0', status: 'SUCCEEDED' });
  });

  it('降密算子：合约与参数取较大值；缺 minCell 即拒（fail-closed）', async () => {
    const executor = new MdopStageExecutor();
    registerNodeDeclassifyOperator(executor, {
      review: new NodePublicationReview(new OutputGate(new AuditService(), new Deidentifier())),
    });
    const stage: PhysicalStage = { ...DEC_STAGE, params: {} };
    await expect(
      executor.execute(
        {
          jobId: JOB,
          stage,
          inputs: new Map([['pair', { buckets: [{ key: 'all', count: 100 }] }]]),
          attempt: 1,
        },
        DEC_MANIFEST,
      ),
    ).rejects.toThrow(MdopError);

    // 合约 minCell=5、参数 minCell=1 → 取较大值 5：4 人的格子被抑制
    const strict = new MdopStageExecutor();
    registerNodeDeclassifyOperator(strict, {
      review: new NodePublicationReview(new OutputGate(new AuditService(), new Deidentifier())),
      contractTerms: () => ({ publication: { minCell: 5 } }),
    });
    const gated = await strict.execute(
      {
        jobId: JOB,
        stage: { ...DEC_STAGE, params: { minCell: 1 } },
        inputs: new Map([
          ['pair', { analysisType: 'paired-cohort', buckets: [{ key: '80-89', count: 4 }] }],
        ]),
        attempt: 1,
      },
      DEC_MANIFEST,
    );
    expect(gated.label).toBe('C3');
    expect((gated.payload.buckets as Array<{ count: number }>)[0].count).toBe(0);
  });
});
