import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalDevKms,
  SoftwareAttestationProvider,
  canonicalize,
  canonicalSm3,
  createAttestationVerifier,
  generateSm2KeyPair,
  mapVendorQuote,
  reportDataBinding,
  parseAuditReceipt,
  parseMdopContract,
  publicKeyFromPrivateKey,
  publicKeyKid,
  sm2Sign,
  verifyEnvelope,
  type AttestationPolicy,
  type AttestationReport,
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
import { NodePublicationReview } from '../mdop/node/publication-review';
import { buildSealedEnvelope, type SealContractTerms } from '../mdop/operators/seal';
import { loadTeeNodeConfig } from './config';
import { NodeContractStore } from './contract-store';
import { loadNodeIdentity } from './identity';
import {
  createAttestationProvider,
  createKmsClient,
  nodeCapabilityAdvertisement,
} from './providers';
import { buildWitnessEnvelope, reportSessionWitnesses } from './witness-report';
import { receiveRelayedEnvelope } from './relay-receive';
import { NodeReceiptReporter } from './receipt-report';
import { createNodeStateStore, exportReceiptsForJob } from './state';
import { NodeStateFile } from './persist';
import { runNodeSession } from './session';

/**
 * 可信空间节点组件（任务 3.1–3.3 / 3.11 / 6.7 的发送侧）。
 *
 * 要证明四件事：
 *  ① 身份自持且**私钥文件权限 0600**（组/其他可读即拒）；
 *  ② **两道配置闸门**真的会拦住「软件实现顶上」——生产环境用软件提供者直接拒绝启动；
 *  ③ 能力通告**由真跑一次证明得出**：软件提供者恒 `tee: null`（编译器因此不会把 C2 放过来）；
 *  ④ 会话跑完后**每个 `key_id` 出一条见证**并上报（`AttestationReport`），
 *     这让「持有方独立核验」有了发送端（组件之前，这条链只有接收侧）。
 */

const NOW = new Date('2026-09-25T10:00:00.000Z');
const SPACE = 'sh-med';
const NODE_ID = 'tee-1';
const NODE = `urn:tds:${SPACE}:participant:${NODE_ID}`;
const PLATFORM = `urn:tds:${SPACE}:participant:platform`;
const HOSP = `urn:tds:${SPACE}:participant:p-huashan`;
const OP = 'cohort.count@1.0.0';
const MEAS = `sm3:${'a'.repeat(64)}`;
const POLICY: AttestationPolicy = {
  tee: ['tdx'],
  min_tcb: { tdx: '3.1.0' },
  allowed_measurements: [MEAS],
};
const CONTRACT: SealContractTerms = {
  contract_id: 'ctr-node',
  data_product_id: 'dp-cohort',
  allowed_ops: [OP],
  attestation_policy: POLICY,
  valid_until: '2027-09-30T00:00:00.000Z',
};

const HOLDER = generateSm2KeyPair();
const PLATFORM_KEYS = generateSm2KeyPair();
const NODE_KEYS = generateSm2KeyPair();
const KMS_KEY = generateSm2KeyPair();
const EPH = generateSm2KeyPair();

/**
 * 一份**双签的合约副本**（任务 3.15）：canonical 由持有方与平台各签一次。
 * 节点侧只认「平台副署用部署配置里的平台公钥验通 + 持有方公钥 kid 与条款一致」的副本。
 */
function contractCopy() {
  const contract = parseMdopContract({
    apiVersion: 'mdop/v0.2',
    contract_id: CONTRACT.contract_id,
    data_product_id: CONTRACT.data_product_id,
    provider: HOSP,
    consumer: `urn:tds:${SPACE}:participant:p-meddata`,
    purpose: 'RWS.EFFECTIVENESS',
    retention: '阅后即焚',
    recipients: [
      { party: PLATFORM, role: 'merger', jurisdiction: 'CN' },
      { party: HOSP, role: 'final', jurisdiction: 'CN' },
    ],
    allowed_ops: [OP],
    review: { mode: 'auto', deadline_hours: 24 },
    ethics: { required: false, ref: null, valid_until: null },
    provider_public_key_kid: publicKeyKid(HOLDER.publicKey),
    platform_public_key_kid: publicKeyKid(PLATFORM_KEYS.publicKey),
    pre_review_snapshot: null,
    publication: { minCell: 5 },
    valid_from: '2026-09-01T00:00:00.000Z',
    valid_until: '2027-09-01T00:00:00.000Z',
    attestation_policy: { tee: ['tdx'], min_tcb: { tdx: '3.1.0' } },
  });
  const canonical = canonicalize(contract);
  return {
    canonical,
    holderSignature: sm2Sign(canonical, HOLDER.privateKey, {
      publicKey: HOLDER.publicKey,
    }),
    platformCountersignature: sm2Sign(canonical, PLATFORM_KEYS.privateKey, {
      publicKey: PLATFORM_KEYS.publicKey,
    }),
  };
}

/** 硬件证明代理替身（真实实现对接 CSV/TDX/SEV-SNP 证明链）。 */
class HardwareProviderDouble {
  readonly providerKind = 'tdx' as const;
  lastEphemeralPrivateKey = EPH.privateKey;
  constructor(private readonly tcb = '3.1.2') {}

  async prove(): Promise<AttestationReport> {
    const quote: VendorQuote = {
      vendor: 'tdx',
      measurement: MEAS,
      tcb: this.tcb,
      quote: 'dGR4LXF1b3Rl',
      signed_at: new Date(NOW.getTime() - 30_000).toISOString(),
      valid_until: new Date(NOW.getTime() + 300_000).toISOString(),
      ephemeral_public_key: EPH.publicKey,
      report_data: reportDataBinding(EPH.publicKey),
      node: NODE,
    };
    return mapVendorQuote(quote);
  }
}

function tempKeyFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'tee-node-')), 'node.key');
}

describe('可信空间节点组件（任务 3.1–3.3 / 6.7 发送侧）', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
  });

  /**
   * 配置读取走 `process.env.<KEY>` 直读（部署登记表与读取点靠它双向对拍），
   * 因此用例也直接改 `process.env`——在 `afterEach` 里恢复。
   */
  async function withEnv(
    values: Record<string, string | undefined>,
    fn: () => void | Promise<void>,
  ): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fn();
  }

  function baseEnv(over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
    return {
      TEE_NODE_PARTICIPANT_ID: NODE_ID,
      TEE_NODE_KMS_PUBKEY: publicKeyFromPrivateKey(KMS_KEY.privateKey),
      SPACE_ID: SPACE,
      NODE_ENV: undefined,
      TEE_NODE_ATTESTATION_PROVIDER: undefined,
      TEE_NODE_KMS_MODE: undefined,
      TEE_NODE_ALLOW_DEV_PROVIDERS: undefined,
      TEE_NODE_KEY_FILE: undefined,
      ...over,
    };
  }

  describe('身份：自持密钥、0600、参与方 URN', () => {
    it('首次生成落在 0600 的文件里，且 URN/公钥/kid 自洽', () => {
      const keyFile = tempKeyFile();
      const id = loadNodeIdentity({ participantId: NODE_ID, keyFile, spaceId: SPACE, create: true });
      expect(statSync(keyFile).mode & 0o777).toBe(0o600);
      expect(id.urn).toBe(NODE);
      expect(id.publicKey).toBe(publicKeyFromPrivateKey(id.privateKey));
      expect(id.kid).toMatch(/^[0-9a-f]{64}$/);
    });

    it('权限放宽（0644）→ 拒绝加载（组/其他可读即拒）', () => {
      const keyFile = tempKeyFile();
      loadNodeIdentity({ participantId: NODE_ID, keyFile, spaceId: SPACE, create: true });
      chmodSync(keyFile, 0o644);
      expect(() =>
        loadNodeIdentity({ participantId: NODE_ID, keyFile, spaceId: SPACE }),
      ).toThrow(/0600/);
    });

    it('没有密钥文件且不允许创建 → 明确报错（不静默生成）', () => {
      expect(() =>
        loadNodeIdentity({ participantId: NODE_ID, keyFile: tempKeyFile(), spaceId: SPACE }),
      ).toThrow(/不存在/);
    });
  });

  describe('配置闸门：软件实现不得作为 C2 上线', () => {
    it('软件提供者 / 本机演练 KMS 需显式开关；没开 → 拒绝启动', () => {
      withEnv(baseEnv({ TEE_NODE_ATTESTATION_PROVIDER: 'software' }), () => {
        expect(() => loadTeeNodeConfig()).toThrow(/开发替身/);
      });
    });

    it('生产环境即便开了开关也用不了软件提供者（软件隔离不是 TEE）', () => {
      withEnv(
        baseEnv({
          NODE_ENV: 'production',
          TEE_NODE_ALLOW_DEV_PROVIDERS: 'true',
          TEE_NODE_ATTESTATION_PROVIDER: 'software',
        }),
        () => {
          expect(() => loadTeeNodeConfig()).toThrow(/生产环境不得使用/);
        },
      );
    });

    it('真实提供者 + 远程 KMS：不需要开发开关即可启动（但仍要 KMS 公钥）', () => {
      withEnv(
        baseEnv({ TEE_NODE_ATTESTATION_PROVIDER: 'hardware', TEE_NODE_KMS_MODE: 'remote' }),
        () => {
          const cfg = loadTeeNodeConfig();
          expect(cfg.urn).toBe(NODE);
          expect(cfg.attestationProvider).toBe('hardware');
        },
      );
      withEnv(baseEnv({ TEE_NODE_ATTESTATION_PROVIDER: 'hardware', TEE_NODE_KMS_MODE: 'remote', TEE_NODE_KMS_PUBKEY: undefined }), () => {
        expect(() => loadTeeNodeConfig()).toThrow(/TEE_NODE_KMS_PUBKEY/);
      });
    });
  });

  describe('两处接缝：未接入真实实现时明确报错，不静默降级', () => {
    it('硬件证明代理未注入 → 报错（指向 D-TEE-3）', () => {
      withEnv(baseEnv({ TEE_NODE_ATTESTATION_PROVIDER: 'hardware', TEE_NODE_KMS_MODE: 'remote' }), () => {
        expect(() => createAttestationProvider(loadTeeNodeConfig())).toThrow(/未接入真实证明代理/);
      });
    });

    it('真实 KMS 客户端未注入 → 报错（指向 D-TEE-1）', () => {
      withEnv(baseEnv({ TEE_NODE_ATTESTATION_PROVIDER: 'hardware', TEE_NODE_KMS_MODE: 'remote' }), () => {
        expect(() => createKmsClient(loadTeeNodeConfig())).toThrow(/未接入真实 KMS 客户端/);
      });
    });

    it('软件提供者实例化后确实是 software/none（永远过不了 C2 判定）', async () => {
      await withEnv(baseEnv({ TEE_NODE_ALLOW_DEV_PROVIDERS: 'true' }), async () => {
        const provider = createAttestationProvider(loadTeeNodeConfig());
        const report = await provider.prove();
        expect(report.level).toBe('software');
        expect(report.isolation).toBe('none');
        expect(provider).toBeInstanceOf(SoftwareAttestationProvider);
      });
    });
  });

  describe('能力通告：由真跑一次证明得出（不得虚标）', () => {
    it('软件提供者 → tee 恒为 null（编译器不会把 C2 放过来）', async () => {
      const adv = await nodeCapabilityAdvertisement({
        provider: new SoftwareAttestationProvider({ measurement: MEAS }),
        runtime: ['native'],
        systemOps: [],
        whitelistDigests: [],
      });
      expect(adv.tee).toBeNull();
    });

    it('硬件级证明 → kind 与 min_tcb 取自报告本身', async () => {
      const adv = await nodeCapabilityAdvertisement({
        provider: new HardwareProviderDouble('3.1.5'),
        runtime: ['native', 'wasm'],
        systemOps: [],
        whitelistDigests: [],
      });
      expect(adv.tee).toEqual({ kind: 'tdx', min_tcb: '3.1.5' });
    });
  });

  describe('会话与见证上报（任务 3.11 / 6.7）', () => {
    /** 装配一台「什么都对齐」的节点：硬件替身 + 演练 KMS（都从组件工厂走）。 */
    async function harness() {
      const provider = new HardwareProviderDouble();
      const probe = await provider.prove();
      const roots: TrustedRoot[] = [
        { kind: 'tdx', verifyQuoteDigest: (d) => d === probe.quote_digest },
      ];
      const keys = new Map<string, Uint8Array>();
      await withEnv(
        baseEnv({
          TEE_NODE_ATTESTATION_PROVIDER: 'hardware',
          TEE_NODE_KMS_MODE: 'local-dev',
          TEE_NODE_ALLOW_DEV_PROVIDERS: 'true',
          TEE_NODE_KEY_FILE: tempKeyFile(),
        }),
        async () => undefined,
      );
      const cfg = loadTeeNodeConfig();
      const identity = loadNodeIdentity({
        participantId: cfg.participantId,
        keyFile: cfg.keyFile,
        spaceId: cfg.spaceId,
        create: true,
      });
      const attestation = createAttestationProvider(cfg, {
        hardwareAttestation: () => provider,
      });
      const kms = createKmsClient(cfg, {
        devKms: { privateKey: KMS_KEY.privateKey, keys, roots },
      }) as LocalDevKms;

      const executor = new MdopStageExecutor();
      executor.setWasmRunner(async () => ({
        schema: 'rws.count@1',
        payload: { analysisType: 'cohort-count', cohortSize: 120, buckets: [{ key: 'all', count: 120 }] },
      }));

      const receipts = new NodeReceiptChain({ node: NODE, privateKey: identity.privateKey });
      const artifacts = new NodeArtifactStore({ node: NODE, privateKey: identity.privateKey });
      const session = new TrustedNodeSession({
        node: NODE,
        attestation,
        kms,
        kmsPublicKey: cfg.kmsPublicKey,
        unwrapKey: (warrant) => kms.unwrapKey(warrant, provider.lastEphemeralPrivateKey),
        entryGuard: new TrustedNodeEntryGuard(
          new Map([[HOSP, publicKeyFromPrivateKey(HOLDER.privateKey)]]),
        ),
        review: new NodePublicationReview(new OutputGate(new AuditService(), new Deidentifier())),
        exitGuard: new NodeExitGuard(),
        receipts,
        artifacts,
        budget: new NodeQueryBudgetLedger(),
        executor,
      });

      const built = await buildSealedEnvelope(
        {
          jobId: 'job-node',
          credentialId: 'tkt-node',
          contract: CONTRACT,
          projection: { productId: 'dp-cohort', rows: [{ subjectKey: 'sk-1', exposure: true }] },
          dataProductId: 'dp-cohort',
          allowedOps: [OP],
        },
        {
          kmsRef: cfg.kmsRef,
          watermarkPrefix: `wm:site-a:${SPACE}`,
          signer: HOSP,
          sign: (content) => ({
            alg: 'SM2-SM3',
            value: sm2Sign(content, HOLDER.privateKey, {
              publicKey: publicKeyFromPrivateKey(HOLDER.privateKey),
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

      const input = {
        jobId: 'job-node',
        credentialId: 'tkt-node',
        contractId: CONTRACT.contract_id,
        contract: {
          contract_id: CONTRACT.contract_id,
          data_product_id: 'dp-cohort',
          allowed_ops: [OP],
          attestation_policy: POLICY,
        },
        policy: POLICY,
        expectation: { tee: 'tdx', measurement: MEAS, min_tcb: '3.1.0' },
        inputs: [
          {
            rawEnvelope: built.envelope,
            sealed: { ciphertext: built.ciphertext, iv: built.iv, tag: built.tag },
            keyOwner: { job_id: 'job-node', contract_id: CONTRACT.contract_id },
          },
        ],
        holderKeys: new Map([[HOSP, publicKeyFromPrivateKey(HOLDER.privateKey)]]),
        credentialValid: true,
        contractActive: true,
        stage: {
          id: 'st-count',
          node: NODE,
          op: OP,
          op_digest: `sm3:${'9'.repeat(64)}`,
          params: {},
          inputs: [{ from: built.envelope.payload.ciphertext_ref }],
          input_labels: ['C2'],
          output_label: 'C2',
          output_schema: 'rws.count@1',
        },
        manifest: {
          apiVersion: 'mdop/v1',
          kind: 'wasm',
          id: 'cohort.count',
          version: '1.0.0',
          category: 'local',
          digest: `sm3:${'8'.repeat(64)}`,
          publisher: 'urn:tds:sh-med:operator-registry',
          inputs: [{ name: 'in', schema: 'mdop.projection@1', accept_labels: ['C0', 'C2'] }],
          outputs: [{ name: 'out', schema: 'rws.count@1', label_rule: 'inherit' }],
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
          policy: { limit: 5, unit: 'queries' as const },
          cost: 1,
          applicant: 'urn:tds:sh-med:participant:pharma-1',
        },
        now: NOW,
      } as Parameters<TrustedNodeSession['run']>[0];

      return { cfg, identity, session, input, kms, built, receipts, artifacts };
    }

    it('回执链上报：节点回执就是 AuditReceipt（平台解析器读得回、链头算法与平台一致、重复上报不重发）', async () => {
      const h = await harness();
      const outbound = new MdopOutboundClient({
        baseUrl: 'http://127.0.0.1:1/api/v1',
        participantId: NODE_ID,
        privateKey: h.identity.privateKey,
      });
      const sent: Array<{ msgType: string; body: Record<string, unknown> }> = [];
      (outbound as unknown as { sendMessage: unknown }).sendMessage = async (envelope: {
        msg_type: string;
        body: Record<string, unknown>;
      }) => {
        sent.push({ msgType: envelope.msg_type, body: envelope.body });
        return { ok: true };
      };

      await runNodeSession(h.session, h.input);
      const reporter = new NodeReceiptReporter({
        receipts: h.receipts,
        outbound,
        platform: PLATFORM,
      });
      const first = await reporter.report('job-node');
      expect(first).toBe(3); // UNSEALED / EXECUTED / EXITED
      expect(sent.every((s) => s.msgType === 'AuditReceipt')).toBe(true);

      // 平台侧 ingest 的第一步就是 parseAuditReceipt；读不回来说明形状不合法
      for (const item of sent) expect(() => parseAuditReceipt(item.body)).not.toThrow();
      // 平台 `chainHead()` 算的是 canonicalSm3(解析后的回执)——本地链头必须与之逐条一致
      let prev: string | null = null;
      for (const item of sent) {
        const parsed = parseAuditReceipt(item.body);
        expect(parsed.prev_receipt_hash).toBe(prev);
        prev = canonicalSm3(parsed);
      }
      expect(prev).toBe(h.receipts.head('job-node'));

      // 已上报的不重发（至少一次投递下由幂等键 `audit:${receipt_id}` 收口）
      expect(await reporter.report('job-node')).toBe(0);
      expect(sent).toHaveLength(3);
    });

    it('会话结束后本地状态落盘，且重启后能从盘上导出离线核验文件', async () => {
      const stateDir = mkdtempSync(join(tmpdir(), 'tee-node-e2e-'));
      const h = await harness();
      const outbound = new MdopOutboundClient({
        baseUrl: 'http://127.0.0.1:1/api/v1',
        participantId: NODE_ID,
        privateKey: h.identity.privateKey,
      });
      (outbound as unknown as { sendMessage: unknown }).sendMessage = async () => ({ ok: true });
      (outbound as unknown as { sendDelivery: unknown }).sendDelivery = async () => ({ ok: true });
      const state = createNodeStateStore({ receipts: h.receipts, artifacts: h.artifacts, dir: stateDir });

      await receiveRelayedEnvelope(
        {
          session: h.session,
          outbound,
          platform: PLATFORM,
          contracts: new NodeContractStore(),
          platformPublicKey: PLATFORM_KEYS.publicKey,
          state,
        },
        {
          jobId: 'job-node',
          credentialId: 'tkt-node',
          relay: {
            data_envelope: h.built.envelope,
            sealed: { ciphertext: h.built.ciphertext, iv: h.built.iv, tag: h.built.tag },
            holder: HOSP,
            credential_id: 'tkt-node',
          },
          contractId: CONTRACT.contract_id,
          contractCopy: contractCopy(),
          policy: POLICY,
          expectation: { tee: 'tdx', measurement: MEAS, min_tcb: '3.1.0' },
          holderKeys: new Map([[HOSP, publicKeyFromPrivateKey(HOLDER.privateKey)]]),
          stage: h.input.stage,
          manifest: h.input.manifest,
          minCell: 5,
          budget: {
            key: { dataset: 'dp-cohort', snapshot: `sm3:${'6'.repeat(64)}` },
            policy: { limit: 5, unit: 'queries' },
            cost: 1,
            applicant: 'urn:tds:sh-med:participant:pharma-1',
          },
          now: NOW,
        },
      );

      // 盘上确实写了状态（目录 0700 / 文件 0600），回执按序落盘
      const stateFile = new NodeStateFile({ dir: stateDir });
      expect(statSync(stateDir).mode & 0o777).toBe(0o700);
      expect(statSync(stateFile.path()).mode & 0o777).toBe(0o600);
      const saved = JSON.parse(readFileSync(stateFile.path(), 'utf8'));
      expect(saved.receipts[0].receipts.map((r: { event: string }) => r.event)).toEqual([
        'UNSEALED',
        'EXECUTED',
        'EXITED',
      ]);

      // 「重启」：全新内存 store + 从盘上 hydrate → 导出给离线工具
      const freshChain = new NodeReceiptChain({ node: NODE, privateKey: h.identity.privateKey });
      const freshArtifacts = new NodeArtifactStore({ node: NODE, privateKey: h.identity.privateKey });
      const freshState = createNodeStateStore({
        receipts: freshChain,
        artifacts: freshArtifacts,
        dir: stateDir,
      });
      const exported = exportReceiptsForJob({
        jobId: 'job-node',
        receipts: freshChain,
        store: freshState,
        dir: stateDir,
      });
      expect(exported.count).toBe(3);
      expect(statSync(exported.file).mode & 0o777).toBe(0o600);
    });

    it('接收平台中继的 C2 信封 → 跑会话 → 登记句柄 + 投递 C3 + 上报见证与回执', async () => {
      const h = await harness();
      const outbound = new MdopOutboundClient({
        baseUrl: 'http://127.0.0.1:1/api/v1',
        participantId: NODE_ID,
        privateKey: h.identity.privateKey,
      });
      const sent: Array<{ kind: 'message' | 'delivery'; msgType?: string; body?: unknown; payload?: unknown }> = [];
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

      const outcome = await receiveRelayedEnvelope(
        {
          session: h.session,
          outbound,
          platform: PLATFORM,
          // 合约副本库 + 部署配置里的平台公钥（任务 3.15）
          contracts: new NodeContractStore(),
          platformPublicKey: PLATFORM_KEYS.publicKey,
          // 回执链上报（§3.9 / 8.5 的锚定那一半）
          receipts: new NodeReceiptReporter({
            receipts: h.receipts,
            outbound,
            platform: PLATFORM,
          }),
        },
        {
          jobId: 'job-node',
          credentialId: 'tkt-node',
          relay: {
            data_envelope: h.built.envelope,
            sealed: { ciphertext: h.built.ciphertext, iv: h.built.iv, tag: h.built.tag },
            holder: HOSP,
            credential_id: 'tkt-node',
          },
          contractId: CONTRACT.contract_id,
          // 首次随中继带来副本：条款只从**验过双签**的副本取
          contractCopy: contractCopy(),
          policy: POLICY,
          expectation: { tee: 'tdx', measurement: MEAS, min_tcb: '3.1.0' },
          holderKeys: new Map([[HOSP, publicKeyFromPrivateKey(HOLDER.privateKey)]]),
          stage: h.input.stage,
          manifest: h.input.manifest,
          minCell: 5,
          budget: {
            key: { dataset: 'dp-cohort', snapshot: `sm3:${'6'.repeat(64)}` },
            policy: { limit: 5, unit: 'queries' },
            cost: 1,
            applicant: 'urn:tds:sh-med:participant:pharma-1',
          },
          now: NOW,
        },
      );

      expect(outcome).toMatchObject({ witnesses: 1, handleRegistered: true, delivered: true });
      expect(outcome.label).toBe('C3');
      expect(outcome.published).toBe(true);
      expect(outcome.payload).toMatchObject({ cohortSize: 120 });
      // 顺序：先登记句柄（控制面，不含载荷），再投递载荷（数据面），然后上报见证与回执链
      expect(sent.map((s) => s.msgType)).toEqual([
        'ArtifactReady',
        'DELIVERY',
        'AttestationReport',
        'AuditReceipt',
        'AuditReceipt',
        'AuditReceipt',
      ]);
      const ready = sent[0].body as { handle: { handle: string; label: string; digest: string } };
      expect(ready.handle.label).toBe('C3');
      expect(ready.handle.digest).toBe(canonicalSm3(outcome.payload));
      // 数据面只带 C3 载荷（平台是合约明示的接收方）
      expect(sent[1].payload).toMatchObject({ cohortSize: 120 });
      expect(outcome.receipts).toBe(3);
    });

    it('会话结束后每个 key_id 出一条见证（证明 + 释放凭据都在本体里）', async () => {
      const h = await harness();
      const { result, witnesses } = await runNodeSession(h.session, h.input);
      expect(result.c3).toMatchObject({ cohortSize: 120 });
      expect(witnesses).toHaveLength(1);
      const [witness] = witnesses;
      expect(witness.node).toBe(NODE);
      expect(witness.job_id).toBe('job-node');
      expect(witness.warrant.warrant_digest).toBe(witness.warrant.warrant_digest);
      expect(witness.report.quote_digest).toMatch(/^sm3:/);
      expect(witness.report.ephemeral_public_key).toBeTruthy();
    });

    it('见证本体随 AttestationReport 上报：节点私钥签名、收件人是平台', async () => {
      const h = await harness();
      const { witnesses } = await runNodeSession(h.session, h.input);
      const outbound = new MdopOutboundClient({
        baseUrl: 'http://127.0.0.1:1/api/v1',
        participantId: NODE_ID,
        privateKey: h.identity.privateKey,
      });
      const sent: unknown[] = [];
      (outbound as unknown as { sendMessage: unknown }).sendMessage = async (envelope: unknown) => {
        sent.push(envelope);
        return { ok: true };
      };

      const count = await reportSessionWitnesses(witnesses, { receiver: PLATFORM, outbound });
      expect(count).toBe(1);
      const envelope = sent[0] as {
        msg_type: string;
        sender: string;
        receiver: string;
        body: { witness: { warrant: { warrant_digest: string } } };
        sig: { value: string };
      };
      expect(envelope.msg_type).toBe('AttestationReport');
      expect(envelope.sender).toBe(NODE);
      expect(envelope.receiver).toBe(PLATFORM);
      // 本体完整随行（持有方要拿它验签，摘要不够）
      expect(envelope.body.witness.warrant.warrant_digest).toBe(witnesses[0].warrant.warrant_digest);
      // `verifyEnvelope` 通过时返回信封本体、失败时抛错（所以这里只断言「不抛」）
      expect(() =>
        verifyEnvelope(envelope as never, {
          self: PLATFORM,
          senderPublicKey: h.identity.publicKey,
          // 本用例只验签名口径：nonce 由平台侧的持久表负责，这里不重复拦
          nonceStore: { seen: () => false, remember: () => undefined },
        }),
      ).not.toThrow();
    });

    it('见证的幂等键含凭据摘要（重发同一份不会产生第二条消息）', async () => {
      const h = await harness();
      const { witnesses } = await runNodeSession(h.session, h.input);
      const outbound = new MdopOutboundClient({
        baseUrl: 'http://127.0.0.1:1/api/v1',
        participantId: NODE_ID,
        privateKey: h.identity.privateKey,
      });
      const first = buildWitnessEnvelope(witnesses[0], { receiver: PLATFORM, outbound });
      const second = buildWitnessEnvelope(witnesses[0], { receiver: PLATFORM, outbound });
      expect(first.idempotency_key).toBe(second.idempotency_key);
      expect(first.idempotency_key).toContain(witnesses[0].warrant.warrant_digest);
      expect(canonicalSm3(first.body).length).toBeGreaterThan(0);
    });
  });
});
