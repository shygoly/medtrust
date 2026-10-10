import {
  LocalDevKms,
  canonicalSm3,
  canonicalize,
  computePlanHash,
  fragmentHash,
  generateSm2KeyPair,
  mapVendorQuote,
  reportDataBinding,
  parseMdopContract,
  parsePurgeReceipt,
  parseSessionWitness,
  parseTicketCore,
  publicKeyFromPrivateKey,
  publicKeyKid,
  signCanonicalObject,
  signEnvelope,
  sm2Sign,
  verifyHolderAcceptance,
  type AttestationPolicy,
  type AttestationReport,
  type Envelope,
  type Fragment,
  type PhysicalStage,
  type TicketCore,
  type TrustedRoot,
  type VendorQuote,
} from '@medtrust/mdop';
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { OutputGate } from '../domain/output-gate';
import { MdopOutboundClient, MdopOutboundHttpError } from '../mdop/mdop-client';
import { MdopStageExecutor } from '../mdop/mdop-executor';
import { NodeQueryBudgetLedger } from '../mdop/node/budget-ledger';
import { TrustedNodeEntryGuard } from '../mdop/node/entry-guard';
import { NodeArtifactStore } from '../mdop/node/node-artifacts';
import { NodeExitGuard } from '../mdop/node/node-exit';
import { NodeReceiptChain } from '../mdop/node/node-receipts';
import { TrustedNodeSession } from '../mdop/node/node-session';
import { NodePublicationReview } from '../mdop/node/publication-review';
import { buildSealedEnvelope, type SealContractTerms } from '../mdop/operators/seal';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContractStore } from './contract-store';
import { NODE_DECLASSIFY_OP, registerNodeDeclassifyOperator } from './declassify-op';
import { NodeExecutedStages } from './executed-ledger';
import type { NodeJobHeader } from './fragment-review';
import { NodeMessageRouter, type NodeMessageRouterDeps } from './node-messages';
import { NodeReceiptReporter } from './receipt-report';
import { createNodeStateStore } from './state';

/**
 * 可信空间节点的**消息处理**（任务 3.17）：要约 → 凭证 → 会合 → 执行 → 销毁。
 *
 * 这套用例钉的是「节点作为一等参与方能不能真的把链跑起来」，而不是某个算子的语义：
 *  ① 要约复核通过 → **节点自己签名接受**（平台侧收齐全部片段的签名才签发凭证）；
 *  ② 复核不过 → 带错误码拒绝（不静默、不假装接受）；
 *  ③ 凭证到达即校验（快照被改 → `E_SNAPSHOT_CHANGED`）；
 *  ④ C2 信封与阶段派发**无先后保证**：先到的一方等着，齐了就执行（不把竞态误报成失败）；
 *  ⑤ 销毁指令 → 销毁制品 + 签名回执（幂等），并让链上出现 `PURGED`。
 */

const NOW = new Date('2026-09-25T10:00:00.000Z');
const SPACE = 'sh-med';
const NODE = `urn:tds:${SPACE}:participant:tee-1`;
const NODE_ID = 'tee-1';
const PLATFORM = `urn:tds:${SPACE}:participant:platform`;
const HOSP_A = `urn:tds:${SPACE}:participant:p-demohospa`;
const HOSP_B = `urn:tds:${SPACE}:participant:p-demohospb`;
const PAIR_OP = 'rws.paired-cohort@1.0.0';
const JOB = 'job-router';
const MEAS = `sm3:${'a'.repeat(64)}`;
const POLICY: AttestationPolicy = { tee: ['tdx'], min_tcb: { tdx: '3.1.0' } };
const CONTRACT: SealContractTerms = {
  contract_id: 'ctr-router',
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

class HardwareProviderDouble {
  readonly providerKind = 'tdx' as const;
  lastEphemeralPrivateKey?: string;

  async prove(): Promise<AttestationReport> {
    const eph = generateSm2KeyPair();
    this.lastEphemeralPrivateKey = eph.privateKey;
    const quote: VendorQuote = {
      vendor: 'tdx',
      measurement: MEAS,
      tcb: '3.1.2',
      quote: 'dGR4LXF1b3Rl',
      signed_at: new Date(NOW.getTime() - 30_000).toISOString(),
      valid_until: new Date(NOW.getTime() + 300_000).toISOString(),
      ephemeral_public_key: eph.publicKey,
      report_data: reportDataBinding(eph.publicKey),
      node: NODE,
    };
    return mapVendorQuote(quote);
  }
}

const PAIR_STAGE: PhysicalStage = {
  id: 'pair',
  node: NODE,
  op: PAIR_OP,
  op_digest: `sm3:${'9'.repeat(64)}`,
  params: {},
  inputs: [{ from: 'sealA' }, { from: 'sealB' }],
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

/** 本节点片段：两个阶段 + 与它相关的全部边界边（两条 C2 入边、一条 C3 出边）。 */
const NODE_FRAGMENT: Fragment = {
  node: NODE,
  stages: [PAIR_STAGE, DEC_STAGE],
  edges: [
    { from_stage: 'sealA', to_stage: 'pair', label: 'C2', from_node: HOSP_A, to_node: NODE },
    { from_stage: 'sealB', to_stage: 'pair', label: 'C2', from_node: HOSP_B, to_node: NODE },
    { from_stage: 'dec', to_stage: 'merge', label: 'C3', from_node: NODE, to_node: PLATFORM },
  ],
};

const HOLDER_FRAGMENT_HASH = `sm3:${'c'.repeat(64)}`;

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
    holderSignature: sm2Sign(canonical, HOLDER_A.privateKey, { publicKey: HOLDER_A.publicKey }),
    platformCountersignature: sm2Sign(canonical, PLATFORM_KEYS.privateKey, {
      publicKey: PLATFORM_KEYS.publicKey,
    }),
  };
}

const JOB_HEADER: NodeJobHeader = {
  job_id: JOB,
  purpose: 'RWS.EFFECTIVENESS',
  applicant: { org: 'urn:tds:sh-med:participant:pharma-1', project: 'q4-pilot' },
  contracts: [CONTRACT.contract_id],
  not_before: '2026-09-01T00:00:00.000Z',
  not_after: '2027-09-01T00:00:00.000Z',
};

interface SentItem {
  msgType: string;
  body: Record<string, unknown>;
}

interface Harness {
  router: NodeMessageRouter;
  deps: NodeMessageRouterDeps;
  sent: SentItem[];
  artifacts: NodeArtifactStore;
  receipts: NodeReceiptChain;
  contracts: NodeContractStore;
  /** 本节点的能力通告（可在运行中改：用来验「环境变了就停下来」）。 */
  capability: { tee: { kind: string; min_tcb?: string } | null };
  core: TicketCore;
  fragmentHash: string;
  /** 节点 → 片段哈希表（与凭证核心里冻结的同一份）。 */
  fragments: Record<string, string>;
  offer: Envelope;
  ticket: Envelope;
  relay: (side: 'A' | 'B') => Envelope;
  sealed: Record<'A' | 'B', unknown>;
  stageDispatch: (stageId?: string) => Envelope;
  purgeOrder: () => Envelope;
  patientCount: () => number;
  /** 节点内预算账本（验「同一阶段只扣一次」）。 */
  budget: NodeQueryBudgetLedger;
  /** 向密钥保管方请求释放的次数（每把密钥一次；验「不重复要钥匙」）。 */
  keyReleases: () => number;
  /** 配对算子（wasm）真正跑了几次。 */
  wasmRuns: () => number;
}

const sentMsg = (msgType: string, jobId: string, receiver: string, body: Record<string, unknown>): Envelope => {
  const unsigned = {
    mdop: '0.2' as const,
    msg_id: `m-${Math.random().toString(36).slice(2)}`,
    msg_type: msgType,
    job_id: jobId,
    sender: PLATFORM,
    receiver,
    timestamp: NOW.toISOString(),
    nonce: `n-${Math.random().toString(36).slice(2)}`,
    idempotency_key: `${msgType}:${jobId}`,
    body,
  };
  return signEnvelope(unsigned as never, PLATFORM_KEYS.privateKey, {
    publicKey: PLATFORM_KEYS.publicKey,
  });
};

async function harness(
  over: {
    capabilityTee?: { kind: string; min_tcb?: string } | null;
    whitelistWithout?: string;
    /** 模拟执行前闸门抛出的错误码（如吊销名单没同步）。 */
    whitelistExecutableError?: string;
    /** 是否预先验签存档合约副本（缺省 true；false 用来验「随要约带来副本」这条路）。 */
    preVerifyContract?: boolean;
    /** 本节点片段（缺省两阶段 `NODE_FRAGMENT`；单阶段出口路径的用例换成只有一个阶段的片段）。 */
    fragment?: Fragment;
    /** 两院共有的主体数（缺省 10；用来造一个落在两个阈值之间的小格）。 */
    sharedSubjects?: number;
  } = {},
) {
  const nodeFragment = over.fragment ?? NODE_FRAGMENT;
  const capability =
    over.capabilityTee === undefined
      ? { tee: { kind: 'tdx', min_tcb: '3.1.2' } as { kind: string; min_tcb?: string } | null }
      : { tee: over.capabilityTee };
  const provider = new HardwareProviderDouble();
  const probe = await provider.prove();
  const roots: TrustedRoot[] = [
    { kind: 'tdx', verifyQuoteDigest: (d) => d === probe.quote_digest },
  ];
  const keys = new Map<string, Uint8Array>();
  const kms = new LocalDevKms({
    privateKey: KMS_KEY.privateKey,
    verifier: {
      verify: (r) =>
        roots.some((root) => root.kind === r.kind && root.verifyQuoteDigest(r.quote_digest ?? '', r)),
    },
    keys,
    now: () => NOW,
  });

  const contracts = new NodeContractStore();
  if (over.preVerifyContract !== false)
    contracts.verifyAndStore({
      ...contractCopy(),
      platformPublicKey: PLATFORM_KEYS.publicKey,
      holderPublicKey: publicKeyFromPrivateKey(HOLDER_A.privateKey),
      now: NOW,
    });

  const executor = new MdopStageExecutor();
  let patients = 0;
  let wasmRuns = 0;
  let keyReleases = 0;
  const budget = new NodeQueryBudgetLedger();
  executor.setWasmRunner(async (_op, _digest, input) => {
    wasmRuns += 1;
    const parties = input.stage.params.parties as Array<{ ref: string; node: string }>;
    const lists = parties.map(
      (p) => (input.inputs.get(p.ref) as { rows: Array<{ subjectKey: string }> }).rows,
    );
    const shared = lists[0].filter((row) => lists[1].some((other) => other.subjectKey === row.subjectKey));
    patients = shared.length;
    return {
      schema: 'rws.paired-cohort@1',
      payload: {
        analysisType: 'paired-cohort',
        cohortSize: shared.length,
        exposed: 0,
        outcome: 0,
        exposedWithOutcome: 0,
        rate: 0,
        buckets: [{ key: 'all', count: shared.length, rate: 0 }],
      },
    };
  });

  const receipts = new NodeReceiptChain({ node: NODE, privateKey: NODE_KEYS.privateKey });
  const artifacts = new NodeArtifactStore({ node: NODE, privateKey: NODE_KEYS.privateKey });
  const review = new NodePublicationReview(new OutputGate(new AuditService(), new Deidentifier()));
  const declassify = registerNodeDeclassifyOperator(executor, { review });
  const session = new TrustedNodeSession({
    node: NODE,
    attestation: provider,
    // 计数包装：每把密钥的释放请求都从这里过（解封一次 = 每个持有方一把钥匙各一次）
    kms: {
      kmsRef: kms.kmsRef,
      requestRelease: async (request: Parameters<typeof kms.requestRelease>[0]) => {
        keyReleases += 1;
        return kms.requestRelease(request);
      },
    },
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
    participantId: NODE_ID,
    privateKey: NODE_KEYS.privateKey,
  });
  const sent: SentItem[] = [];
  (outbound as unknown as { sendMessage: unknown }).sendMessage = async (envelope: Envelope) => {
    sent.push({ msgType: envelope.msg_type, body: envelope.body as Record<string, unknown> });
    return { ok: true };
  };
  (outbound as unknown as { sendDelivery: unknown }).sendDelivery = async (
    envelope: Envelope,
    _handle: unknown,
    payload: unknown,
  ) => {
    sent.push({ msgType: 'DELIVERY', body: { ...(envelope.body as object), payload } });
    return { ok: true };
  };

  const routerDeps: NodeMessageRouterDeps = {
    node: NODE,
    platform: PLATFORM,
    outbound,
    identity: { privateKey: NODE_KEYS.privateKey, publicKey: NODE_KEYS.publicKey },
    platformPublicKey: PLATFORM_KEYS.publicKey,
    // 参与方登记表（部署侧注入）：验合约副本与 C2 信封的持有方签名
    participantPublicKey: (participant) =>
      participant === HOSP_A
        ? publicKeyFromPrivateKey(HOLDER_A.privateKey)
        : participant === HOSP_B
          ? publicKeyFromPrivateKey(HOLDER_B.privateKey)
          : undefined,
    session,
    artifacts,
    contracts,
    declassify,
    review: {
      whitelist: whitelist(over.whitelistWithout, over.whitelistExecutableError),
      capability: () => ({
        node: NODE,
        runtime: ['native', 'wasm'],
        system_ops: [NODE_DECLASSIFY_OP],
        whitelist_digests: [],
        tee: capability.tee,
        protocols: [],
      }),
      registryMeasurements: [MEAS],
    },
    stageContext: () => ({
      budget: {
        key: { dataset: 'dp-cohort', snapshot: `sm3:${'6'.repeat(64)}` },
        policy: { limit: 3, unit: 'queries' },
        cost: 1,
        applicant: JOB_HEADER.applicant.org,
      },
      holderPublicKey: (signer) =>
        signer === HOSP_A
          ? publicKeyFromPrivateKey(HOLDER_A.privateKey)
          : signer === HOSP_B
            ? publicKeyFromPrivateKey(HOLDER_B.privateKey)
            : undefined,
    }),
    receipts: new NodeReceiptReporter({ receipts, outbound, platform: PLATFORM }),
    now: () => NOW,
  };
  const router = new NodeMessageRouter(routerDeps);

  const fragmentHashValue = fragmentHash(nodeFragment);
  const fragments = { [NODE]: fragmentHashValue, [HOSP_A]: HOLDER_FRAGMENT_HASH };
  const planHash = computePlanHash({ job: JOB_HEADER as never, fragments });
  const core = parseTicketCore({
    ticket_id: 'tkt-router',
    job_id: JOB,
    plan_hash: planHash,
    fragments,
    not_before: JOB_HEADER.not_before,
    not_after: JOB_HEADER.not_after,
    attestation: { [NODE]: { tee: 'tdx', measurement: MEAS, min_tcb: '3.1.0' } },
  });

  const cohortA = Array.from({ length: 10 }, (_, i) => ({ subjectKey: `sk-${i}` }));
  const cohortB = Array.from({ length: over.sharedSubjects ?? 10 }, (_, i) => ({
    subjectKey: `sk-${i}`,
  }));
  const sealed: Partial<Record<'A' | 'B', unknown>> = {};
  const seal = async (side: 'A' | 'B') => {
    const holder = side === 'A' ? HOLDER_A : HOLDER_B;
    const built = await buildSealedEnvelope(
      {
        jobId: JOB,
        credentialId: core.ticket_id,
        contract: CONTRACT,
        projection: { productId: 'dp-cohort', rows: side === 'A' ? cohortA : cohortB },
        dataProductId: 'dp-cohort',
        allowedOps: [PAIR_OP, NODE_DECLASSIFY_OP],
      },
      {
        kmsRef: kms.kmsRef,
        watermarkPrefix: `wm:site-${side.toLowerCase()}:${SPACE}`,
        signer: side === 'A' ? HOSP_A : HOSP_B,
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
    sealed[side] = {
      data_envelope: built.envelope,
      sealed: { ciphertext: built.ciphertext, iv: built.iv, tag: built.tag },
      holder: side === 'A' ? HOSP_A : HOSP_B,
      credential_id: core.ticket_id,
    };
    return built;
  };
  await seal('A');
  await seal('B');

  const h: Harness = {
    router,
    deps: routerDeps,
    sent,
    artifacts,
    receipts,
    contracts,
    capability,
    core,
    fragmentHash: fragmentHashValue,
    fragments,
    offer: sentMsg('PlanFragmentOffer', JOB, NODE, {
      ticket_id: core.ticket_id,
      core,
      fragment: nodeFragment,
      fragments,
      job_header: JOB_HEADER,
    }),
    ticket: sentMsg('ExecutionTicketIssue', JOB, NODE, {
      ticket: {
        core,
        signatures: [
          {
            signer: NODE,
            role: 'holder',
            snapshot: 'PLACEHOLDER',
            sig: { alg: 'SM2-SM3', kid: publicKeyKid(NODE_KEYS.publicKey), value: 'x' },
          },
          {
            signer: PLATFORM,
            role: 'platform',
            sig: signCanonicalObject(core, PLATFORM_KEYS.privateKey, {
              publicKey: PLATFORM_KEYS.publicKey,
            }),
          },
        ],
      },
    }),
    relay: (side) => sentMsg('C2EnvelopeRelay', JOB, NODE, sealed[side] as Record<string, unknown>),
    sealed: sealed as Record<'A' | 'B', unknown>,
    stageDispatch: (stageId = 'pair') =>
      sentMsg('StageDispatch', JOB, NODE, {
        ticket_id: core.ticket_id,
        stage_id: stageId,
        attempt: 1,
      }),
    purgeOrder: () => sentMsg('PurgeOrder', JOB, NODE, { job_id: JOB }),
    patientCount: () => patients,
    budget,
    keyReleases: () => keyReleases,
    wasmRuns: () => wasmRuns,
  };
  return h;
}

/** 本地已验签清单：默认两份模块；可用参数模拟「合约允许但本地没加白」。 */
function whitelist(without?: string, executableError?: string) {
  return {
    manifestFor: (op: string) => {
      if (op === without) return undefined;
      return op === PAIR_OP
        ? (PAIR_MANIFEST as never)
        : op === NODE_DECLASSIFY_OP
          ? (DEC_MANIFEST as never)
          : undefined;
    },
    assertExecutable: (input: { op: string }) => {
      if (!executableError) return;
      const error = new Error(`${executableError}: ${input.op}`) as Error & { code?: string };
      error.code = executableError;
      throw error;
    },
  };
}

/** 完成要约接受（把节点自己签的那份接受签名装进凭证，形状与平台侧一致）。 */
async function accepted(h: Harness) {
  const offerResult = await h.router.handle(h.offer);
  const accept = h.sent.find((s) => s.msgType === 'PlanFragmentAccept');
  if (!accept) throw new Error(`要约未被接受：${JSON.stringify(offerResult)}`);
  const signedTicket = sentMsg('ExecutionTicketIssue', JOB, NODE, {
    ticket: {
      core: h.core,
      signatures: [
        {
          signer: NODE,
          role: 'holder',
          snapshot: String(accept.body.snapshot),
          sig: accept.body.holder_signature,
        },
        {
          signer: PLATFORM,
          role: 'platform',
          sig: signCanonicalObject(h.core, PLATFORM_KEYS.privateKey, {
            publicKey: PLATFORM_KEYS.publicKey,
          }),
        },
      ],
    },
  });
  await h.router.handle(signedTicket);
  return { offerResult, accept };
}

describe('可信空间节点消息处理（任务 3.17）', () => {
  it('要约复核通过 → 节点自己签名接受（平台收齐全部片段的接受签名才能签发凭证）', async () => {
    const h = await harness();
    const result = await h.router.handle(h.offer);

    expect(result.status).toBe('handled');
    const accept = h.sent.find((s) => s.msgType === 'PlanFragmentAccept');
    expect(accept).toBeDefined();
    expect(accept!.body).toMatchObject({ ticket_id: h.core.ticket_id, signer: NODE });
    // 签名必须**真的**是对「凭证核心 + 本节点快照」的签名（平台侧 verifyHolderAcceptance 要能验过）
    const acceptance = {
      signer: NODE,
      role: 'holder' as const,
      snapshot: String(accept!.body.snapshot),
      sig: accept!.body.holder_signature as never,
    };
    expect(verifyHolderAcceptance(h.core, acceptance, NODE_KEYS.publicKey)).toBe(true);
    // 快照是**执行环境快照**（算子摘要 + 期望），不是随便一个值
    expect(accept!.body.snapshot).toMatch(/^sm3:[0-9a-f]{64}$/);
    expect(h.router.reviewed(h.core.ticket_id)?.c2Inbound).toHaveLength(2);
  });

  it('合约副本随要约带来：节点**本地验签后存档**，复核不再依赖预置副本', async () => {
    // 不预置合约副本：节点本身不是提供方，拿不到 ContractOffer，只能从要约里随带的副本取
    const h = await harness({ preVerifyContract: false });
    const offer = sentMsg('PlanFragmentOffer', JOB, NODE, {
      ticket_id: h.core.ticket_id,
      core: h.core,
      fragment: NODE_FRAGMENT,
      fragments: h.fragments,
      job_header: JOB_HEADER,
      contracts: [
        {
          contract_id: CONTRACT.contract_id,
          canonical: contractCopy().canonical,
          holder_signature: contractCopy().holderSignature,
          platform_countersignature: contractCopy().platformCountersignature,
        },
      ],
    });
    expect((await h.router.handle(offer)).status).toBe('handled');
    expect(h.contracts.get(CONTRACT.contract_id)?.verifiedAt).toBeTruthy();

    // 平台副署被换掉（或签名缺失）→ 副本验不过即丢 → 复核按「本地没有可用副本」拒
    const bad = await harness({ preVerifyContract: false });
    const forged = sentMsg('PlanFragmentOffer', JOB, NODE, {
      ticket_id: bad.core.ticket_id,
      core: bad.core,
      fragment: NODE_FRAGMENT,
      fragments: bad.fragments,
      job_header: JOB_HEADER,
      contracts: [
        {
          contract_id: CONTRACT.contract_id,
          canonical: contractCopy().canonical,
          holder_signature: contractCopy().holderSignature,
          platform_countersignature: sm2Sign(contractCopy().canonical, HOLDER_B.privateKey, {
            publicKey: HOLDER_B.publicKey,
          }),
        },
      ],
    });
    expect((await bad.router.handle(forged)).status).toBe('rejected');
    expect(bad.sent.find((s) => s.msgType === 'PlanFragmentReject')?.body.code).toBe(
      'E_CONTRACT_UNSIGNED',
    );
    expect(bad.contracts.get(CONTRACT.contract_id)).toBeUndefined();
  });

  it('复核不过 → 带错误码拒绝（不静默、不假装接受）', async () => {
    const cases: Array<[string, (h: Harness) => Envelope, string]> = [
      [
        '合约不覆盖片段里的算子',
        (h) =>
          sentMsg('PlanFragmentOffer', JOB, NODE, {
            ticket_id: h.core.ticket_id,
            core: h.core,
            fragment: {
              ...NODE_FRAGMENT,
              stages: [
                { ...PAIR_STAGE, op: 'rws.unknown@1.0.0' },
                { ...DEC_STAGE, inputs: [{ from: 'pair' }] },
              ],
            },
            fragments: { [NODE]: h.fragmentHash },
            job_header: JOB_HEADER,
          }),
        'E_CONTRACT_UNSIGNED',
      ],
      [
        '片段不是本节点',
        (h) =>
          sentMsg('PlanFragmentOffer', JOB, NODE, {
            ticket_id: h.core.ticket_id,
            core: h.core,
            fragment: { ...NODE_FRAGMENT, node: HOSP_A },
            fragments: { [NODE]: h.fragmentHash },
            job_header: JOB_HEADER,
          }),
        'E_CAPABILITY_MISMATCH',
      ],
      [
        '本地没有覆盖全部算子的合约副本',
        (h) =>
          sentMsg('PlanFragmentOffer', JOB, NODE, {
            ticket_id: h.core.ticket_id,
            core: h.core,
            fragment: NODE_FRAGMENT,
            fragments: { [NODE]: h.fragmentHash },
            job_header: { ...JOB_HEADER, contracts: ['ctr-unknown'] },
          }),
        'E_CONTRACT_UNSIGNED',
      ],
      [
        '作业用途与本地合约不一致',
        (h) =>
          sentMsg('PlanFragmentOffer', JOB, NODE, {
            ticket_id: h.core.ticket_id,
            core: h.core,
            fragment: NODE_FRAGMENT,
            fragments: { [NODE]: h.fragmentHash },
            job_header: { ...JOB_HEADER, purpose: 'RWS.OTHER' },
          }),
        'E_PURPOSE_MISMATCH',
      ],
      [
        '跨节点 C0 边',
        (h) =>
          sentMsg('PlanFragmentOffer', JOB, NODE, {
            ticket_id: h.core.ticket_id,
            core: h.core,
            fragment: {
              ...NODE_FRAGMENT,
              edges: [{ ...NODE_FRAGMENT.edges[0], label: 'C0' }, ...NODE_FRAGMENT.edges.slice(1)],
            },
            fragments: { [NODE]: h.fragmentHash },
            job_header: JOB_HEADER,
          }),
        'E_LABEL_VIOLATION',
      ],
    ];

    for (const [name, build, code] of cases) {
      const h = await harness();
      const result = await h.router.handle(build(h));
      expect(result.status).toBe('rejected');
      const reject = h.sent.find((s) => s.msgType === 'PlanFragmentReject');
      expect([name, reject?.body.code]).toEqual([name, code]);
      // 拒绝消息只带错误码与一句说明：不带本地白名单/策略原文
      expect(Object.keys(reject!.body).sort()).toEqual(
        expect.arrayContaining(['ticket_id', 'signer', 'code', 'message']),
      );
    }
  });

  it('C2 期望对不上本节点能力 → 拒（软件实现不得承接 C2；度量不在白名单也拒）', async () => {
    const software = await harness({ capabilityTee: null });
    const noTee = await software.router.handle(software.offer);
    expect(noTee.status).toBe('rejected');
    expect(software.sent.find((s) => s.msgType === 'PlanFragmentReject')?.body.code).toBe(
      'E_ATTESTATION_FAILED',
    );

    const otherChain = await harness({ capabilityTee: { kind: 'csv', min_tcb: '2026-06' } });
    await otherChain.router.handle(otherChain.offer);
    expect(otherChain.sent.find((s) => s.msgType === 'PlanFragmentReject')?.body.code).toBe(
      'E_ATTESTATION_FAILED',
    );

    // 度量不在生效白名单：注册中心白名单里没有该度量 → 拒
    const wrongMeasurement = await harness();
    const offer = sentMsg('PlanFragmentOffer', JOB, NODE, {
      ticket_id: wrongMeasurement.core.ticket_id,
      core: {
        ...wrongMeasurement.core,
        attestation: { [NODE]: { tee: 'tdx', measurement: `sm3:${'b'.repeat(64)}`, min_tcb: '3.1.0' } },
      },
      fragment: NODE_FRAGMENT,
      fragments: { [NODE]: wrongMeasurement.fragmentHash },
      job_header: JOB_HEADER,
    });
    await wrongMeasurement.router.handle(offer);
    expect(wrongMeasurement.sent.find((s) => s.msgType === 'PlanFragmentReject')?.body.code).toBe(
      'E_MEASUREMENT_NOT_ALLOWED',
    );

    // 合约允许、但本地清单没有这个算子 → 未加白（fail-closed，不因为合约写了就放行）
    const notWhitelisted = await harness({ whitelistWithout: PAIR_OP });
    await notWhitelisted.router.handle(notWhitelisted.offer);
    expect(notWhitelisted.sent.find((s) => s.msgType === 'PlanFragmentReject')?.body.code).toBe(
      'E_OP_NOT_WHITELISTED',
    );

    // 吊销名单没同步 → 原样带出**具体的**错误码（与「未加白」是两种不同处置）
    const revokedUnsynced = await harness({ whitelistExecutableError: 'E_REVOCATION_UNSYNCED' });
    await revokedUnsynced.router.handle(revokedUnsynced.offer);
    expect(
      revokedUnsynced.sent.find((s) => s.msgType === 'PlanFragmentReject')?.body.code,
    ).toBe('E_REVOCATION_UNSYNCED');
  });

  it('未复核的凭证 → 拒；复核后凭证通过校验（含快照比对）', async () => {
    const h = await harness();
    await expect(h.router.handle(h.ticket)).rejects.toThrow(
      expect.objectContaining({ code: 'E_TICKET_INVALID' }),
    );
    await accepted(h);
    expect(h.router.ticket(h.core.ticket_id)).toBeDefined();

    // 「环境悄悄变了就停下来」：接受时签的是 tdx/3.1.2，执行前本节点的可信基变了 →
    // 重算的执行环境快照对不上 → E_SNAPSHOT_CHANGED（作业须重新要约，不能照跑）
    const drifted = await harness();
    await accepted(drifted);
    drifted.capability.tee = { kind: 'tdx', min_tcb: '3.1.0' };
    await drifted.router.handle(drifted.relay('A'));
    await drifted.router.handle(drifted.relay('B'));
    await expect(drifted.router.handle(drifted.stageDispatch())).rejects.toThrow(
      expect.objectContaining({ code: 'E_SNAPSHOT_CHANGED' }),
    );
    // 拒了就一步都没执行：没有解封、没有产物
    expect(drifted.receipts.list(JOB)).toHaveLength(0);
    expect(drifted.artifacts.read(`art://${NODE}/${JOB}/pair`)).toBeNull();
  });

  it('信封与派发无先后保证：先到的一方等着，齐了就执行（不把竞态误报成失败）', async () => {
    const h = await harness();
    await accepted(h);

    // 派发先到：只登记，**不发 StageStatus FAILED**
    const early = await h.router.handle(h.stageDispatch());
    expect(early.status).toBe('deferred');
    expect(h.sent.some((s) => s.msgType === 'StageStatus' && s.body.status === 'FAILED')).toBe(false);
    // 第一条信封到：仍然在等
    expect((await h.router.handle(h.relay('A'))).status).toBe('deferred');
    // 第二条到齐 → 执行：C2 中间制品留在节点本地、没有载荷投递
    const executed = await h.router.handle(h.relay('B'));
    expect(executed.status).toBe('handled');
    expect(executed.outcome).toMatchObject({ label: 'C2', published: false, delivered: false });
    expect(h.sent.filter((s) => s.msgType === 'DELIVERY')).toHaveLength(0);
    expect(h.sent.some((s) => s.msgType === 'StageStatus' && s.body.status === 'SUCCEEDED')).toBe(true);

    // 第二阶段（本地输入）→ 过闸门 → C3 → 投递
    const dec = await h.router.handle(h.stageDispatch('dec'));
    expect(dec.outcome).toMatchObject({ label: 'C3', published: true, delivered: true });
    expect(h.sent.filter((s) => s.msgType === 'DELIVERY')).toHaveLength(1);
    // 重复下发同一阶段：返回同一结果，不再执行也不再发消息
    const before = h.sent.length;
    const again = await h.router.handle(h.stageDispatch('dec'));
    expect(again.detail).toBe('already-executed');
    expect(h.sent).toHaveLength(before);
  });

  it('信封先到、派发后到 → 同样会合执行', async () => {
    const h = await harness();
    await accepted(h);
    await h.router.handle(h.relay('A'));
    expect((await h.router.handle(h.relay('B'))).status).toBe('deferred');
    const executed = await h.router.handle(h.stageDispatch());
    expect(executed.status).toBe('handled');
    expect(executed.outcome).toMatchObject({ label: 'C2', published: false });
  });

  /**
   * 评审遗留（2026-10-07）：阶段阈值此前是「阶段参数优先」。单阶段出口路径（配对即终点、会话内自审，
   * **不经**降密算子——降密算子自己早就取较大值）上，一个比合约小的阶段参数能把合约阈值压下去。
   * 现在与降密算子同一条规矩：合约与参数取较大值，参数只能抬高、不能压低。
   */
  describe('单阶段出口路径的发布阈值：阶段参数不得弱于合约', () => {
    /** 只有配对一个阶段：没有同节点下游 → 这一阶段就是出口（发布审查在会话内就地做）。 */
    const singleStage = (params: Record<string, unknown>): Fragment => ({
      node: NODE,
      stages: [{ ...PAIR_STAGE, params }],
      edges: NODE_FRAGMENT.edges.filter((e) => e.to_stage === 'pair'),
    });
    const published = async (params: Record<string, unknown>, sharedSubjects: number) => {
      const h = await harness({ fragment: singleStage(params), sharedSubjects });
      await accepted(h);
      await h.router.handle(h.relay('A'));
      await h.router.handle(h.relay('B'));
      const executed = await h.router.handle(h.stageDispatch());
      expect(executed.outcome).toMatchObject({ label: 'C3', published: true, delivered: true });
      const delivery = h.sent.find((s) => s.msgType === 'DELIVERY')!;
      return delivery.body.payload as {
        buckets: Array<{ key: string; count: number; suppressed?: boolean }>;
        release_manifest: { minCell: number };
      };
    };

    it('阶段参数 minCell=1 < 合约 minCell=5：4 人的格子照样被抑制，随行清单记的也是 5', async () => {
      const payload = await published({ minCell: 1 }, 4);
      expect(payload.buckets).toEqual([{ key: 'all', count: 0, rate: 0, suppressed: true }]);
      expect(payload.release_manifest.minCell).toBe(5);
    });

    it('阶段参数只能把阈值抬高：minCell=8 > 合约 5 时按 8 判（6 人的格子被抑制）；不带参数按合约', async () => {
      const raised = await published({ minCell: 8 }, 6);
      expect(raised.buckets[0]).toMatchObject({ count: 0, suppressed: true });
      expect(raised.release_manifest.minCell).toBe(8);

      const contractOnly = await published({}, 6);
      expect(contractOnly.buckets[0]).toMatchObject({ key: 'all', count: 6 });
      expect(contractOnly.buckets[0].suppressed).toBeUndefined();
      expect(contractOnly.release_manifest.minCell).toBe(5);
    });

    it('无效的阶段参数（0 / 负数 / 非数字）不算数：仍按合约的 5', async () => {
      for (const minCell of [0, -3, 'abc', null]) {
        const payload = await published({ minCell }, 4);
        expect(payload.buckets[0]).toMatchObject({ count: 0, suppressed: true });
        expect(payload.release_manifest.minCell).toBe(5);
      }
    });
  });

  it('同一持有方送来第二份不同的信封 → 拒（不猜哪一份才是计划的输入）', async () => {
    const h = await harness();
    await accepted(h);
    await h.router.handle(h.relay('A'));
    const foreign = h.sealed.A as { data_envelope: { wrapped_key: { key_id: string } } };
    const spliced = {
      ...(h.sealed.A as Record<string, unknown>),
      data_envelope: {
        ...foreign.data_envelope,
        wrapped_key: { ...foreign.data_envelope.wrapped_key, key_id: 'key-other' },
      },
    };
    await expect(
      h.router.handle(sentMsg('C2EnvelopeRelay', JOB, NODE, spliced)),
    ).rejects.toThrow(expect.objectContaining({ code: 'E_ENVELOPE_POLICY' }));
  });

  /**
   * 2026-10-07 真机事故回归（job-muxxbwia-21abafc5）：节点中途被重启，新进程把同一批消息又处置了一遍，
   * `scri` 与 `decTee` 各执行了第二次——又向保管方要了一次密钥、预算又记了一次 `used=1/5`、
   * C3 换了一个摘要覆盖上一份。「执行过没有」此前只记在内存里。
   */
  describe('阶段执行幂等：状态没报上去 / 进程重启，都不重跑', () => {
    const executions = (h: Harness, event: string) =>
      h.receipts.list(JOB).filter((r) => r.event === event).length;

    it('成功状态上报失败 ≠ 没执行：不抛出、不重跑；平台重发指令时只补报状态', async () => {
      const h = await harness();
      await accepted(h);
      await h.router.handle(h.relay('A'));
      await h.router.handle(h.relay('B'));

      // 平台这一刻不可达：阶段跑完了，成功状态却发不出去
      const send = (h.deps.outbound as unknown as { sendMessage: (e: Envelope) => Promise<unknown> })
        .sendMessage;
      let platformDown = true;
      (h.deps.outbound as unknown as { sendMessage: unknown }).sendMessage = async (envelope: Envelope) => {
        if (platformDown && envelope.msg_type === 'StageStatus') throw new Error('fetch failed');
        return send(envelope);
      };
      const first = await h.router.handle(h.stageDispatch());
      expect(first.status).toBe('handled');
      expect(first.outcome).toMatchObject({ label: 'C2', statusReported: false });
      expect(executions(h, 'UNSEALED')).toBe(1);

      // 下一轮长轮询：平台没收到状态，指令原样重发。此前这里会**整段重跑**（再解封一次）
      const stillDown = await h.router.handle(h.stageDispatch());
      expect(stillDown.detail).toBe('already-executed:status-pending');
      expect(executions(h, 'UNSEALED')).toBe(1);

      platformDown = false;
      const recovered = await h.router.handle(h.stageDispatch());
      expect(recovered.detail).toBe('already-executed:status-reported');
      expect(executions(h, 'UNSEALED')).toBe(1);
      const statuses = h.sent.filter((s) => s.msgType === 'StageStatus' && s.body.status === 'SUCCEEDED');
      expect(statuses).toHaveLength(1);
      expect(statuses[0].body).toMatchObject({ stage_id: 'pair', attempt: 1, label: 'C2' });

      // 状态送达之后再重发：纯回放，不再发任何消息
      const before = h.sent.length;
      expect((await h.router.handle(h.stageDispatch())).detail).toBe('already-executed');
      expect(h.sent).toHaveLength(before);
    });

    it('进程重启：新进程从状态文件恢复登记，平台重发的整批消息里已完成的阶段不再执行', async () => {
      const dataDir = mkdtempSync(join(tmpdir(), 'tee-node-restart-'));
      const h = await harness();

      // ── 重启前的进程：跑完 pair（解封）与 dec（出口）──────────────────────────
      const ledgerA = new NodeExecutedStages();
      const stateA = createNodeStateStore({
        receipts: h.receipts,
        artifacts: h.artifacts,
        executed: ledgerA,
        dir: dataDir,
      });
      h.router = new NodeMessageRouter({ ...h.deps, executed: ledgerA, state: stateA });
      await accepted(h);
      await h.router.handle(h.relay('A'));
      await h.router.handle(h.relay('B'));
      await h.router.handle(h.stageDispatch());
      const dec = await h.router.handle(h.stageDispatch('dec'));
      expect(dec.outcome).toMatchObject({ label: 'C3', delivered: true });
      expect(executions(h, 'UNSEALED')).toBe(1);
      expect(executions(h, 'EXITED')).toBe(1);
      expect(h.sent.filter((s) => s.msgType === 'DELIVERY')).toHaveLength(1);
      const delivered = dec.outcome!.digest;

      // ── 「重启」：内存里的片段/凭证/信封全没了，只有状态文件还在 ─────────────────
      const ledgerB = new NodeExecutedStages();
      createNodeStateStore({
        receipts: new NodeReceiptChain({ node: NODE, privateKey: NODE_KEYS.privateKey }),
        artifacts: new NodeArtifactStore({ node: NODE, privateKey: NODE_KEYS.privateKey }),
        executed: ledgerB,
        dir: dataDir,
      }).hydrate();
      h.router = new NodeMessageRouter({ ...h.deps, executed: ledgerB });

      // 平台按至少一次把整批重发一遍：要约、凭证、两份信封、两条派发
      await accepted(h);
      await h.router.handle(h.relay('A'));
      await h.router.handle(h.relay('B'));
      const pairAgain = await h.router.handle(h.stageDispatch());
      const decAgain = await h.router.handle(h.stageDispatch('dec'));

      expect(pairAgain.detail).toBe('already-executed');
      expect(decAgain.detail).toBe('already-executed');
      // 没有第二次解封（= 没有第二次密钥释放）、没有第二次出口（= 没有第二次预算扣减）、没有第二份 C3
      expect(executions(h, 'UNSEALED')).toBe(1);
      expect(executions(h, 'EXITED')).toBe(1);
      expect(h.sent.filter((s) => s.msgType === 'DELIVERY')).toHaveLength(1);
      expect(decAgain.outcome?.digest).toBe(delivered);
    });
  });

  /**
   * 2026-10-07 真机复现（job-muy1ioki-b12ae3e7）：`scri` 在 19:51:22 执行完成，20 秒后一条执行后的
   * 出站请求 `fetch failed`——异常一路抛出，「已执行」没登记。此后同一份 `StageDispatch` 每重发一次、
   * 进程每重启一次，这一段就整段重跑一次：保管方为这**一个**作业把同样两把密钥放了三次。
   *
   * 要钉的是：阶段的副作用（密钥释放、发布审查、预算扣减、C3 入库）发生完就**立刻登记并落盘**；
   * 之后的句柄登记 / C3 投递 / 会话见证 / 回执链 / 阶段状态哪一步没送达，重发的指令只补那一步。
   */
  describe('执行与上报分离：执行后的出站失败 / 进程被杀，都只补欠着的上报', () => {
    type PostExecCall = 'ArtifactReady' | 'AttestationReport' | 'AuditReceipt' | 'StageStatus' | 'DELIVERY';

    /** 出站故障注入：按「调用类型 + 第几次」决定这一次出站是否失败（失败的不会进 `h.sent`）。 */
    const faultInjector = (h: Harness) => {
      const outbound = h.deps.outbound as unknown as {
        sendMessage: (envelope: Envelope) => Promise<unknown>;
        sendDelivery: (...args: unknown[]) => Promise<unknown>;
      };
      const original = { sendMessage: outbound.sendMessage, sendDelivery: outbound.sendDelivery };
      let rule: ((call: string, nth: number) => Error | undefined) | undefined;
      const seen = new Map<string, number>();
      const gate = (call: string) => {
        const nth = (seen.get(call) ?? 0) + 1;
        seen.set(call, nth);
        const err = rule?.(call, nth);
        if (err) throw err;
      };
      outbound.sendMessage = async (envelope) => {
        gate(envelope.msg_type);
        return original.sendMessage(envelope);
      };
      outbound.sendDelivery = async (...args) => {
        gate('DELIVERY');
        return original.sendDelivery(...args);
      };
      const transient = () => new Error('fetch failed');
      return {
        /** 从现在起，`call` 的第 `nth` 次出站失败一次。 */
        failNth(call: PostExecCall, nth: number, error: () => Error = transient) {
          seen.clear();
          rule = (c, n) => (c === call && n === nth ? error() : undefined);
        },
        /** 平台不可达：这些类型的出站全部失败，直到 `heal()`。 */
        failAll(calls: readonly PostExecCall[], error: () => Error = transient) {
          seen.clear();
          rule = (c) => ((calls as readonly string[]).includes(c) ? error() : undefined);
        },
        heal() {
          rule = undefined;
        },
      };
    };

    const sentOf = (h: Harness, msgType: string) => h.sent.filter((s) => s.msgType === msgType);
    const statuses = (h: Harness, stageId: string, status: string) =>
      h.sent.filter(
        (s) => s.msgType === 'StageStatus' && s.body.stage_id === stageId && s.body.status === status,
      );
    const reportedEvents = (h: Harness, stage?: string) =>
      sentOf(h, 'AuditReceipt')
        .filter((s) => !stage || s.body.stage === stage)
        .map((s) => s.body.event);
    const inChain = (
      chain: { list(jobId: string): readonly { stage: string; event: string }[] },
      stage: string,
      event: string,
    ) => chain.list(JOB).filter((r) => r.stage === stage && r.event === event).length;
    const keyIdOf = (sealed: unknown) =>
      (sealed as { data_envelope: { wrapped_key: { key_id: string } } }).data_envelope.wrapped_key.key_id;
    const DEC_HANDLE = `art://${NODE}/${JOB}/dec`;

    /** 接上落盘的状态（真实装配里登记、制品库、回执链写的是同一个状态文件）。 */
    const withState = (h: Harness, dataDir: string) => {
      const executed = new NodeExecutedStages();
      const state = createNodeStateStore({
        receipts: h.receipts,
        artifacts: h.artifacts,
        executed,
        dir: dataDir,
      });
      h.router = new NodeMessageRouter({ ...h.deps, executed, state });
    };

    /**
     * 「进程重启」：登记、制品库、回执链、回执上报器全是新的内存对象，只从状态文件恢复；
     * 片段 / 凭证 / 信封缓冲（只在内存里）全丢。
     */
    const restart = (h: Harness, dataDir: string) => {
      const receipts = new NodeReceiptChain({ node: NODE, privateKey: NODE_KEYS.privateKey });
      const artifacts = new NodeArtifactStore({ node: NODE, privateKey: NODE_KEYS.privateKey });
      const executed = new NodeExecutedStages();
      const state = createNodeStateStore({ receipts, artifacts, executed, dir: dataDir });
      state.hydrate();
      // 补报只是把已经发生的事告诉平台：会话（证明 / 要钥匙 / 解封 / 执行 / 出口）与内存里的
      // 发布审查记录（重启后本来就没了）一概不该再碰——碰了就当场报错。
      const untouchable = (what: string) =>
        new Proxy(
          {},
          {
            get: (_target, prop) => {
              throw new Error(`补报不该用到${what}（${String(prop)}）`);
            },
          },
        ) as never;
      h.router = new NodeMessageRouter({
        ...h.deps,
        session: untouchable('会话'),
        declassify: untouchable('发布审查记录'),
        artifacts,
        executed,
        state,
        receipts: new NodeReceiptReporter({ receipts, outbound: h.deps.outbound, platform: PLATFORM }),
      });
      return { receipts, artifacts, executed };
    };

    const readState = (dataDir: string) =>
      JSON.parse(readFileSync(join(dataDir, 'node-state.json'), 'utf8')) as {
        executed: Array<{
          key: string;
          statusReported: boolean;
          pending?: {
            witnesses?: unknown[];
            handle?: Record<string, unknown>;
            delivery?: Record<string, unknown>;
            receipts?: boolean;
          };
        }>;
      };

    const bothEnvelopes = async (h: Harness) => {
      await h.router.handle(h.relay('A'));
      await h.router.handle(h.relay('B'));
    };

    it.each<[PostExecCall, number]>([
      ['ArtifactReady', 1],
      ['AttestationReport', 1],
      ['AttestationReport', 2],
      ['AuditReceipt', 1],
      ['AuditReceipt', 2],
      ['StageStatus', 1],
    ])(
      '解封阶段：执行完成后「%s」第 %d 次出站失败 → 不重跑、不再要钥匙，重发的指令只补欠着的上报',
      async (call, nth) => {
        const h = await harness();
        await accepted(h);
        await bothEnvelopes(h);
        const faults = faultInjector(h);
        faults.failNth(call, nth);

        const first = await h.router.handle(h.stageDispatch());
        expect(first.status).toBe('handled');
        expect(first.outcome).toMatchObject({ label: 'C2', published: false, statusReported: false });
        // 阶段已经执行完：「上报没送达」不得报成阶段失败（那会让平台退避重发、白白消耗重试次数）
        expect(statuses(h, 'pair', 'FAILED')).toHaveLength(0);
        expect(statuses(h, 'pair', 'SUCCEEDED')).toHaveLength(0);
        expect(h.wasmRuns()).toBe(1);
        expect(h.keyReleases()).toBe(2); // 两家持有方各一把钥匙，各放一次

        // 平台没收到成功状态 → 指令还在发件箱里 → 下一轮长轮询原样重发
        faults.heal();
        const again = await h.router.handle(h.stageDispatch());
        expect(again.detail).toBe('already-executed:status-reported');
        expect(h.wasmRuns()).toBe(1); // 事故里这里是 2、3
        expect(h.keyReleases()).toBe(2); // 事故里这里是 4、6
        expect(inChain(h.receipts, 'pair', 'UNSEALED')).toBe(1);
        expect(inChain(h.receipts, 'pair', 'EXECUTED')).toBe(1);

        // 欠着的全部补齐；已经送达的不再重发
        expect(sentOf(h, 'ArtifactReady')).toHaveLength(1);
        const witnessed = sentOf(h, 'AttestationReport').map((s) => parseSessionWitness(s.body.witness).key_id);
        expect(witnessed.sort()).toEqual([keyIdOf(h.sealed.A), keyIdOf(h.sealed.B)].sort());
        expect(reportedEvents(h)).toEqual(['UNSEALED', 'EXECUTED']);
        expect(statuses(h, 'pair', 'SUCCEEDED')).toHaveLength(1);

        // 全部送达之后再重发：纯回放，不再发任何消息
        const before = h.sent.length;
        expect((await h.router.handle(h.stageDispatch())).detail).toBe('already-executed');
        expect(h.sent).toHaveLength(before);
        // 信封同理：阶段跑过之后平台重发的那两份不再缓冲（它们已经被消费掉了）
        expect((await h.router.handle(h.relay('A'))).detail).toBe('already-consumed');
        expect(h.keyReleases()).toBe(2);
      },
    );

    it.each<[PostExecCall, number]>([
      ['ArtifactReady', 1],
      ['DELIVERY', 1],
      ['AuditReceipt', 1],
      ['AuditReceipt', 2],
      ['StageStatus', 1],
    ])(
      '出口阶段：执行完成后「%s」第 %d 次出站失败 → 发布审查与预算只做一次，补投的是出口守卫放行的那一份 C3',
      async (call, nth) => {
        const h = await harness();
        await accepted(h);
        await bothEnvelopes(h);
        await h.router.handle(h.stageDispatch());
        const faults = faultInjector(h);
        faults.failNth(call, nth);

        const first = await h.router.handle(h.stageDispatch('dec'));
        expect(first.status).toBe('handled');
        expect(first.outcome).toMatchObject({ label: 'C3', published: true, statusReported: false });
        expect(statuses(h, 'dec', 'FAILED')).toHaveLength(0);
        expect(statuses(h, 'dec', 'SUCCEEDED')).toHaveLength(0);
        expect(h.budget.entries()).toHaveLength(1);

        faults.heal();
        const again = await h.router.handle(h.stageDispatch('dec'));
        expect(again.detail).toBe('already-executed:status-reported');
        // 降密（发布审查）、出口守卫、预算扣减都只发生过一次
        expect(inChain(h.receipts, 'dec', 'EXECUTED')).toBe(1);
        expect(inChain(h.receipts, 'dec', 'EXITED')).toBe(1);
        expect(h.budget.entries()).toHaveLength(1);
        expect(h.keyReleases()).toBe(2);

        // C3 只交付一份，而且就是出口守卫放行的那一份：摘要与 EXITED 回执、登记的句柄三处一致
        const exited = h.receipts.list(JOB).find((r) => r.stage === 'dec' && r.event === 'EXITED')!;
        const deliveries = sentOf(h, 'DELIVERY');
        expect(deliveries).toHaveLength(1);
        expect(canonicalSm3(deliveries[0].body.payload as Record<string, unknown>)).toBe(exited.output_digest);
        const ready = sentOf(h, 'ArtifactReady')
          .map((s) => s.body.handle as { handle: string; digest: string })
          .filter((handle) => handle.handle === DEC_HANDLE);
        expect(ready).toHaveLength(1);
        expect(ready[0].digest).toBe(exited.output_digest);
        expect(reportedEvents(h, 'dec')).toEqual(['EXECUTED', 'EXITED']);
        expect(statuses(h, 'dec', 'SUCCEEDED')).toHaveLength(1);
      },
    );

    it('进程在「执行完成」与「上报」之间被杀（解封阶段）：新进程从状态文件补齐见证 / 句柄 / 回执 / 状态，不再要钥匙', async () => {
      const dataDir = mkdtempSync(join(tmpdir(), 'tee-node-kill-unseal-'));
      const h = await harness();
      withState(h, dataDir);
      await accepted(h);
      await bothEnvelopes(h);
      const faults = faultInjector(h);
      // 事故原样：阶段跑完，随后链路整个不通
      faults.failAll(['ArtifactReady', 'AttestationReport', 'AuditReceipt', 'StageStatus']);

      const first = await h.router.handle(h.stageDispatch());
      expect(first.status).toBe('handled');
      expect(h.keyReleases()).toBe(2);
      // 登记在任何上报之前就已落盘，且带着还没送达的**见证本体**（保管方不会为同一次释放再出一份）
      const beforeKill = readState(dataDir);
      expect(beforeKill.executed).toHaveLength(1);
      expect(beforeKill.executed[0]).toMatchObject({ key: `${h.core.ticket_id}:pair`, statusReported: false });
      expect(beforeKill.executed[0].pending?.witnesses).toHaveLength(2);
      expect(beforeKill.executed[0].pending?.handle).toMatchObject({ label: 'C2' });

      restart(h, dataDir);
      faults.heal();
      // 平台按至少一次把整批重发：要约、凭证、两份信封、派发指令
      await accepted(h);
      await bothEnvelopes(h);
      const again = await h.router.handle(h.stageDispatch());

      expect(again.detail).toBe('already-executed:status-reported');
      expect(h.wasmRuns()).toBe(1);
      expect(h.keyReleases()).toBe(2);
      expect(sentOf(h, 'ArtifactReady')).toHaveLength(1);
      const witnessed = sentOf(h, 'AttestationReport').map((s) => parseSessionWitness(s.body.witness).key_id);
      expect(witnessed.sort()).toEqual([keyIdOf(h.sealed.A), keyIdOf(h.sealed.B)].sort());
      expect(reportedEvents(h)).toEqual(['UNSEALED', 'EXECUTED']);
      expect(statuses(h, 'pair', 'SUCCEEDED')).toHaveLength(1);
      expect(statuses(h, 'pair', 'FAILED')).toHaveLength(0);
      // 补齐之后，状态文件里不再留着见证本体
      const afterReports = readState(dataDir).executed[0];
      expect(afterReports.statusReported).toBe(true);
      expect(afterReports.pending ?? {}).toEqual({});
    });

    it('进程在出口之后、投递之前被杀（出口阶段）：新进程从**制品库**取回那一份 C3 补投，不重做发布审查、不再扣预算', async () => {
      const dataDir = mkdtempSync(join(tmpdir(), 'tee-node-kill-publish-'));
      const h = await harness();
      withState(h, dataDir);
      await accepted(h);
      await bothEnvelopes(h);
      await h.router.handle(h.stageDispatch());
      const faults = faultInjector(h);
      faults.failAll(['ArtifactReady', 'DELIVERY', 'AuditReceipt', 'StageStatus']);

      const first = await h.router.handle(h.stageDispatch('dec'));
      expect(first.outcome).toMatchObject({ label: 'C3', published: true, delivered: false });
      expect(sentOf(h, 'DELIVERY')).toHaveLength(0);
      const exited = h.receipts.list(JOB).find((r) => r.stage === 'dec' && r.event === 'EXITED')!;
      // 登记里只有句柄与摘要：**C3 载荷不进登记**（它只在制品库里，销毁即无）
      const entry = readState(dataDir).executed.find((e) => e.key === `${h.core.ticket_id}:dec`)!;
      expect(entry.pending?.delivery).toMatchObject({ handle: DEC_HANDLE, digest: exited.output_digest });
      expect(JSON.stringify(entry)).not.toContain('cohortSize');

      const fresh = restart(h, dataDir);
      faults.heal();
      await accepted(h);
      const again = await h.router.handle(h.stageDispatch('dec'));

      expect(again.detail).toBe('already-executed:status-reported');
      expect(h.budget.entries()).toHaveLength(1);
      expect(inChain(fresh.receipts, 'dec', 'EXECUTED')).toBe(1);
      expect(inChain(fresh.receipts, 'dec', 'EXITED')).toBe(1);
      const deliveries = sentOf(h, 'DELIVERY');
      expect(deliveries).toHaveLength(1);
      expect(canonicalSm3(deliveries[0].body.payload as Record<string, unknown>)).toBe(exited.output_digest);
      expect(deliveries[0].body.payload).toEqual(fresh.artifacts.read(DEC_HANDLE)!.payload);
      expect(reportedEvents(h, 'dec')).toEqual(['EXECUTED', 'EXITED']);
      expect(statuses(h, 'dec', 'SUCCEEDED')).toHaveLength(1);
    });

    it('销毁之后不可再投：出口做完但 C3 还没送达时收到销毁指令 → 制品销毁，重发的派发指令不投递、不重跑', async () => {
      const h = await harness();
      await accepted(h);
      await bothEnvelopes(h);
      await h.router.handle(h.stageDispatch());
      const faults = faultInjector(h);
      faults.failAll(['DELIVERY']);
      await h.router.handle(h.stageDispatch('dec'));
      expect(sentOf(h, 'DELIVERY')).toHaveLength(0);

      faults.heal();
      await h.router.handle(h.purgeOrder());
      expect(h.artifacts.read(DEC_HANDLE)).toBeNull();

      const again = await h.router.handle(h.stageDispatch('dec'));
      expect(again.detail).toBe('already-executed:purged');
      expect(sentOf(h, 'DELIVERY')).toHaveLength(0);
      expect(statuses(h, 'dec', 'SUCCEEDED')).toHaveLength(0);
      expect(inChain(h.receipts, 'dec', 'EXECUTED')).toBe(1);
    });

    it('补投只认出口守卫放行的那一份：制品库里的载荷与出口时的摘要对不上 → 拒绝投递，如实报失败（不重跑）', async () => {
      const h = await harness();
      await accepted(h);
      await bothEnvelopes(h);
      await h.router.handle(h.stageDispatch());
      const faults = faultInjector(h);
      faults.failNth('DELIVERY', 1);
      await h.router.handle(h.stageDispatch('dec'));

      // 制品库里的那一份被换过：摘要对不上出口回执（EXITED）
      const stored = h.artifacts.read(DEC_HANDLE)!;
      h.artifacts.put({ ...stored, payload: { ...stored.payload, cohortSize: 999 } });
      faults.heal();
      await h.router.handle(h.stageDispatch('dec'));

      expect(sentOf(h, 'DELIVERY')).toHaveLength(0);
      expect(statuses(h, 'dec', 'SUCCEEDED')).toHaveLength(0);
      const failed = statuses(h, 'dec', 'FAILED');
      expect(failed).toHaveLength(1);
      expect(failed[0].body).toMatchObject({ code: 'E_RELEASE_CHECK_FAILED' });
      expect(inChain(h.receipts, 'dec', 'EXECUTED')).toBe(1);
      expect(h.budget.entries()).toHaveLength(1);
    });

    it('平台明确拒收（如见证过了有效期）不是再试一次能好的：如实报阶段失败，不重跑、不再要钥匙', async () => {
      const h = await harness();
      await accepted(h);
      await bothEnvelopes(h);
      const faults = faultInjector(h);
      // 平台对过期凭据的应答：HTTP 400 + 协议错误码（`verifySessionWitness` → 「释放凭据已过期」）
      faults.failAll(
        ['AttestationReport'],
        () => new MdopOutboundHttpError('/mdop/messages', 400, 'E_KEY_RELEASE_DENIED'),
      );

      const first = await h.router.handle(h.stageDispatch());
      expect(first.status).toBe('handled');
      const failed = statuses(h, 'pair', 'FAILED');
      expect(failed).toHaveLength(1);
      // 错误码沿用平台给的那一个（不可重试 → 平台直接让作业失败并销毁，不再退避重发）
      expect(failed[0].body).toMatchObject({ code: 'E_KEY_RELEASE_DENIED', attempt: 1 });
      expect(String(failed[0].body.message)).toMatch(/会话见证/);
      expect(statuses(h, 'pair', 'SUCCEEDED')).toHaveLength(0);

      // 即便指令再被重发，也只是再试上报——不重跑、不再向保管方要钥匙
      await h.router.handle(h.stageDispatch());
      expect(h.wasmRuns()).toBe(1);
      expect(h.keyReleases()).toBe(2);
    });
  });

  it('销毁指令 → 销毁制品 + 签名回执（幂等），链上出现 PURGED', async () => {
    const h = await harness();
    await accepted(h);
    await h.router.handle(h.relay('A'));
    await h.router.handle(h.relay('B'));
    // 先把配对阶段跑掉（否则没有制品可销毁）
    await h.router.handle(h.stageDispatch());

    const result = await h.router.handle(h.purgeOrder());
    expect(result.status).toBe('handled');
    const receipt = h.sent.find((s) => s.msgType === 'PurgeReceipt');
    expect(receipt).toBeDefined();
    // 回执必须是平台解析器读得回的形状
    const parsed = parsePurgeReceipt(receipt!.body);
    expect(parsed.job_id).toBe(JOB);
    expect(parsed.node).toBe(NODE);
    expect(parsed.handles).toContain(`art://${NODE}/${JOB}/pair`);
    expect(h.artifacts.read(`art://${NODE}/${JOB}/pair`)).toBeNull();
    expect(h.receipts.list(JOB).map((r) => r.event)).toContain('PURGED');
    // 重复指令：同一幂等键 → 同一份回执内容（不产出第二份不同内容的回执）
    const again = await h.router.handle(h.purgeOrder());
    expect(again.status).toBe('handled');
    const second = parsePurgeReceipt(h.sent.filter((s) => s.msgType === 'PurgeReceipt')[1].body);
    expect(second.receipt_id).toBe(parsed.receipt_id);
    expect(second.destroyed_at).toBe(parsed.destroyed_at);
  });
});
