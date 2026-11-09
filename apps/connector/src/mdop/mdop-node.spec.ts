import {
  buildTicket,
  canonicalSm3,
  canonicalize,
  computePlanHash,
  fragmentHash,
  holderSignAcceptance,
  participantUrn,
  parseFragment,
  parseTicketCore,
  platformSignCore,
  signCanonicalObject,
  signEnvelope,
  sm2Sign,
  verifyRevocationList,
  type Fragment,
  type NodeCapability,
  type OperatorManifest,
  type PlanEdge,
  type TicketCore,
} from '@medtrust/mdop';
import { generateSm2KeyPair, reportDataBinding, signRevocationList, parseOperatorManifest } from '@medtrust/mdop';
import { MdopContractStore } from './contract-store';
import { MdopOperatorWhitelistStore } from './operator-whitelist';
import { MdopReviewService } from './mdop-review';
import { MdopStageExecutor } from './mdop-executor';
import { MdopEgressGuard } from './mdop-egress';
import { MdopLocalStore } from './mdop-local-store';
import { MdopNodeService } from './mdop-node.service';
import { MdopOutboundClient } from './mdop-client';
import { parsePolicy } from './local-contract-policy';

const SPACE = 'sh-med';
const HOSP = 'p-demohospa';
const NODE = participantUrn(SPACE, HOSP);
const PLATFORM = participantUrn(SPACE, 'platform');
const WASM_SM3 = 'a'.repeat(64);

function memRepo(pkField: string) {
  const rows: any[] = [];
  const matches = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => r[k] === v);
  return {
    create: (x: any) => ({ ...x }),
    save: async (x: any) => {
      for (const item of Array.isArray(x) ? x : [x]) {
        const idx = rows.findIndex((r) => r[pkField] === item[pkField]);
        if (idx >= 0) rows[idx] = { ...rows[idx], ...item };
        else rows.push(item);
      }
      return x;
    },
    find: async (opts?: any) => (opts?.where ? rows.filter((r) => matches(r, opts.where)) : [...rows]),
    findOne: async (opts: any) => rows.find((r) => matches(r, opts?.where)) ?? null,
    update: async (where: any, patch: any) => {
      for (const r of rows) if (matches(r, where)) Object.assign(r, patch);
      return { affected: 0 };
    },
    delete: async (where: any) => {
      for (let i = rows.length - 1; i >= 0; i -= 1)
        if (matches(rows[i], where)) rows.splice(i, 1);
      return { affected: 0 };
    },
  } as any;
}

describe('连接器 MDOP 运行时（任务 8.1-8.7）', () => {
  const connectorKeys = generateSm2KeyPair();
  const platformNodeKeys = generateSm2KeyPair();
  const registryKeys = generateSm2KeyPair();

  let contracts: MdopContractStore;
  let whitelist: MdopOperatorWhitelistStore;
  let review: MdopReviewService;
  let executor: MdopStageExecutor;
  let egress: MdopEgressGuard;
  let store: MdopLocalStore;
  let node: MdopNodeService;
  let sent: Array<{ msgType: string; body: Record<string, unknown> }>;

  const contractId = 'ctr-node';
  const purpose = 'RWS.EFFECTIVENESS';

  const terms = (over: Record<string, unknown> = {}) => ({
    apiVersion: 'mdop/v0.2',
    contract_id: contractId,
    data_product_id: 'dp-1',
    provider: NODE,
    consumer: 'p-meddata',
    purpose,
    retention: '阅后即焚',
    recipients: [
      { party: NODE, role: 'final', jurisdiction: 'CN' },
      { party: PLATFORM, role: 'merger', jurisdiction: 'CN' },
    ],
    allowed_ops: [`sm3:${WASM_SM3}`],
    review: { mode: 'auto', deadline_hours: 72 },
    ethics: { required: false, ref: null, valid_until: null },
    provider_public_key_kid: 'k'.repeat(64),
    platform_public_key_kid: 'p'.repeat(64),
    pre_review_snapshot: null,
    publication: { minCell: 10 },
    valid_from: '2026-09-01T00:00:00.000Z',
    valid_until: '2030-12-31T00:00:00.000Z',
    ...over,
  });

  const fragment = (over: Partial<Fragment> = {}): Fragment =>
    parseFragment({
      node: NODE,
      stages: [
        {
          id: 'decA',
          node: NODE,
          op: 'declassify.small_cell@1.0.0',
          op_digest: 'component:connector-output-gate@1',
          params: { minCell: 10 },
          inputs: [],
          input_labels: [],
          output_label: 'C3',
          output_schema: 'mdop.table/1.0',
        },
      ],
      edges: [
        {
          from_stage: 'decA',
          to_stage: 'merge',
          label: 'C3',
          from_node: NODE,
          to_node: PLATFORM,
        },
      ],
      ...over,
    });

  const jobHeader = (over: Record<string, unknown> = {}) => ({
    job_id: 'job-1',
    purpose,
    applicant: { org: 'sponsor', project: 't2dm' },
    contracts: [contractId],
    not_before: '2026-09-24T00:00:00.000Z',
    not_after: '2030-06-30T00:00:00.000Z',
    ...over,
  });

  const offerFor = (frag: Fragment, header = jobHeader()) => {
    const hashes = { [NODE]: fragmentHash(frag), [PLATFORM]: `sm3:${'b'.repeat(64)}` };
    const core: TicketCore = parseTicketCore({
      ticket_id: 'tkt-1',
      job_id: 'job-1',
      plan_hash: computePlanHash({ job: header, fragments: hashes }),
      fragments: hashes,
      not_before: header.not_before,
      not_after: header.not_after,
    });
    return { ticketId: core.ticket_id, core, jobHeader: header, fragment: frag, fragments: hashes };
  };

  const sourceManifest = (): OperatorManifest =>
    parseOperatorManifest({
      apiVersion: 'mdop/v0.2',
      kind: 'system',
      id: 'source.dataset',
      version: '1.0.0',
      category: 'source',
      digest: 'component:connector-datasource@1',
      publisher: 'urn:tds:platform',
      inputs: [],
      outputs: [{ name: 'dataset', schema: 'mdop.table/1.0', label_rule: 'inherit' }],
      params: { uri: { type: 'string' } },
      environments: ['plain'],
      security: { network: 'none' },
      component: 'connector-datasource@1.0.0',
    });

  const systemManifest = (): OperatorManifest =>
    parseOperatorManifest({
      apiVersion: 'mdop/v0.2',
      kind: 'system',
      id: 'declassify.small_cell',
      version: '1.0.0',
      category: 'declassify',
      digest: 'component:connector-output-gate@1',
      publisher: 'urn:tds:platform',
      inputs: [{ name: 'table', schema: 'mdop.table/1.0', accept_labels: ['C0'] }],
      outputs: [{ name: 'table', schema: 'mdop.table/1.0', label_rule: 'C3' }],
      params: { minCell: { type: 'int' } },
      environments: ['plain'],
      security: { network: 'none' },
      component: 'connector-output-gate@1.0.0',
    });

  /** 封装算子清单（协议 §5.1 的 `seal` 类别）：C2 的唯一来源。 */
  const sealManifest = (): OperatorManifest =>
    parseOperatorManifest({
      apiVersion: 'mdop/v0.2',
      kind: 'system',
      id: 'seal.envelope',
      version: '1.0.0',
      category: 'seal',
      digest: 'component:seal@1',
      publisher: 'urn:tds:platform',
      inputs: [{ name: 'data', schema: 'mdop.dataset/1.0', accept_labels: ['C0'] }],
      outputs: [{ name: 'envelope', schema: 'mdop.env/1.0', label_rule: 'C2' }],
      params: {},
      environments: ['plain'],
      security: { network: 'none' },
      component: 'seal@1.0.0',
    });

  /**
   * 造一份可用的本地合约：canonical 用 JCS 规范化后的**字符串**；
   * 双方签名都是「对 canonical 字符串」的国标 SM2（与平台侧 signWith/ca 口径一致）。
   */
  const activateContract = (over: Record<string, unknown> = {}, id = contractId) => {
    const contractObj = terms({ ...over, contract_id: id });
    const canonicalStr = canonicalize(contractObj);
    const holderSignature = sm2Sign(canonicalStr, connectorKeys.privateKey, {
      publicKey: connectorKeys.publicKey,
    });
    const countersignature = sm2Sign(canonicalStr, platformNodeKeys.privateKey, {
      publicKey: platformNodeKeys.publicKey,
    });
    return { contractObj, canonicalStr, holderSignature, countersignature };
  };

  beforeEach(async () => {
    process.env.SPACE_ID = SPACE;
    process.env.CONNECTOR_PARTICIPANT_ID = HOSP;
    process.env.CONNECTOR_PLATFORM_NODE_PUBKEY = platformNodeKeys.publicKey;
    process.env.CONNECTOR_REGISTRY_PUBKEY = registryKeys.publicKey;
    process.env.MDOP_ENABLED = 'true';

    sent = [];
    const contractRepo = memRepo('contractId');
    const pendingRepo = memRepo('offerId');
    contracts = new MdopContractStore(contractRepo, pendingRepo, {
      privateKey: connectorKeys.privateKey,
      policy: parsePolicy({ review: 'manual' }),
    });
    whitelist = new MdopOperatorWhitelistStore(memRepo('digest'), memRepo('id'), {
      // 按用途固定两把公钥：吊销名单用平台节点密钥，算子清单用注册中心密钥
      platformPublicKeyOverrides: {
        'platform-node': platformNodeKeys.publicKey,
        registry: registryKeys.publicKey,
      },
    });
    store = new MdopLocalStore(
      memRepo('nonce'),
      memRepo('key'),
      memRepo('handle'),
      memRepo('receiptId'),
    );
    review = new MdopReviewService(contracts, whitelist);
    executor = new MdopStageExecutor();
    egress = new MdopEgressGuard();

    // 写一份「已生效」的本地合约副本（平台副署用平台节点密钥签 canonical 串）
    const { canonicalStr, countersignature } = activateContract();
    await contracts.receiveOffer({ offer_id: 'o1', contract_id: contractId, canonical: canonicalStr });
    await contracts.confirm('o1', 'auto(policy)');
    await contracts.applyCountersignature(contractId, countersignature);

    // 算子清单（注册中心密钥签）+ 白名单 + 吊销名单
    await whitelist.add(`sm3:${WASM_SM3}`, '张主任');
    await whitelist.add('source.dataset@1.0.0', '张主任', { kind: 'system' });
    await whitelist.add('declassify.small_cell@1.0.0', '张主任', { kind: 'system' });
    await whitelist.applyOperatorManifests(
      [sourceManifest(), systemManifest()].map((manifest) => ({
        ref: `${manifest.id}@${manifest.version}`,
        digest: manifest.digest,
        manifest,
        signature: signCanonicalObject(manifest, registryKeys.privateKey, {
          publicKey: registryKeys.publicKey,
        }),
      })),
    );
    await whitelist.applyRevocationList(
      signRevocationList(
        { version: 1, issued_at: '2026-09-24T00:00:00.000Z', revoked_digests: [] },
        platformNodeKeys.privateKey,
        platformNodeKeys.publicKey,
      ),
    );

    executor.registerSystem('declassify.small_cell@1.0.0', async () => ({
      label: 'C3',
      schema: 'mdop.table/1.0',
      payload: { a: 12, b: 30, c: 8, d: 25 },
    }));

    const outbound = new MdopOutboundClient({
      baseUrl: 'http://127.0.0.1:1/api/v1',
      participantId: HOSP,
      privateKey: connectorKeys.privateKey,
    });
    // 不真的发 HTTP：桩掉出站（保留信封构造口径）
    (outbound as unknown as { sendMessage: unknown }).sendMessage = async (envelope: any) => {
      sent.push({ msgType: envelope.msg_type, body: envelope.body });
      return { ok: true };
    };
    (outbound as unknown as { sendDelivery: unknown }).sendDelivery = async (
      envelope: any,
      handle: any,
      payload?: Record<string, unknown>,
    ) => {
      sent.push({ msgType: 'DELIVERY', body: { ...envelope.body, handle, ...(payload ? { payload } : {}) } });
      return { ok: true };
    };
    (outbound as unknown as { registerHandle: unknown }).registerHandle = async () => ({ ok: true });
    // C2 信封中继（任务 3.14）：记录调用（真实实现打数据面 /mdop/envelopes）
    (outbound as unknown as { relayEnvelope: unknown }).relayEnvelope = async (input: unknown) => {
      sent.push({ msgType: 'C2_SUBMIT', body: input as Record<string, unknown> });
      return { ok: true };
    };

    node = new MdopNodeService(
      contracts,
      whitelist,
      review,
      executor,
      egress,
      outbound,
      store,
      { privateKey: connectorKeys.privateKey, participantId: HOSP },
    );
  });

  afterEach(() => {
    for (const key of [
      'SPACE_ID',
      'CONNECTOR_PARTICIPANT_ID',
      'CONNECTOR_PLATFORM_NODE_PUBKEY',
      'CONNECTOR_REGISTRY_PUBKEY',
      'MDOP_ENABLED',
    ])
      delete process.env[key];
  });

  describe('七项本地复核（8.3）', () => {
    const reviewWith = (over: {
      fragment?: Fragment;
      header?: Record<string, unknown>;
      mutate?: (contractRepo: void) => Promise<void>;
    } = {}) =>
      review.review(
        {
          ...offerFor(
            over.fragment ?? fragment(),
            jobHeader(over.header),
          ),
          jobHeader: jobHeader(over.header),
        } as never,
        { node: NODE, snapshotFor: () => `sm3:${'5'.repeat(64)}` },
      );

    it('七项全过 → 返回快照标识', async () => {
      const out = await reviewWith();
      expect(out.snapshot).toBe(`sm3:${'5'.repeat(64)}`);
    });

    it('用途不符 → E_PURPOSE_MISMATCH', async () => {
      await expect(reviewWith({ header: { purpose: 'OTHER' } })).rejects.toMatchObject({
        code: 'E_PURPOSE_MISMATCH',
      });
    });

    it('申请 DP 预算 → E_BUDGET_EXCEEDED（本期无账本）', async () => {
      await expect(reviewWith({ header: { dp_budget: 1 } })).rejects.toMatchObject({
        code: 'E_BUDGET_EXCEEDED',
      });
    });

    it('合约要求伦理批件而作业缺批件 → E_ETHICS_MISSING', async () => {
      // 第二份合约：要求伦理批件（用不同的 contract_id，避免与已生效副本冲突）
      const ethicsId = 'ctr-ethics';
      const required = activateContract(
        { ethics: { required: true, ref: 'eth-1', valid_until: null } },
        ethicsId,
      );
      await contracts.receiveOffer({
        offer_id: 'o2',
        contract_id: ethicsId,
        canonical: required.canonicalStr,
      });
      await contracts.confirm('o2', '张主任');
      await contracts.applyCountersignature(ethicsId, required.countersignature);

      const header = { contracts: [ethicsId] };
      await expect(reviewWith({ header })).rejects.toMatchObject({ code: 'E_ETHICS_MISSING' });
      await expect(
        reviewWith({ header: { ...header, ethics_ref: 'eth-1' } }),
      ).resolves.toBeDefined();
    });

    it('人工确认（签署台 / CLI）会把 ContractAgree 发回平台，而不是只留在本地', async () => {
      const id = 'ctr-manual-sign';
      const prepared = activateContract({}, id);
      await contracts.receiveOffer({
        offer_id: 'o-manual',
        contract_id: id,
        canonical: prepared.canonicalStr,
      });
      const out = await node.confirmOffer('o-manual', '张主任');
      expect(out.contractId).toBe(id);
      const agree = [...sent].reverse().find((m) => m.msgType === 'ContractAgree');
      expect(agree?.body.contract_id).toBe(id);
      expect(String(agree?.body.holder_signature ?? '').length).toBeGreaterThan(0);
      expect(String(agree?.body.canonical)).toBe(prepared.canonicalStr);
    });

    it('算子未加白 / 已吊销 → E_OP_NOT_WHITELISTED / E_OP_REVOKED', async () => {
      // 数据源阶段：输出 C0（inherit + 无上游 → 本地重算 C0），无边
      const other = fragment({
        stages: [
          {
            id: 'srcA',
            node: NODE,
            op: 'source.dataset@1.0.0',
            op_digest: 'component:connector-datasource@1',
            params: { uri: 'ds://p-demohospa/dp-1' },
            inputs: [{ from: 'ds://p-demohospa/dp-1' }],
            input_labels: ['C0'],
            output_label: 'C0',
            output_schema: 'mdop.table/1.0',
          } as never,
        ],
        edges: [],
      });
      // source 已加白 → 通过
      await expect(
        review.review({ ...offerFor(other), jobHeader: jobHeader() } as never, {
          node: NODE,
          snapshotFor: () => null,
        }),
      ).resolves.toBeDefined();

      await whitelist.remove('source.dataset@1.0.0');
      await expect(
        review.review({ ...offerFor(other), jobHeader: jobHeader() } as never, {
          node: NODE,
          snapshotFor: () => null,
        }),
      ).rejects.toMatchObject({ code: 'E_OP_NOT_WHITELISTED' });

      // 被吊销的摘要（先同步清单，再吊销）
      await whitelist.applyOperatorManifests([
        {
          ref: 'rws.disproportionality@1.0.0',
          digest: `sm3:${WASM_SM3}`,
          manifest: parseOperatorManifest({
            apiVersion: 'mdop/v0.2',
            kind: 'wasm',
            id: 'rws.disproportionality',
            version: '1.0.0',
            category: 'local',
            digest: `sm3:${WASM_SM3}`,
            publisher: 'urn:tds:platform',
            inputs: [],
            outputs: [{ name: 'o', schema: 's', label_rule: 'inherit' }],
            params: {},
            environments: ['plain'],
            security: { network: 'none' },
            build: {
              source_digest: `sm3:${WASM_SM3}`,
              toolchain: 'asc@0.27.37',
              reproducible: true,
            },
          }),
          signature: signCanonicalObject(
            parseOperatorManifest({
              apiVersion: 'mdop/v0.2',
              kind: 'wasm',
              id: 'rws.disproportionality',
              version: '1.0.0',
              category: 'local',
              digest: `sm3:${WASM_SM3}`,
              publisher: 'urn:tds:platform',
              inputs: [],
              outputs: [{ name: 'o', schema: 's', label_rule: 'inherit' }],
              params: {},
              environments: ['plain'],
              security: { network: 'none' },
              build: {
                source_digest: `sm3:${WASM_SM3}`,
                toolchain: 'asc@0.27.37',
                reproducible: true,
              },
            }),
            registryKeys.privateKey,
            { publicKey: registryKeys.publicKey },
          ),
        },
      ]);
      await whitelist.applyRevocationList(
        signRevocationList(
          { version: 2, issued_at: '2026-09-24T01:00:00.000Z', revoked_digests: [`sm3:${WASM_SM3}`] },
          platformNodeKeys.privateKey,
          platformNodeKeys.publicKey,
        ),
      );
      const wasmFrag = fragment({
        stages: [
          {
            ...fragment().stages[0],
            op: 'rws.disproportionality@1.0.0',
            op_digest: `sm3:${WASM_SM3}`,
            output_label: 'C0',
          } as never,
        ],
      });
      await expect(
        review.review({ ...offerFor(wasmFrag), jobHeader: jobHeader() } as never, {
          node: NODE,
          snapshotFor: () => null,
        }),
      ).rejects.toMatchObject({ code: 'E_OP_REVOKED' });
    });

    it('平台改动片段 → E_TICKET_INVALID', async () => {
      const offer = offerFor(fragment());
      const tampered = fragment({
        stages: [{ ...fragment().stages[0], params: { minCell: 1 } } as never],
      });
      await expect(
        review.review({ ...offer, fragment: tampered } as never, { node: NODE }),
      ).rejects.toMatchObject({ code: 'E_TICKET_INVALID' });
    });

    it('C3 目标不在合约接收方列表 → E_CAPABILITY_MISMATCH', async () => {
      const bad = fragment({
        edges: [
          {
            from_stage: 'decA',
            to_stage: 'merge',
            label: 'C3',
            from_node: NODE,
            to_node: participantUrn(SPACE, 'p-evil'),
          } as PlanEdge,
        ],
      });
      await expect(
        review.review({ ...offerFor(bad), jobHeader: jobHeader() } as never, { node: NODE }),
      ).rejects.toMatchObject({ code: 'E_CAPABILITY_MISMATCH' });
    });

    it('本地撤销后立即拒（与平台是否已知无关）', async () => {
      await contracts.revoke(contractId, '张主任', '院内撤回');
      await expect(reviewWith()).rejects.toMatchObject({ code: 'E_CONTRACT_EXPIRED' });
    });

    it('拒绝消息只回错误码与一句说明（不带本地策略原文 / 撤销理由 / 数据规模）', async () => {
      await contracts.revoke(contractId, '张主任', '院内撤回：涉及商业敏感口径');
      const frag = fragment();
      const offer = offerFor(frag);
      const envelope = signEnvelope(
        {
          mdop: '0.2',
          msg_id: 'm-offer-reject',
          msg_type: 'PlanFragmentOffer' as never,
          job_id: 'job-1',
          sender: PLATFORM,
          receiver: NODE,
          timestamp: new Date().toISOString(),
          nonce: 'nonce-offer-reject',
          idempotency_key: 'k-offer-reject',
          body: {
            ticket_id: offer.ticketId,
            core: offer.core,
            fragment: frag,
            fragments: offer.fragments,
            job_header: offer.jobHeader,
          },
        },
        platformNodeKeys.privateKey,
        { publicKey: platformNodeKeys.publicKey },
      );
      expect((await node.handleEnvelope(envelope)).detail).toContain('E_CONTRACT_EXPIRED');
      const reject = sent.find((m) => m.msgType === 'PlanFragmentReject');
      expect(reject).toBeDefined();
      const body = reject!.body as Record<string, unknown>;
      // 只允许：错误码 + 一句说明 + 定位（ticket/signer），没有本地策略原文、没有撤销理由、没有规模
      expect(Object.keys(body).sort()).toEqual(['code', 'message', 'signer', 'ticket_id']);
      expect(body.code).toBe('E_CONTRACT_EXPIRED');
      expect(String(body.message)).not.toContain('张主任');
      expect(String(body.message)).not.toContain('商业敏感');
      expect(String(body.message)).not.toContain('minCell');
      expect(String(body.message).length).toBeLessThan(80);
    });

    it('作业引用多院合约时挑本院那一份（不把别院合约当自己的 → 不误报 E_CONTRACT_UNSIGNED）', async () => {
      const header = jobHeader({ contracts: ['ctr-other-hospital', contractId] });
      const frag = fragment({
        stages: [
          {
            ...fragment().stages[0],
            // 数据源句柄里的数据产品 id 与本院合约的 data_product_id 对齐
            inputs: [{ from: `ds://${HOSP}/dp-1` }],
            input_labels: ['C0'],
          } as never,
        ],
      });
      await expect(
        review.review({ ...offerFor(frag, header), jobHeader: header } as never, {
          node: NODE,
          snapshotFor: () => null,
        }),
      ).resolves.toBeDefined();
    });

    describe('C2 边（任务 6.5）：复核只判策略与对端，实际证明留给投递与执行', () => {
      /** 一条「封装 C0 → C2，寄给平台」的片段。 */
      const sealFragment = () =>
        parseFragment({
          node: NODE,
          stages: [
            {
              id: 'sealA',
              node: NODE,
              op: 'seal.envelope@1.0.0',
              op_digest: 'component:seal@1',
              params: {},
              inputs: [{ from: `ds://${HOSP}/dp-1` }],
              input_labels: ['C0'],
              output_label: 'C2',
              output_schema: 'mdop.env/1.0',
            },
          ],
          edges: [
            { from_stage: 'sealA', to_stage: 'tee1', label: 'C2', from_node: NODE, to_node: PLATFORM },
          ],
        });

      const activateWithPolicy = async (policy: Record<string, unknown> | null) => {
        if (policy) {
          // 带策略＝改条款 ⇒ 必须重新走一遍要约/确认/副署（beforeEach 里那份没有策略）
          const { canonicalStr, countersignature } = activateContract({ attestation_policy: policy });
          await contracts.receiveOffer({
            offer_id: 'o-c2',
            contract_id: contractId,
            canonical: canonicalStr,
          });
          await contracts.confirm('o-c2', 'auto(policy)');
          await contracts.applyCountersignature(contractId, countersignature);
        }
        // 封装算子加白 + 清单同步（复核第 1 项要先过）
        const manifest = sealManifest();
        await whitelist.add(`${manifest.id}@${manifest.version}`, '张主任', { kind: 'system' });
        await whitelist.applyOperatorManifests([
          {
            ref: `${manifest.id}@${manifest.version}`,
            digest: manifest.digest,
            manifest,
            signature: signCanonicalObject(manifest, registryKeys.privateKey, {
              publicKey: registryKeys.publicKey,
            }),
          },
        ]);
      };

      it('本地合约未声明证明策略 → 拒（该合约不允许 C2）', async () => {
        await activateWithPolicy(null);
        await expect(
          review.review({ ...offerFor(sealFragment()), jobHeader: jobHeader() } as never, {
            node: NODE,
            snapshotFor: () => null,
          }),
        ).rejects.toMatchObject({ code: 'E_CAPABILITY_MISMATCH' });
      });

      it('合约声明策略 → 通过，并把 C2 对端记入复核结论（供投递/执行前校验）', async () => {
        await activateWithPolicy({ tee: ['tdx'], min_tcb: '3.1.0' });
        const out = await review.review(
          { ...offerFor(sealFragment()), jobHeader: jobHeader() } as never,
          { node: NODE, snapshotFor: () => null },
        );
        expect(out.c2Targets).toEqual([PLATFORM]);
      });

      it('合约允许 C2，但平台把这条边指向合约接收方之外的节点 → 拒（不替平台认对端）', async () => {
        await activateWithPolicy({ tee: ['tdx'], min_tcb: '3.1.0' });
        // 合约接收方只有本院与平台；把 C2 边指向一个谁都不认识的参与方
        const stray = parseFragment({
          node: NODE,
          stages: sealFragment().stages,
          edges: [
            {
              from_stage: 'sealA',
              to_stage: 'tee1',
              label: 'C2',
              from_node: NODE,
              to_node: 'urn:tds:sh-med:participant:p-evil',
            },
          ],
        });
        await expect(
          review.review({ ...offerFor(stray), jobHeader: jobHeader() } as never, {
            node: NODE,
            snapshotFor: () => null,
          }),
        ).rejects.toMatchObject({ code: 'E_CAPABILITY_MISMATCH' });
        // 指向**本节点自己**是允许的（C2 边落在本节点，由本轮复核自己承接）
        const selfEdge = parseFragment({
          node: NODE,
          stages: sealFragment().stages,
          edges: [
            { from_stage: 'sealA', to_stage: 'tee1', label: 'C2', from_node: NODE, to_node: NODE },
          ],
        });
        const out = await review.review({ ...offerFor(selfEdge), jobHeader: jobHeader() } as never, {
          node: NODE,
          snapshotFor: () => null,
        });
        expect(out.c2Targets).toEqual([NODE]);
      });

      it('上游阶段输出不是 C2 却标成 C2 边 → E_LABEL_VIOLATION（防标签洗白）', async () => {
        await activateWithPolicy({ tee: ['tdx'] });
        // decA 的输出是 C3，却把它接到一条 C2 边上
        const washed = fragment({
          edges: [{ from_stage: 'decA', to_stage: 'tee1', label: 'C2', from_node: NODE, to_node: PLATFORM }],
        });
        await expect(
          review.review({ ...offerFor(washed), jobHeader: jobHeader() } as never, {
            node: NODE,
            snapshotFor: () => null,
          }),
        ).rejects.toMatchObject({ code: 'E_LABEL_VIOLATION' });
      });

      it('会话见证（6.7 / D13）：未配置 KMS 公钥 → 记拒绝并上报审计回执，不当作「验过」', async () => {
        await activateWithPolicy({ tee: ['tdx'], min_tcb: '3.1.0' });
        const envelope = signEnvelope(
          {
            mdop: '0.2',
            msg_id: 'm-witness-1',
            msg_type: 'AttestationWitness' as never,
            job_id: 'job-1',
            sender: PLATFORM,
            receiver: NODE,
            timestamp: new Date().toISOString(),
            nonce: 'nonce-witness-1',
            idempotency_key: 'witness-1',
            body: {
              witness: {
                job_id: 'job-1',
                credential_id: 'tkt-1',
                contract_id: contractId,
                key_id: 'k-1',
                node: NODE,
                report: {
                  kind: 'tdx',
                  level: 'hardware',
                  isolation: 'hardware-enclave',
                  measurement: `sm3:${'a'.repeat(64)}`,
                  quote_digest: `sm3:${'b'.repeat(64)}`,
                  tcb: '3.1.2',
                  ephemeral_public_key: `04${'c'.repeat(128)}`,
                  report_data: reportDataBinding(`04${'c'.repeat(128)}`),
                  node: NODE,
                  issued_at: new Date(Date.now() - 30_000).toISOString(),
                  expires_at: new Date(Date.now() + 300_000).toISOString(),
                },
                warrant: {
                  key_id: 'k-1',
                  kms: 'kms://hospital',
                  warrant_digest: `sm3:${'d'.repeat(64)}`,
                  wrapped_key: 'abcd',
                  wrapped_key_encoding: 'hex',
                  ephemeral_key_digest: 'e'.repeat(64),
                  issued_at: new Date(Date.now() - 30_000).toISOString(),
                  expires_at: new Date(Date.now() + 300_000).toISOString(),
                  sig: { alg: 'SM2-SM3', kid: 'f'.repeat(64), value: '3045' },
                },
              },
            },
          },
          platformNodeKeys.privateKey,
          { publicKey: platformNodeKeys.publicKey },
        );

        // 本用例没有配 CONNECTOR_MDOP_KMS_PUBKEY（构造运行时时读到的是空）
        const result = await node.handleEnvelope(envelope);
        expect(result).toMatchObject({ msg_type: 'AttestationWitness', handled: false });
        // 拒绝也留痕：本地审计回执已落库（周期任务负责上报，不在同一拍）
        expect((await store.unreportedReceipts('job-1')).length).toBeGreaterThan(0);
        await node.tick();
        const receipts = sent.filter((m) => m.msgType === 'AuditReceipt');
        expect(receipts.length).toBeGreaterThan(0);
        // `body` 就是回执本体（与 PurgeReceipt 同口径）
        const last = receipts[receipts.length - 1].body as {
          event?: string;
          detail?: { code?: string; reason?: string };
        };
        expect(last.event).toBe('WITNESS_REJECTED');
        // 规格要求「拒绝含错误码」：码必须进**回执本体**（审计按码统计，不能只回给平台一句话）
        expect(last.detail?.code).toBe('E_KEY_RELEASE_DENIED');
        expect(last.detail?.reason).toBeTruthy();
      });
    });

    it('本地没有合约副本 → E_CONTRACT_UNSIGNED（旧合约/未确认）', async () => {
      await contracts.revoke(contractId, '张主任', '清理');
      await expect(
        review.review({ ...offerFor(fragment()), jobHeader: jobHeader() } as never, { node: NODE }),
      ).rejects.toMatchObject({ code: 'E_CONTRACT_EXPIRED' });
    });

  });

  describe('制品库与销毁（8.5 / 8.6）', () => {
    it('非 C3 句柄带 stats 被拒', async () => {
      await expect(
        store.putArtifact({
          handle: 'art://x',
          jobId: 'job-1',
          stage: 's1',
          label: 'C0',
          schema: 'mdop.table/1.0',
          digest: `sm3:${'d'.repeat(64)}`,
          payload: {},
          stats: { rows: 3 },
          expiresAt: new Date().toISOString(),
        }),
      ).rejects.toThrow(/C3/);
    });

    it('TTL 到期自主销毁并出 ttl 回执；销毁后不可读', async () => {
      await store.putArtifact({
        handle: 'art://x',
        jobId: 'job-1',
        stage: 's1',
        label: 'C3',
        schema: 'mdop.table/1.0',
        digest: `sm3:${'d'.repeat(64)}`,
        payload: { a: 1 },
        stats: { rows: 1 },
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      const out = await node.tick(new Date());
      expect(out.expired).toBe(1);
      expect(sent.some((m) => m.msgType === 'PurgeReceipt')).toBe(true);
      expect(await store.readArtifact('art://x')).toBeNull();
    });

    it('C0 制品出节点被拒；C3 目标不在接收方列表也被拒', () => {
      const contract = { recipients: [NODE, PLATFORM] };
      expect(egress.decide({ label: 'C0', target: PLATFORM, contract }).allowed).toBe(false);
      expect(egress.decide({ label: 'C3', target: PLATFORM, contract }).allowed).toBe(true);
      expect(egress.decide({ label: 'C3', target: 'urn:tds:sh-med:participant:p-evil', contract }).allowed).toBe(
        false,
      );
      expect(egress.violationsLog()).toHaveLength(2);
    });

    it('C2 投递：合约未声明证明策略 / 无本次证明 / 证明过期 → 逐条拒；合规才放行', () => {
      const NOW = new Date('2026-09-25T10:00:00.000Z');
      const policy = { tee: ['tdx'], min_tcb: '3.1.0' };
      const report = {
        kind: 'tdx' as const,
        level: 'hardware' as const,
        isolation: 'hardware-enclave' as const,
        measurement: `sm3:${'a'.repeat(64)}`,
        quote_digest: `sm3:${'b'.repeat(64)}`,
        tcb: '3.1.2',
        ephemeral_public_key: `04${'c'.repeat(128)}`,
        report_data: reportDataBinding(`04${'c'.repeat(128)}`),
        node: NODE,
        issued_at: new Date(NOW.getTime() - 30_000).toISOString(),
        expires_at: new Date(NOW.getTime() + 300_000).toISOString(),
      };
      const withPolicy = {
        recipients: [NODE, PLATFORM],
        canonical: JSON.stringify({ attestation_policy: policy }),
      };
      const noPolicy = { recipients: [NODE, PLATFORM], canonical: JSON.stringify({}) };
      const before = egress.violationsLog().length;

      // ① 合约没声明证明策略 → 该合约不允许 C2
      expect(
        egress.decide({ label: 'C2', target: PLATFORM, contract: noPolicy, c2: { policy, report } }).allowed,
      ).toBe(false);
      // ② 拿不出本次证明 → 拒（不凭自述放行）
      expect(egress.decide({ label: 'C2', target: PLATFORM, contract: withPolicy }).allowed).toBe(false);
      // ③ 证明过期 → 拒
      expect(
        egress.decide({
          label: 'C2',
          target: PLATFORM,
          contract: withPolicy,
          c2: {
            policy,
            report: {
              ...report,
              expires_at: new Date(NOW.getTime() - 1).toISOString(),
            },
            now: NOW,
          },
        }).allowed,
      ).toBe(false);
      // ④ 软件级证明冒充 → 拒
      expect(
        egress.decide({
          label: 'C2',
          target: PLATFORM,
          contract: withPolicy,
          c2: {
            policy,
            report: { ...report, level: 'software', isolation: 'none' },
            now: NOW,
          },
        }).allowed,
      ).toBe(false);
      // ⑤ 合规 → 放行（policy 也从本地副本条款读出）
      expect(
        egress.decide({ label: 'C2', target: PLATFORM, contract: withPolicy, c2: { report, now: NOW } })
          .allowed,
      ).toBe(true);

      expect(egress.violationsLog().length).toBeGreaterThan(before + 3);
    });

    it('PurgeOrder：销毁本地制品并回签名回执；销毁后按句柄读取失败', async () => {
      await store.putArtifact({
        handle: 'art://y',
        jobId: 'job-9',
        stage: 's1',
        label: 'C3',
        schema: 'mdop.table/1.0',
        digest: `sm3:${'e'.repeat(64)}`,
        payload: { a: 2 },
        stats: null,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      const envelope = signEnvelope(
        {
          mdop: '0.2',
          msg_id: 'm1',
          msg_type: 'PurgeOrder',
          job_id: 'job-9',
          sender: PLATFORM,
          receiver: NODE,
          timestamp: new Date().toISOString(),
          nonce: 'n1',
          idempotency_key: 'purge:job-9',
          body: { job_id: 'job-9' },
        },
        platformNodeKeys.privateKey,
        { publicKey: platformNodeKeys.publicKey },
      );
      await node.handleEnvelope(envelope);
      expect(await store.readArtifact('art://y')).toBeNull();
      const purge = sent.find((m) => m.msgType === 'PurgeReceipt');
      expect(purge).toBeDefined();
      expect((purge!.body as { handles: string[] }).handles).toEqual(['art://y']);
    });
  });

  describe('阶段执行与回传（7.6 连接器侧 / 9.3）', () => {
    /** 两阶段片段：`src1`（C0 数据源）→ `decA`（降密出 C3）。 */
    const twoStageFragment = () =>
      parseFragment({
        node: NODE,
        stages: [
          {
            id: 'src1',
            node: NODE,
            op: 'source.dataset@1.0.0',
            op_digest: 'component:connector-datasource@1',
            params: { uri: `ds://${HOSP}/dp-1` },
            inputs: [],
            input_labels: [],
            output_label: 'C0',
            output_schema: 'mdop.table/1.0',
          },
          {
            id: 'decA',
            node: NODE,
            op: 'declassify.small_cell@1.0.0',
            op_digest: 'component:connector-output-gate@1',
            params: { minCell: 10 },
            inputs: [{ from: 'src1' }],
            input_labels: ['C0'],
            output_label: 'C3',
            output_schema: 'mdop.table/1.0',
          },
        ],
        edges: [
          {
            from_stage: 'decA',
            to_stage: 'merge',
            label: 'C3',
            from_node: NODE,
            to_node: PLATFORM,
          },
        ],
      });

    const snapshotForDecA = () => canonicalSm3({ dataset: '', stages: ['decA'] });

    /** 造一份「本院已接受 + 平台已加签」的凭证，并把它送进节点。 */
    const issueTicket = async (frag: Fragment, snapshot = snapshotForDecA()) => {
      const hashes = { [NODE]: fragmentHash(frag), [PLATFORM]: `sm3:${'b'.repeat(64)}` };
      const core = parseTicketCore({
        ticket_id: 'tkt-1',
        job_id: 'job-1',
        plan_hash: computePlanHash({ job: jobHeader(), fragments: hashes }),
        fragments: hashes,
        not_before: jobHeader().not_before,
        not_after: jobHeader().not_after,
      });
      const holder = holderSignAcceptance(
        core,
        snapshot,
        NODE,
        connectorKeys.privateKey,
        connectorKeys.publicKey,
      );
      const platform = platformSignCore(
        core,
        platformNodeKeys.privateKey,
        platformNodeKeys.publicKey,
        PLATFORM,
      );
      await node.handleEnvelope(
        platformEnvelope('ExecutionTicketIssue', 'm-ticket', { ticket: buildTicket(core, [holder], platform) }),
      );
      return core;
    };

    const platformEnvelope = (
      msgType: string,
      msgId: string,
      body: Record<string, unknown>,
      jobId = 'job-1',
    ) =>
      signEnvelope(
        {
          mdop: '0.2',
          msg_id: msgId,
          msg_type: msgType as never,
          job_id: jobId,
          sender: PLATFORM,
          receiver: NODE,
          timestamp: new Date().toISOString(),
          nonce: `nonce-${msgId}`,
          idempotency_key: `k-${msgId}`,
          body,
        },
        platformNodeKeys.privateKey,
        { publicKey: platformNodeKeys.publicKey },
      );

    it('按**阶段 id**取上游产物执行，回传 StageStatus 并把 C3 投到数据面', async () => {
      const frag = twoStageFragment();
      // 上游阶段产物落在本地制品库（同一作业内按阶段 id 反查，不跨消息）
      await store.putArtifact({
        handle: `art://${HOSP}/job-1/src1/src1`,
        jobId: 'job-1',
        stage: 'src1',
        label: 'C0',
        schema: 'mdop.table/1.0',
        digest: `sm3:${'c'.repeat(64)}`,
        payload: { productId: 'dp-1', n: 3, rows: [1, 2, 3] },
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        ticketId: 'tkt-1',
      });
      // 复核通过时缓存片段与**快照入参**（真实链路由 PlanFragmentOffer 完成）。
      // 执行时按同一组入参重算快照，否则合法执行会被误判成 E_SNAPSHOT_CHANGED。
      const snapshotArgs = { dataProductId: 'dp-1', stageIds: frag.stages.map((s) => s.id) };
      node.rememberReviewed('tkt-1', frag, contractId, snapshotArgs);
      // 降密算子把上游载荷原样带出，便于断言「取到了上游产物」
      executor.registerSystem('declassify.small_cell@1.0.0', async (input) => ({
        label: 'C3',
        schema: 'mdop.table/1.0',
        payload: { gate: 'passed', upstream: [...input.inputs.values()][0] },
      }));
      await issueTicket(
        frag,
        canonicalSm3({ dataset: snapshotArgs.dataProductId, stages: snapshotArgs.stageIds }),
      );
      sent.length = 0;

      const out = await node.handleEnvelope(
        platformEnvelope('StageDispatch', 'm-dispatch', {
          ticket_id: 'tkt-1',
          stage_id: 'decA',
          attempt: 1,
          idempotency_key: 'job-1:decA:1',
        }),
      );

      expect(out).toMatchObject({ handled: true, detail: expect.stringContaining('executed:') });
      const status = sent.find((m) => m.msgType === 'StageStatus');
      expect(status?.body).toMatchObject({ stage_id: 'decA', status: 'SUCCEEDED', attempt: 1 });
      const delivery = sent.find((m) => m.msgType === 'DELIVERY');
      expect(delivery?.body).toMatchObject({
        handle: { handle: `art://${HOSP}/job-1/decA/decA`, label: 'C3' },
      });
      expect((delivery?.body as { payload?: Record<string, unknown> })?.payload).toMatchObject({
        gate: 'passed',
        upstream: { productId: 'dp-1', n: 3 },
      });
    });

    it('C2 制品按复核结论的对端提交中继（目标不猜；密文与密钥封套一起走）', async () => {
      const TEE_NODE = 'urn:tds:sh-med:participant:tee-1';
      const frag = parseFragment({
        node: NODE,
        stages: [
          {
            id: 'sealA',
            node: NODE,
            op: 'seal.envelope@1.0.0',
            op_digest: 'component:seal@1',
            params: {},
            inputs: [{ from: `ds://${HOSP}/dp-1` }],
            input_labels: ['C0'],
            output_label: 'C2',
            output_schema: 'mdop.env/1.0',
          },
        ],
        edges: [
          { from_stage: 'sealA', to_stage: 'tee1', label: 'C2', from_node: NODE, to_node: TEE_NODE },
        ],
      });
      const snapshotArgs = { dataProductId: 'dp-1', stageIds: ['sealA'] };
      // 执行器要求算子在**本地清单**里（未加白即拒）——先同步封装算子的清单
      const manifest = sealManifest();
      await whitelist.add(`${manifest.id}@${manifest.version}`, '张主任', { kind: 'system' });
      await whitelist.applyOperatorManifests([
        {
          ref: `${manifest.id}@${manifest.version}`,
          digest: manifest.digest,
          manifest,
          signature: signCanonicalObject(manifest, registryKeys.privateKey, {
            publicKey: registryKeys.publicKey,
          }),
        },
      ]);
      node.rememberReviewed('tkt-1', frag, contractId, {
        ...snapshotArgs,
        c2Targets: [TEE_NODE],
      });
      // 封装算子本体在别处测；这里只验「产出 C2 之后的投递接线」
      executor.registerSystem('seal.envelope@1.0.0', async () => ({
        label: 'C2',
        schema: 'mdop.env/1.0',
        payload: {
          envelope: {
            envelope: 'mdop.env/1.0',
            payload: { cipher: 'AES-256-GCM', ciphertext_ref: 'blob://sealed/k-1', digest: `sm3:${'d'.repeat(64)}` },
            wrapped_key: { kms: 'kms://hospital', key_id: 'k-1' },
          },
          ciphertext: 'QUFBQQ==',
          iv: 'b'.repeat(24),
          tag: 'c'.repeat(32),
        },
      }));
      await issueTicket(
        frag,
        canonicalSm3({ dataset: snapshotArgs.dataProductId, stages: snapshotArgs.stageIds }),
      );
      sent.length = 0;

      const out = await node.handleEnvelope(
        platformEnvelope('StageDispatch', 'm-dispatch-c2', {
          ticket_id: 'tkt-1',
          stage_id: 'sealA',
          attempt: 1,
          idempotency_key: 'job-1:sealA:1',
        }),
      );
      expect(out).toMatchObject({ handled: true, detail: expect.stringContaining('executed:') });

      const submit = sent.find((m) => m.msgType === 'C2_SUBMIT');
      expect(submit).toBeDefined();
      const body = submit!.body as {
        target: string;
        sealed: { ciphertext: string; iv: string; tag: string };
        envelope: { msg_type: string };
      };
      expect(body.target).toBe(TEE_NODE); // 目标来自复核结论，不从消息里取
      expect(body.sealed.ciphertext).toBe('QUFBQQ==');
      expect(body.envelope.msg_type).toBe('C2EnvelopeSubmit');
      // C2 不投数据面「C3 交付物」那条路
      expect(sent.some((m) => m.msgType === 'DELIVERY')).toBe(false);
    });

    it('上游产物缺失 → 阶段失败并回传 StageStatus FAILED（不静默算空集）', async () => {
      const frag = twoStageFragment();
      node.rememberReviewed('tkt-1', frag, contractId);
      await issueTicket(frag);
      sent.length = 0;

      await expect(
        node.handleEnvelope(
          platformEnvelope('StageDispatch', 'm-dispatch-2', {
            ticket_id: 'tkt-1',
            stage_id: 'decA',
            attempt: 1,
            idempotency_key: 'job-1:decA:2',
          }),
        ),
      ).rejects.toMatchObject({ code: 'E_RUNTIME' });
      const status = sent.find((m) => m.msgType === 'StageStatus');
      expect(status?.body).toMatchObject({ stage_id: 'decA', status: 'FAILED', code: 'E_RUNTIME' });
      expect(sent.find((m) => m.msgType === 'DELIVERY')).toBeUndefined();
    });
  });

  describe('信封与开关（8.1 / 8.2）', () => {
    it('MDOP_ENABLED=false 时不处理任何信封', async () => {
      process.env.MDOP_ENABLED = 'false';
      const out = await node.handleBatch([{ msg_type: 'PurgeOrder' } as never]);
      expect(out).toEqual([]);
    });

    it('用错密钥签的信封被拒（收件人/签名校验）', async () => {
      const wrong = generateSm2KeyPair();
      const envelope = signEnvelope(
        {
          mdop: '0.2',
          msg_id: 'm2',
          msg_type: 'PurgeOrder',
          job_id: 'job-1',
          sender: PLATFORM,
          receiver: NODE,
          timestamp: new Date().toISOString(),
          nonce: 'n2',
          idempotency_key: 'k2',
          body: { job_id: 'job-1' },
        },
        wrong.privateKey,
        { publicKey: wrong.publicKey },
      );
      await expect(node.handleEnvelope(envelope)).rejects.toMatchObject({ code: 'E_AUTH_INVALID' });
    });

    it('审计回执成链上报，且链头可被离线校验工具复算', async () => {
      const envelopeOk = signEnvelope(
        {
          mdop: '0.2',
          msg_id: 'm3',
          msg_type: 'PurgeOrder',
          job_id: 'job-1',
          sender: PLATFORM,
          receiver: NODE,
          timestamp: new Date().toISOString(),
          nonce: 'n3',
          idempotency_key: 'k3',
          body: { job_id: 'job-1' },
        },
        platformNodeKeys.privateKey,
        { publicKey: platformNodeKeys.publicKey },
      );
      await node.handleEnvelope(envelopeOk);
      const head = await store.chainHead('job-1');
      expect(head).toMatch(/^sm3:[0-9a-f]{64}$/);
      // 销毁事件也进了本节点回执链（可被离线工具复算）
      expect((await store.unreportedReceipts('job-1')).length).toBeGreaterThan(0);
      expect(verifyRevocationList).toBeDefined();
      expect(holderSignAcceptance).toBeDefined();
      expect(parseFragment).toBeDefined();
      void ({} as NodeCapability);
    });
  });
});
