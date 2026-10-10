import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  canonicalSm3,
  canonicalize,
  computePlanHash,
  fragmentHash,
  generateSm2KeyPair,
  holderSignAcceptance,
  parseFragment,
  parseTicketCore,
  participantUrn,
  publicKeyKid,
  signCanonicalObject,
  signEnvelope,
  signRevocationList,
  sm2Sign,
  verifyTicketForExecution,
  type Fragment,
  type TicketCore,
} from '@medtrust/mdop';
import { MdopContractStore } from './contract-store';
import { MdopOperatorWhitelistStore } from './operator-whitelist';
import { MdopEgressGuard } from './mdop-egress';
import { MdopLocalStore } from './mdop-local-store';
import { MdopNodeService } from './mdop-node.service';
import { MdopOutboundClient } from './mdop-client';
import { MdopReviewService } from './mdop-review';
import { MdopStageExecutor } from './mdop-executor';
import { parsePolicy } from './local-contract-policy';

/**
 * MDOP 一致性测试（openspec `mdop-kernel` §10 中连接器侧适用项）。
 * 每一条对应用户可见保证，逐项编号，作为本期验收证据。
 *
 *   10.1 信封印证与防重放（含重启后）· 10.2 片段被篡改即拒绝执行 ·
 *   10.3 复核/出口两处 C0 出节点负例 · 10.5 DP 预算一律拒 ·
 *   10.6 销毁后不可读 / TTL 自主销毁 · 10.7 离线工具检出断链 ·
 *   10.9 伪造本院接受签名 → 本院执行器拒绝
 */

const SPACE = 'sh-med';
const HOSP = 'p-demohospa';
const NODE = participantUrn(SPACE, HOSP);
const PLATFORM = participantUrn(SPACE, 'platform');

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

describe('MDOP 一致性测试（§10 连接器侧）', () => {
  const connectorKeys = generateSm2KeyPair();
  const platformKeys = generateSm2KeyPair();
  const registryKeys = generateSm2KeyPair();
  const attackerKeys = generateSm2KeyPair();

  let contracts: MdopContractStore;
  let whitelist: MdopOperatorWhitelistStore;
  let review: MdopReviewService;
  let egress: MdopEgressGuard;
  let store: MdopLocalStore;
  let node: MdopNodeService;
  let nonceRepo: ReturnType<typeof memRepo>;
  let sent: Array<{ msgType: string; body: Record<string, unknown> }>;

  const contractId = 'ctr-conf';
  const purpose = 'RWS.EFFECTIVENESS';

  const terms = (over: Record<string, unknown> = {}) =>
    canonicalize({
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
      allowed_ops: [],
      review: { mode: 'auto', deadline_hours: 72 },
      ethics: { required: false, ref: null, valid_until: null },
      provider_public_key_kid: 'k'.repeat(64),
      platform_public_key_kid: 'p'.repeat(64),
      pre_review_snapshot: null,
      publication: { minCell: 5 },
      valid_from: '2026-09-01T00:00:00.000Z',
      valid_until: '2027-09-01T00:00:00.000Z',
      ...over,
    });

  /** 一段「降密之后」的 C3 片段（有边界边指向平台）。 */
  const fragment = (over: Partial<Fragment> = {}): Fragment =>
    parseFragment({
      node: NODE,
      stages: [
        {
          id: 'decA',
          node: NODE,
          op: 'declassify.small_cell@1.0.0',
          op_digest: 'component:connector-output-gate@1',
          params: { minCell: 5 },
          inputs: [],
          input_labels: ['C0'],
          output_label: 'C3',
          output_schema: 'mdop.table/1.0',
        },
      ],
      edges: [
        { from_stage: 'decA', to_stage: 'merge', label: 'C3', from_node: NODE, to_node: PLATFORM },
      ],
      ...over,
    });

  const jobHeader = (over: Record<string, unknown> = {}) => ({
    job_id: 'job-1',
    purpose,
    applicant: { org: 'sponsor', project: 't2dm' },
    contracts: [contractId],
    not_before: '2026-09-24T00:00:00.000Z',
    not_after: '2026-10-24T00:00:00.000Z',
    ...over,
  });

  const core = (frag: Fragment, header = jobHeader(), ticketId = 'tkt-c'): TicketCore => {
    const hashes = { [NODE]: fragmentHash(frag), [PLATFORM]: `sm3:${'b'.repeat(64)}` };
    return parseTicketCore({
      ticket_id: ticketId,
      job_id: 'job-1',
      plan_hash: computePlanHash({ job: header, fragments: hashes }),
      fragments: hashes,
      not_before: header.not_before,
      not_after: header.not_after,
    });
  };

  const signedTicket = (frag: Fragment, snapshot: string, signWith = connectorKeys) => {
    const c = core(frag);
    const holder = holderSignAcceptance(c, snapshot, NODE, signWith.privateKey, signWith.publicKey);
    const platformSig = signCanonicalObject(c, platformKeys.privateKey, {
      publicKey: platformKeys.publicKey,
    }).value;
    return {
      core: c,
      ticket: {
        core: c,
        signatures: [
          holder,
          {
            signer: PLATFORM,
            role: 'platform' as const,
            sig: {
              alg: 'SM2-SM3',
              kid: publicKeyKid(platformKeys.publicKey),
              value: platformSig,
            },
          },
        ],
      },
    };
  };

  beforeEach(async () => {
    process.env.SPACE_ID = SPACE;
    process.env.CONNECTOR_PARTICIPANT_ID = HOSP;
    process.env.CONNECTOR_PLATFORM_NODE_PUBKEY = platformKeys.publicKey;
    process.env.CONNECTOR_REGISTRY_PUBKEY = registryKeys.publicKey;
    process.env.MDOP_ENABLED = 'true';
    sent = [];

    contracts = new MdopContractStore(memRepo('contractId'), memRepo('offerId'), {
      privateKey: connectorKeys.privateKey,
      policy: parsePolicy({ review: 'manual' }),
    });
    whitelist = new MdopOperatorWhitelistStore(memRepo('digest'), memRepo('id'), {
      platformPublicKeyOverrides: {
        'platform-node': platformKeys.publicKey,
        registry: registryKeys.publicKey,
      },
    });
    nonceRepo = memRepo('nonce');
    store = new MdopLocalStore(nonceRepo, memRepo('key'), memRepo('handle'), memRepo('receiptId'));
    review = new MdopReviewService(contracts, whitelist);
    egress = new MdopEgressGuard();

    const canonical = terms();
    await contracts.receiveOffer({ offer_id: 'o1', contract_id: contractId, canonical });
    await contracts.confirm('o1', '张主任');
    await contracts.applyCountersignature(
      contractId,
      sm2Sign(canonical, platformKeys.privateKey, { publicKey: platformKeys.publicKey }),
    );
    await whitelist.add('declassify.small_cell@1.0.0', '张主任', { kind: 'system' });
    await whitelist.applyOperatorManifests([
      {
        ref: 'declassify.small_cell@1.0.0',
        digest: 'component:connector-output-gate@1',
        manifest: {
          apiVersion: 'mdop/v0.2',
          kind: 'system',
          id: 'declassify.small_cell',
          version: '1.0.0',
          category: 'declassify',
          digest: 'component:connector-output-gate@1',
          publisher: 'urn:tds:platform',
          inputs: [{ name: 't', schema: 's', accept_labels: ['C0'] }],
          outputs: [{ name: 't', schema: 's', label_rule: 'C3' }],
          params: {},
          environments: ['plain'],
          security: { network: 'none' },
          component: 'connector-output-gate@1.0.0',
        },
        signature: signCanonicalObject(
          {
            apiVersion: 'mdop/v0.2',
            kind: 'system',
            id: 'declassify.small_cell',
            version: '1.0.0',
            category: 'declassify',
            digest: 'component:connector-output-gate@1',
            publisher: 'urn:tds:platform',
            inputs: [{ name: 't', schema: 's', accept_labels: ['C0'] }],
            outputs: [{ name: 't', schema: 's', label_rule: 'C3' }],
            params: {},
            environments: ['plain'],
            security: { network: 'none' },
            component: 'connector-output-gate@1.0.0',
          },
          registryKeys.privateKey,
          { publicKey: registryKeys.publicKey },
        ),
      },
    ]);
    await whitelist.applyRevocationList(
      signRevocationList(
        { version: 1, issued_at: '2026-09-24T00:00:00.000Z', revoked_digests: [] },
        platformKeys.privateKey,
        platformKeys.publicKey,
      ),
    );

    const executor = new MdopStageExecutor();
    executor.registerSystem('declassify.small_cell@1.0.0', async () => ({
      label: 'C3',
      schema: 'mdop.table/1.0',
      payload: { a: 10, b: 20, c: 5, d: 30 },
    }));
    const outbound = new MdopOutboundClient({
      baseUrl: 'http://127.0.0.1:1/api/v1',
      participantId: HOSP,
      privateKey: connectorKeys.privateKey,
    });
    (outbound as unknown as { sendMessage: unknown }).sendMessage = async (envelope: any) => {
      sent.push({ msgType: envelope.msg_type, body: envelope.body });
      return { ok: true };
    };
    node = new MdopNodeService(contracts, whitelist, review, executor, egress, outbound, store, {
      privateKey: connectorKeys.privateKey,
      participantId: HOSP,
    });
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

  const platformEnvelope = (over: Record<string, unknown> = {}) =>
    signEnvelope(
      {
        mdop: '0.2',
        msg_id: `m-${Math.random().toString(36).slice(2)}`,
        msg_type: 'PurgeOrder',
        job_id: 'job-1',
        sender: PLATFORM,
        receiver: NODE,
        timestamp: new Date().toISOString(),
        nonce: `n-${Math.random().toString(36).slice(2)}`,
        idempotency_key: 'k',
        body: { job_id: 'job-1' },
        ...over,
      } as never,
      platformKeys.privateKey,
      { publicKey: platformKeys.publicKey },
    );

  describe('10.1 信封印证与防重放', () => {
    it('篡改 body → E_AUTH_INVALID', async () => {
      const envelope = platformEnvelope();
      const tampered = { ...envelope, body: { job_id: 'job-evil' } };
      await expect(node.handleEnvelope(tampered)).rejects.toMatchObject({ code: 'E_AUTH_INVALID' });
    });

    it('同一条消息重复到达 → 按 msg_id 去重、返回原结果（不重放副作用）', async () => {
      const envelope = platformEnvelope();
      const first = await node.handleEnvelope(envelope);
      const second = await node.handleEnvelope(envelope);
      expect(second).toEqual(first); // 至少一次投递：同 msg_id 返回与首次相同的结果
    });

    it('换 msg_id 复用已见过的 nonce → E_REPLAY（重启后仍拦得住）', async () => {
      // 真正的重放攻击形态：攻击者把见过的 nonce 塞进一封**新的**消息（新 msg_id）里。
      const original = platformEnvelope();
      await node.handleEnvelope(original);
      // 攻击者**无法**改 msg_id 而不破坏签名（改了就是 E_AUTH_INVALID），所以真正能触发
      // nonce 判据的是「发送方自己用同一 nonce 签了两封不同的有效消息」——下面这封就是。
      const replay = platformEnvelope({
        msg_id: 'msg-attacker',
        nonce: original.nonce,
        idempotency_key: 'k-attacker',
      });
      await expect(node.handleEnvelope(replay)).rejects.toMatchObject({ code: 'E_REPLAY' });

      // 「重启」= 新 store 实例读同一份落盘 nonce 数据（启动时会 hydrate）
      const restarted = new MdopLocalStore(nonceRepo, memRepo('key'), memRepo('handle'), memRepo('receiptId'));
      await restarted.hydrateNonces();
      const outbound = new MdopOutboundClient({
        baseUrl: 'http://127.0.0.1:1/api/v1',
        participantId: HOSP,
        privateKey: connectorKeys.privateKey,
      });
      (outbound as unknown as { sendMessage: unknown }).sendMessage = async () => ({ ok: true });
      const restartedNode = new MdopNodeService(
        contracts,
        whitelist,
        review,
        new MdopStageExecutor(),
        egress,
        outbound,
        restarted,
        { privateKey: connectorKeys.privateKey, participantId: HOSP },
      );
      const replay2 = platformEnvelope({
        msg_id: 'msg-attacker-2',
        nonce: original.nonce,
        idempotency_key: 'k-attacker-2',
      });
      await expect(restartedNode.handleEnvelope(replay2)).rejects.toMatchObject({
        code: 'E_REPLAY',
      });
    });

    it('时间偏差超窗 → E_AUTH_INVALID；收件人不是自己 → 拒', async () => {
      await expect(
        node.handleEnvelope(platformEnvelope({ timestamp: new Date(Date.now() - 10 * 60_000).toISOString() })),
      ).rejects.toMatchObject({ code: 'E_AUTH_INVALID' });
      await expect(
        node.handleEnvelope(platformEnvelope({ receiver: participantUrn(SPACE, 'p-demohospb') })),
      ).rejects.toMatchObject({ code: 'E_AUTH_INVALID' });
    });

    it('非平台节点密钥签的信封 → E_AUTH_INVALID', async () => {
      const envelope = signEnvelope(
        {
          mdop: '0.2',
          msg_id: 'm-x',
          msg_type: 'PurgeOrder',
          job_id: 'job-1',
          sender: PLATFORM,
          receiver: NODE,
          timestamp: new Date().toISOString(),
          nonce: 'n-x',
          idempotency_key: 'k',
          body: { job_id: 'job-1' },
        },
        attackerKeys.privateKey,
        { publicKey: attackerKeys.publicKey },
      );
      await expect(node.handleEnvelope(envelope)).rejects.toMatchObject({ code: 'E_AUTH_INVALID' });
    });
  });

  describe('10.2 片段被篡改 → 执行器拒绝执行', () => {
    it('凭证里的片段哈希与待执行片段不一致 → E_TICKET_INVALID', () => {
      const frag = fragment();
      const snapshot = `sm3:${'1'.repeat(64)}`;
      const { ticket } = signedTicket(frag, snapshot);
      const tampered = fragment({
        stages: [{ ...frag.stages[0], params: { minCell: 1 } } as never],
      });
      expect(() =>
        verifyTicketForExecution({
          ticket: ticket as never,
          node: NODE,
          fragment: tampered,
          nodePublicKey: connectorKeys.publicKey,
          platformPublicKey: platformKeys.publicKey,
          platformParty: PLATFORM,
          now: new Date('2026-09-25T00:00:00.000Z'),
          recomputedSnapshot: snapshot,
        }),
      ).toThrow(expect.objectContaining({ code: 'E_TICKET_INVALID' }));
    });

    it('执行时数据快照变了 → E_SNAPSHOT_CHANGED', () => {
      const frag = fragment();
      const { ticket } = signedTicket(frag, `sm3:${'1'.repeat(64)}`);
      expect(() =>
        verifyTicketForExecution({
          ticket: ticket as never,
          node: NODE,
          fragment: frag,
          nodePublicKey: connectorKeys.publicKey,
          platformPublicKey: platformKeys.publicKey,
          platformParty: PLATFORM,
          now: new Date('2026-09-25T00:00:00.000Z'),
          recomputedSnapshot: `sm3:${'2'.repeat(64)}`,
        }),
      ).toThrow(expect.objectContaining({ code: 'E_SNAPSHOT_CHANGED' }));
    });
  });

  describe('10.3 C0 制品发往外部节点被拒', () => {
    it('复核：C0 边界边 → E_LABEL_VIOLATION', async () => {
      const c0Fragment = fragment({
        stages: [
          {
            id: 'srcA',
            node: NODE,
            op: 'declassify.small_cell@1.0.0',
            op_digest: 'component:connector-output-gate@1',
            params: {},
            inputs: [],
            input_labels: [],
            output_label: 'C0',
            output_schema: 'mdop.table/1.0',
          } as never,
        ],
        edges: [
          { from_stage: 'srcA', to_stage: 'merge', label: 'C0', from_node: NODE, to_node: PLATFORM },
        ],
      });
      await expect(
        review.review(
          {
            ticketId: 'tkt-c',
            core: core(c0Fragment),
            jobHeader: jobHeader(),
            fragment: c0Fragment,
            fragments: { [NODE]: fragmentHash(c0Fragment), [PLATFORM]: `sm3:${'b'.repeat(64)}` },
          },
          { node: NODE },
        ),
      ).rejects.toMatchObject({ code: 'E_LABEL_VIOLATION' });
    });

    it('出口守卫：C0 经数据面投递 → 拒绝并留痕', () => {
      const contract = { recipients: [NODE, PLATFORM] };
      expect(egress.decide({ label: 'C0', target: PLATFORM, contract })).toMatchObject({
        allowed: false,
      });
      expect(egress.violationsLog().length).toBeGreaterThan(0);
    });
  });

  describe('10.5 申请 DP 预算被拒', () => {
    it('ε>0 一律 E_BUDGET_EXCEEDED（本期无预算账本，fail-closed）', async () => {
      const frag = fragment();
      await expect(
        review.review(
          {
            ticketId: 'tkt-c',
            core: core(frag),
            jobHeader: jobHeader({ dp_budget: 1 }),
            fragment: frag,
            fragments: { [NODE]: fragmentHash(frag), [PLATFORM]: `sm3:${'b'.repeat(64)}` },
          },
          { node: NODE },
        ),
      ).rejects.toMatchObject({ code: 'E_BUDGET_EXCEEDED' });
    });
  });

  describe('10.6 销毁后不可读 / TTL 自主销毁', () => {
    it('PurgeOrder 之后按句柄读取失败，并回签名销毁回执', async () => {
      await store.putArtifact({
        handle: 'art://p-demohospa/job-1/decA/table',
        jobId: 'job-1',
        stage: 'decA',
        label: 'C3',
        schema: 'mdop.table/1.0',
        digest: `sm3:${'c'.repeat(64)}`,
        payload: { a: 1 },
        stats: null,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      await node.handleEnvelope(platformEnvelope());
      expect(await store.readArtifact('art://p-demohospa/job-1/decA/table')).toBeNull();
      expect(sent.some((m) => m.msgType === 'PurgeReceipt')).toBe(true);
    });

    it('TTL 到期自主销毁并出 ttl 回执', async () => {
      await store.putArtifact({
        handle: 'art://p-demohospa/job-2/decA/table',
        jobId: 'job-2',
        stage: 'decA',
        label: 'C3',
        schema: 'mdop.table/1.0',
        digest: `sm3:${'d'.repeat(64)}`,
        payload: { a: 2 },
        stats: null,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      const out = await node.tick();
      expect(out.expired).toBe(1);
      expect(await store.readArtifact('art://p-demohospa/job-2/decA/table')).toBeNull();
    });
  });

  describe('10.7 离线工具检出回执链断链', () => {
    it('verify-receipt-chain.mjs：正常链通过、删一条即报断链', async () => {
      // 造两条成链的回执（第二条 prev 指向第一条）
      const make = (id: string, prev: string | null) => ({
        receipt_id: id,
        job_id: 'job-1',
        stage: 'decA',
        event: 'STAGE_SUCCEEDED',
        input_digests: [],
        op_digest: 'component:x@1',
        output_digest: canonicalSm3({ n: 1 }),
        label: 'C3',
        prev_receipt_hash: prev,
        signer: NODE,
        at: new Date().toISOString(),
        sig: { alg: 'SM2-SM3', kid: 'a'.repeat(64), value: '00ff' },
      });
      const first = make('r1', null);
      const second = make('r2', canonicalSm3(first));
      const dir = mkdtempSync(join(tmpdir(), 'mdop-receipts-'));
      const script = resolve(__dirname, '../../scripts/verify-receipt-chain.mjs');

      const okFile = join(dir, 'ok.json');
      writeFileSync(okFile, JSON.stringify({ receipts: [first, second] }));
      const ok = execFileSync(process.execPath, [script, '--receipts', okFile], {
        encoding: 'utf8',
        cwd: resolve(__dirname, '../..'),
      });
      expect(ok).toMatch(/链连续/);

      const brokenFile = join(dir, 'broken.json');
      writeFileSync(brokenFile, JSON.stringify({ receipts: [second] }));
      let failed = false;
      try {
        execFileSync(process.execPath, [script, '--receipts', brokenFile], {
          encoding: 'utf8',
          cwd: resolve(__dirname, '../..'),
        });
      } catch (err) {
        failed = true;
        expect((err as { stdout?: string }).stdout ?? '').toMatch(/断链位置/);
      }
      expect(failed).toBe(true);
    });
  });

  describe('10.9 伪造本院接受签名 → 本院执行器拒绝', () => {
    it('平台用自己的密钥冒充本院签接受 → E_TICKET_INVALID', () => {
      const frag = fragment();
      const snapshot = `sm3:${'1'.repeat(64)}`;
      const { ticket } = signedTicket(frag, snapshot, platformKeys); // 用平台密钥冒充本院
      expect(() =>
        verifyTicketForExecution({
          ticket: ticket as never,
          node: NODE,
          fragment: frag,
          nodePublicKey: connectorKeys.publicKey,
          platformPublicKey: platformKeys.publicKey,
          platformParty: PLATFORM,
          now: new Date('2026-09-25T00:00:00.000Z'),
          recomputedSnapshot: snapshot,
        }),
      ).toThrow(expect.objectContaining({ code: 'E_TICKET_INVALID' }));
    });
  });
});
