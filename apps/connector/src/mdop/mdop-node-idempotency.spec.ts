import {
  buildTicket,
  canonicalSm3,
  canonicalize,
  computePlanHash,
  fragmentHash,
  generateSm2KeyPair,
  holderSignAcceptance,
  parseFragment,
  parseOperatorManifest,
  parseTicketCore,
  participantUrn,
  platformSignCore,
  signCanonicalObject,
  signEnvelope,
  signRevocationList,
  sm2Sign,
  type Envelope,
  type Fragment,
  type OperatorManifest,
} from '@medtrust/mdop';
import { MdopContractStore } from './contract-store';
import { parsePolicy } from './local-contract-policy';
import { MdopOutboundClient } from './mdop-client';
import { MdopEgressGuard } from './mdop-egress';
import { MdopStageExecutor } from './mdop-executor';
import { MdopLocalStore } from './mdop-local-store';
import { MdopNodeService } from './mdop-node.service';
import { MdopReviewService } from './mdop-review';
import { MdopOperatorWhitelistStore } from './operator-whitelist';

/**
 * 持有方连接器的**阶段级幂等**（2026-10-07 真机事故回归，作业 job-muxxbwia-21abafc5）。
 *
 * 事故形态：KMS 隧道中断约两分钟，`seal.envelope` 连续失败，平台按退避发了 4 个 attempt。
 * 发件箱是至少一次投递——4 份 `StageDispatch` 都在；连接器只按 `job:stage:attempt` 判幂等，
 * 隧道一恢复就把 4 个 attempt **各跑一遍**：封 4 次、4 把不同的密钥、中继 4 份不同的信封。
 *
 * 这里钉的是：
 *  ① 「执行过没有」是**阶段**的事实：同一张凭证下阶段成功过一次，后到的任何 attempt 都沿用那份产物；
 *  ② 产物送达（C2 中继 / C3 投递）失败 = 本 attempt 失败（可重试），重试只重投**同一份**；
 *  ③ 成功状态没送达不吞：平台重发指令时补报，不重算、不重投。
 */

const SPACE = 'sh-med';
const HOSP = 'p-cdc-demo';
const NODE = participantUrn(SPACE, HOSP);
const PLATFORM = participantUrn(SPACE, 'platform');
const TEE_NODE = participantUrn(SPACE, 'tee-node-a');
const CONTRACT = 'ctr-seal';
const JOB = 'job-1';
const TICKET = 'tkt-1';

function memRepo(pkField: string) {
  const rows: any[] = [];
  const matches = (r: any, where: any) => Object.entries(where ?? {}).every(([k, v]) => r[k] === v);
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
      for (let i = rows.length - 1; i >= 0; i -= 1) if (matches(rows[i], where)) rows.splice(i, 1);
      return { affected: 0 };
    },
  } as any;
}

describe('持有方阶段级幂等：已成功的阶段不随 attempt 重算（2026-10-07 事故回归）', () => {
  const connectorKeys = generateSm2KeyPair();
  const platformNodeKeys = generateSm2KeyPair();
  const registryKeys = generateSm2KeyPair();

  let executor: MdopStageExecutor;
  let store: MdopLocalStore;
  let node: MdopNodeService;
  let sent: Array<{ msgType: string; body: Record<string, any> }>;
  /** 出站替身的故障注入：返回要抛的错（或 undefined 表示放行）。 */
  let outboundFault: (kind: string, body: Record<string, any>) => Error | undefined;
  /** 封装算子被调用的次数（= 真封了几次）；每封一次换一把密钥，与真实算子一致。 */
  let seals: number;
  let kmsDown: boolean;
  let declassifies: number;

  const manifestOf = (
    id: string,
    category: string,
    component: string,
    outSchema: string,
    rule: string,
  ) =>
    parseOperatorManifest({
      apiVersion: 'mdop/v0.2',
      kind: 'system',
      id,
      version: '1.0.0',
      category,
      digest: `component:${component}@1`,
      publisher: 'urn:tds:platform',
      inputs: category === 'source' ? [] : [{ name: 'in', schema: 'mdop.table/1.0', accept_labels: ['C0'] }],
      outputs: [{ name: 'out', schema: outSchema, label_rule: rule }],
      params: {},
      environments: ['plain'],
      security: { network: 'none' },
      component: `${component}@1.0.0`,
    });

  const sealFragment = (): Fragment =>
    parseFragment({
      node: NODE,
      stages: [
        {
          id: 'seal',
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
      edges: [{ from_stage: 'seal', to_stage: 'scri', label: 'C2', from_node: NODE, to_node: TEE_NODE }],
    });

  const c3Fragment = (): Fragment =>
    parseFragment({
      node: NODE,
      stages: [
        {
          id: 'dec',
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
      edges: [{ from_stage: 'dec', to_stage: 'merge', label: 'C3', from_node: NODE, to_node: PLATFORM }],
    });

  const platformEnvelope = (msgType: string, msgId: string, body: Record<string, unknown>): Envelope =>
    signEnvelope(
      {
        mdop: '0.2',
        msg_id: msgId,
        msg_type: msgType as never,
        job_id: JOB,
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

  /** 平台为同一阶段发出的第 n 个 attempt 的指令（至少一次投递下它们会并存在发件箱里）。 */
  const dispatch = (stageId: string, attempt: number): Envelope =>
    platformEnvelope('StageDispatch', `m-${stageId}-${attempt}`, {
      ticket_id: TICKET,
      stage_id: stageId,
      attempt,
      idempotency_key: `${JOB}:${stageId}:${attempt}`,
    });

  /** 复核通过 + 凭证到位（真实链路由 PlanFragmentOffer / ExecutionTicketIssue 完成）。 */
  const ready = async (frag: Fragment, c2Targets: string[] = []) => {
    const header = {
      job_id: JOB,
      purpose: 'RWS.EFFECTIVENESS',
      applicant: { org: 'sponsor', project: 'aefi' },
      contracts: [CONTRACT],
      not_before: '2026-09-24T00:00:00.000Z',
      not_after: '2030-06-30T00:00:00.000Z',
    };
    const snapshotArgs = { dataProductId: 'dp-1', stageIds: frag.stages.map((s) => s.id) };
    node.rememberReviewed(TICKET, frag, CONTRACT, { ...snapshotArgs, c2Targets });
    const hashes = { [NODE]: fragmentHash(frag), [PLATFORM]: `sm3:${'b'.repeat(64)}` };
    const core = parseTicketCore({
      ticket_id: TICKET,
      job_id: JOB,
      plan_hash: computePlanHash({ job: header, fragments: hashes }),
      fragments: hashes,
      not_before: header.not_before,
      not_after: header.not_after,
    });
    const holder = holderSignAcceptance(
      core,
      canonicalSm3({ dataset: snapshotArgs.dataProductId, stages: snapshotArgs.stageIds }),
      NODE,
      connectorKeys.privateKey,
      connectorKeys.publicKey,
    );
    const platform = platformSignCore(core, platformNodeKeys.privateKey, platformNodeKeys.publicKey, PLATFORM);
    await node.handleEnvelope(
      platformEnvelope('ExecutionTicketIssue', 'm-ticket', { ticket: buildTicket(core, [holder], platform) }),
    );
    sent.length = 0;
  };

  const statuses = (status?: string) =>
    sent.filter((m) => m.msgType === 'StageStatus' && (!status || m.body.status === status));
  const relays = () => sent.filter((m) => m.msgType === 'C2_SUBMIT');
  const relayedKey = (m: { body: Record<string, any> }) =>
    m.body.envelope.body.data_envelope.wrapped_key.key_id as string;

  beforeEach(async () => {
    process.env.SPACE_ID = SPACE;
    process.env.CONNECTOR_PARTICIPANT_ID = HOSP;
    process.env.CONNECTOR_PLATFORM_NODE_PUBKEY = platformNodeKeys.publicKey;
    process.env.CONNECTOR_REGISTRY_PUBKEY = registryKeys.publicKey;
    process.env.MDOP_ENABLED = 'true';

    sent = [];
    seals = 0;
    declassifies = 0;
    kmsDown = false;
    outboundFault = () => undefined;

    const contracts = new MdopContractStore(memRepo('contractId'), memRepo('offerId'), {
      privateKey: connectorKeys.privateKey,
      policy: parsePolicy({ review: 'manual' }),
    });
    const whitelist = new MdopOperatorWhitelistStore(memRepo('digest'), memRepo('id'), {
      platformPublicKeyOverrides: {
        'platform-node': platformNodeKeys.publicKey,
        registry: registryKeys.publicKey,
      },
    });
    store = new MdopLocalStore(memRepo('nonce'), memRepo('key'), memRepo('handle'), memRepo('receiptId'));
    executor = new MdopStageExecutor();

    // 已生效的本地合约副本（接收方含平台：C3 投递的出节点守卫要查它）
    const canonical = canonicalize({
      apiVersion: 'mdop/v0.2',
      contract_id: CONTRACT,
      data_product_id: 'dp-1',
      provider: NODE,
      consumer: 'p-meddata',
      purpose: 'RWS.EFFECTIVENESS',
      retention: '阅后即焚',
      recipients: [
        { party: NODE, role: 'final', jurisdiction: 'CN' },
        { party: PLATFORM, role: 'merger', jurisdiction: 'CN' },
      ],
      allowed_ops: [`sm3:${'a'.repeat(64)}`],
      review: { mode: 'auto', deadline_hours: 72 },
      ethics: { required: false, ref: null, valid_until: null },
      provider_public_key_kid: 'k'.repeat(64),
      platform_public_key_kid: 'p'.repeat(64),
      pre_review_snapshot: null,
      publication: { minCell: 10 },
      valid_from: '2026-09-01T00:00:00.000Z',
      valid_until: '2030-12-31T00:00:00.000Z',
    });
    await contracts.receiveOffer({ offer_id: 'o1', contract_id: CONTRACT, canonical });
    await contracts.confirm('o1', 'auto(policy)');
    await contracts.applyCountersignature(
      CONTRACT,
      sm2Sign(canonical, platformNodeKeys.privateKey, { publicKey: platformNodeKeys.publicKey }),
    );

    const manifests: OperatorManifest[] = [
      manifestOf('seal.envelope', 'seal', 'seal', 'mdop.env/1.0', 'C2'),
      manifestOf('declassify.small_cell', 'declassify', 'connector-output-gate', 'mdop.table/1.0', 'C3'),
    ];
    for (const manifest of manifests)
      await whitelist.add(`${manifest.id}@${manifest.version}`, '张主任', { kind: 'system' });
    await whitelist.applyOperatorManifests(
      manifests.map((manifest) => ({
        ref: `${manifest.id}@${manifest.version}`,
        digest: manifest.digest,
        manifest,
        signature: signCanonicalObject(manifest, registryKeys.privateKey, { publicKey: registryKeys.publicKey }),
      })),
    );
    await whitelist.applyRevocationList(
      signRevocationList(
        { version: 1, issued_at: '2026-09-24T00:00:00.000Z', revoked_digests: [] },
        platformNodeKeys.privateKey,
        platformNodeKeys.publicKey,
      ),
    );

    // 封装算子替身：与真实算子同一个要害——**每封一次换一把密钥**；保管方不通就抛网络错
    executor.registerSystem('seal.envelope@1.0.0', async () => {
      if (kmsDown) throw new Error('fetch failed');
      seals += 1;
      const keyId = `k-seal-${seals}`;
      return {
        label: 'C2',
        schema: 'mdop.env/1.0',
        payload: {
          envelope: {
            envelope: 'mdop.env/1.0',
            payload: {
              cipher: 'AES-256-GCM',
              ciphertext_ref: `blob://sealed/${keyId}`,
              digest: `sm3:${'d'.repeat(64)}`,
            },
            wrapped_key: { kms: 'kms://pilot', key_id: keyId },
          },
          ciphertext: 'QUFBQQ==',
          iv: 'b'.repeat(24),
          tag: 'c'.repeat(32),
        },
      };
    });
    executor.registerSystem('declassify.small_cell@1.0.0', async () => {
      declassifies += 1;
      return { label: 'C3', schema: 'mdop.table/1.0', payload: { a: 12, b: 30, run: declassifies } };
    });

    const outbound = new MdopOutboundClient({
      baseUrl: 'http://127.0.0.1:1/api/v1',
      participantId: HOSP,
      privateKey: connectorKeys.privateKey,
    });
    const record = (kind: string, body: Record<string, any>) => {
      const fault = outboundFault(kind, body);
      if (fault) throw fault;
      sent.push({ msgType: kind, body });
      return { ok: true };
    };
    (outbound as unknown as { sendMessage: unknown }).sendMessage = async (envelope: any) =>
      record(envelope.msg_type, envelope.body);
    (outbound as unknown as { sendDelivery: unknown }).sendDelivery = async (envelope: any, handle: any) =>
      record('DELIVERY', { ...envelope.body, handle });
    (outbound as unknown as { relayEnvelope: unknown }).relayEnvelope = async (input: any) =>
      record('C2_SUBMIT', input);

    node = new MdopNodeService(
      contracts,
      whitelist,
      new MdopReviewService(contracts, whitelist),
      executor,
      new MdopEgressGuard(),
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

  it('事故原样：保管方恢复后，积压的 4 个 attempt 同批到达 → 只封一次、只中继一份', async () => {
    await ready(sealFragment(), [TEE_NODE]);

    // 保管方不通：平台按退避陆续发出 attempt 1..3，每一份都失败并如实上报（可重试）
    kmsDown = true;
    for (const attempt of [1, 2, 3])
      await expect(node.handleEnvelope(dispatch('seal', attempt))).rejects.toThrow('fetch failed');
    expect(statuses('FAILED').map((s) => s.body.attempt)).toEqual([1, 2, 3]);
    expect(seals).toBe(0);
    sent.length = 0;

    // 保管方恢复。发件箱是至少一次：旧 attempt 的指令还在，和新发的 attempt 4 同一批送到
    kmsDown = false;
    const results = [];
    for (const attempt of [1, 2, 3, 4]) results.push(await node.handleEnvelope(dispatch('seal', attempt)));

    expect(seals).toBe(1); // 事故里是 4
    expect(relays()).toHaveLength(1); // 事故里是 4 份不同的信封
    expect(relayedKey(relays()[0])).toBe('k-seal-1');
    expect(results.map((r) => r.detail?.split(':')[0])).toEqual(['executed', 'reused', 'reused', 'reused']);
    // 每个 attempt 都回报成功，且是**同一份**产物的摘要（平台按当前 attempt 采纳其中一条）
    const ok = statuses('SUCCEEDED');
    expect(ok.map((s) => s.body.attempt)).toEqual([1, 2, 3, 4]);
    expect(new Set(ok.map((s) => s.body.digest)).size).toBe(1);
    // 一个阶段只留一条成功回执（审计链上不会出现「封了四次」）
    const receipts = await store.unreportedReceipts(JOB);
    expect(receipts.filter((r) => r.event === 'STAGE_SUCCEEDED')).toHaveLength(1);
  });

  it('成功状态没送达不吞：消息不记为已处理；平台重发同一条指令时只补报状态，不重算、不重投', async () => {
    await ready(sealFragment(), [TEE_NODE]);
    // 事故里平台对这条成功状态回了 HTTP 400（阶段正处在退避等待中）
    outboundFault = (kind, body) =>
      kind === 'StageStatus' && body.status === 'SUCCEEDED'
        ? new Error('MDOP 出站失败 /mdop/messages: HTTP 400')
        : undefined;
    const envelope = dispatch('seal', 1);
    await expect(node.handleEnvelope(envelope)).rejects.toThrow(/HTTP 400/);
    expect(seals).toBe(1);
    expect(relays()).toHaveLength(1);
    expect(statuses('SUCCEEDED')).toHaveLength(0);

    // 平台没收到状态 → 指令还在发件箱里 → 下一轮长轮询原样重发
    outboundFault = () => undefined;
    const replay = await node.handleEnvelope(envelope);
    expect(replay).toMatchObject({ handled: true, detail: 'replayed:status-reported' });
    expect(seals).toBe(1);
    expect(relays()).toHaveLength(1);
    expect(statuses('SUCCEEDED').map((s) => s.body.attempt)).toEqual([1]);

    // 状态送达之后再重发：纯回放，不再发任何消息
    const before = sent.length;
    expect(await node.handleEnvelope(envelope)).toMatchObject({ handled: true });
    expect(sent).toHaveLength(before);
  });

  it('C2 信封中继失败 = 本 attempt 失败（可重试）；下一 attempt 重投**同一份**信封，不重封', async () => {
    await ready(sealFragment(), [TEE_NODE]);
    outboundFault = (kind) =>
      kind === 'C2_SUBMIT' ? new Error('MDOP 出站 /mdop/envelopes 超时：60000ms 内没有收完响应，已中止') : undefined;
    await expect(node.handleEnvelope(dispatch('seal', 1))).rejects.toThrow(/超时/);
    // 不再「告警一行、照报成功」：那样平台以为封存完成，节点却永远等不到信封
    expect(statuses('SUCCEEDED')).toHaveLength(0);
    expect(statuses('FAILED')[0].body).toMatchObject({ attempt: 1, code: 'E_PEER_UNREACHABLE' });
    expect(seals).toBe(1);

    outboundFault = () => undefined;
    const retried = await node.handleEnvelope(dispatch('seal', 2));
    expect(retried.detail).toMatch(/^reused:/);
    expect(seals).toBe(1);
    expect(relays().map(relayedKey)).toEqual(['k-seal-1']);
    expect(statuses('SUCCEEDED').map((s) => s.body.attempt)).toEqual([2]);

    // 已送达的信封不随后续 attempt 再投（平台那边目标阶段可能已经消费掉它）
    await node.handleEnvelope(dispatch('seal', 3));
    expect(relays()).toHaveLength(1);
  });

  it('C3 投递失败同理：本 attempt 失败，重试只重投同一份结果（降密不重算）', async () => {
    await ready(c3Fragment());
    outboundFault = (kind) => (kind === 'DELIVERY' ? new Error('fetch failed') : undefined);
    await expect(node.handleEnvelope(dispatch('dec', 1))).rejects.toThrow('fetch failed');
    expect(statuses('FAILED')[0].body).toMatchObject({ attempt: 1, code: 'E_PEER_UNREACHABLE' });
    expect(statuses('SUCCEEDED')).toHaveLength(0);

    outboundFault = () => undefined;
    await node.handleEnvelope(dispatch('dec', 2));
    expect(declassifies).toBe(1);
    const deliveries = sent.filter((m) => m.msgType === 'DELIVERY');
    expect(deliveries).toHaveLength(1);
    expect(statuses('SUCCEEDED')[0].body).toMatchObject({
      attempt: 2,
      digest: deliveries[0].body.handle.digest,
    });
  });

  it('别的凭证留下的同名制品不算「执行过」：换了凭证照常执行', async () => {
    await ready(c3Fragment());
    await store.putArtifact({
      handle: `art://${HOSP}/${JOB}/dec/dec`,
      jobId: JOB,
      stage: 'dec',
      label: 'C3',
      schema: 'mdop.table/1.0',
      digest: `sm3:${'e'.repeat(64)}`,
      payload: { stale: true },
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      ticketId: 'tkt-other',
    });
    const out = await node.handleEnvelope(dispatch('dec', 1));
    expect(out.detail).toMatch(/^executed:/);
    expect(declassifies).toBe(1);
  });
});
