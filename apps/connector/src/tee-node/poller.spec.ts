import { signEnvelope, type Envelope, type UnsignedEnvelope } from '@medtrust/mdop';
import { generateSm2KeyPair } from '@medtrust/mdop';
import { dispatchNodeMessages, pollNodeMessages, type NodePollerDeps } from './poller';

/**
 * 节点长轮询派发（任务 3.14）。
 *
 * 要证明的是「节点只出站、但拉回来的东西不轻信」：签名/收件人/时间窗由部署配置里的平台公钥判，
 * 逐 `msg_id` 去重（平台是至少一次投递），并把属于本节点的五类入站消息（要约/凭证/C2 中继/阶段派发/销毁指令）交给处理器。
 */

const SPACE = 'sh-med';
const NODE_ID = 'tee-1';
const NODE = `urn:tds:${SPACE}:participant:${NODE_ID}`;
const PLATFORM = `urn:tds:${SPACE}:participant:platform`;
const NODE_KEYS = generateSm2KeyPair();
const PLATFORM_KEYS = generateSm2KeyPair();

const unsigned = (over: Partial<UnsignedEnvelope> = {}): UnsignedEnvelope => ({
  mdop: '0.2',
  msg_id: `msg-${Math.random().toString(36).slice(2)}`,
  msg_type: 'C2EnvelopeRelay',
  job_id: 'job-1',
  sender: PLATFORM,
  receiver: NODE,
  timestamp: new Date().toISOString(),
  nonce: `nonce-${Math.random().toString(36).slice(2)}`,
  idempotency_key: 'relay:k-1',
  body: { data_envelope: { envelope: 'mdop.env/1.0' }, sealed: { ciphertext: 'x', iv: 'y', tag: 'z' } },
  ...over,
});

const signedByPlatform = (over: Partial<UnsignedEnvelope> = {}): Envelope =>
  signEnvelope(unsigned(over), PLATFORM_KEYS.privateKey, { publicKey: PLATFORM_KEYS.publicKey });

function deps(over: Partial<NodePollerDeps> = {}): NodePollerDeps {
  return {
    baseUrl: 'http://127.0.0.1:1/api/v1',
    participantId: NODE_ID,
    privateKey: NODE_KEYS.privateKey,
    certFingerprint: 'SM2:NODE',
    platformPublicKey: PLATFORM_KEYS.publicKey,
    self: NODE,
    ...over,
  };
}

function fetchReturning(mdop: Envelope[]): {
  impl: typeof fetch;
  calls: Array<{ url: string; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return {
      ok: true,
      status: 200,
      json: async () => ({ mdop }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('节点长轮询派发（任务 3.14）', () => {
  it('带签名头拉批次：只把本节点的入站消息交出来，其余类型如实记为未处理', async () => {
    const relay = signedByPlatform();
    const other = signedByPlatform({ msg_type: 'RevocationSync' });
    // 五类入站消息都要交出来：要约/凭证/阶段派发/销毁指令缺一类，作业都会卡住
    const offer = signedByPlatform({ msg_type: 'PlanFragmentOffer' });
    const ticket = signedByPlatform({ msg_type: 'ExecutionTicketIssue' });
    const dispatch = signedByPlatform({ msg_type: 'StageDispatch' });
    const purge = signedByPlatform({ msg_type: 'PurgeOrder' });
    const { impl, calls } = fetchReturning([relay, offer, ticket, dispatch, purge, other]);
    const out = await pollNodeMessages(deps({ fetchImpl: impl }), { waitMs: 1000, now: 1_760_000_000_000 });

    expect(calls[0].url).toContain('/connector/tasks/pending?waitMs=1000');
    expect(calls[0].headers['X-Connector-Participant']).toBe(NODE_ID);
    expect(calls[0].headers['X-Connector-Cert-Fingerprint']).toBe('SM2:NODE');
    expect(calls[0].headers['X-Connector-Timestamp']).toBe('1760000000000');
    expect(calls[0].headers['X-Connector-Signature']).toMatch(/^[0-9a-f]{100,}$/i);

    expect(out.messages.map((r) => r.envelope.msg_type)).toEqual([
      'C2EnvelopeRelay',
      'PlanFragmentOffer',
      'ExecutionTicketIssue',
      'StageDispatch',
      'PurgeOrder',
    ]);
    expect(out.ignored).toEqual([{ msgId: other.msg_id, msgType: 'RevocationSync' }]);
    expect(out.rejected).toHaveLength(0);
  });

  it('不是平台签的信封 → 不处理、逐条留痕（不静默丢）', async () => {
    const stranger = generateSm2KeyPair();
    const forged = signEnvelope(unsigned(), stranger.privateKey, { publicKey: stranger.publicKey });
    const { impl } = fetchReturning([forged]);
    const out = await pollNodeMessages(deps({ fetchImpl: impl }));
    expect(out.messages).toHaveLength(0);
    expect(out.rejected[0].msgId).toBe(forged.msg_id);
    expect(out.rejected[0].reason).toMatch(/kid|签名|收件人|证明/);
  });

  it('收件人不是本节点 → 拒（平台下发批次里混了别人的消息也不接手）', async () => {
    const elsewhere = signedByPlatform({ receiver: `urn:tds:${SPACE}:participant:tee-9` });
    const { impl } = fetchReturning([elsewhere]);
    const out = await pollNodeMessages(deps({ fetchImpl: impl }));
    expect(out.messages).toHaveLength(0);
    expect(out.rejected).toHaveLength(1);
  });

  it('同一 msg_id 第二次出现 → 按重复跳过（平台是至少一次投递）', async () => {
    const relay = signedByPlatform();
    const processed = new Set<string>();
    const { impl } = fetchReturning([relay]);
    const first = await pollNodeMessages(deps({ fetchImpl: impl, processed }));
    const second = await pollNodeMessages(deps({ fetchImpl: impl, processed }));
    expect(first.messages).toHaveLength(1);
    expect(second.messages).toHaveLength(0);
    expect(second.duplicates).toBe(1);
  });

  it('缺平台公钥 / 缺证书指纹 → 直接拒（不拿「能不能验」去碰运气）', async () => {
    const { impl } = fetchReturning([]);
    await expect(pollNodeMessages(deps({ fetchImpl: impl, platformPublicKey: '' }))).rejects.toThrow(
      /未配置平台公钥/,
    );
    await expect(pollNodeMessages(deps({ fetchImpl: impl, certFingerprint: '' }))).rejects.toThrow(
      /证书指纹/,
    );
  });

  it('派发：一条失败不影响其余条目，失败原因逐条返回', async () => {
    const a = signedByPlatform({ msg_id: 'm-a' });
    const b = signedByPlatform({ msg_id: 'm-b' });
    const results = await dispatchNodeMessages(
      [
        { envelope: a, body: {} },
        { envelope: b, body: {} },
      ],
      async (relay) => {
        if (relay.envelope.msg_id === 'm-a') throw new Error('E_ENVELOPE_POLICY: 解不开');
        return 'ok';
      },
    );
    expect(results).toEqual([
      { msgId: 'm-a', ok: false, detail: 'E_ENVELOPE_POLICY: 解不开' },
      { msgId: 'm-b', ok: true },
    ]);
  });
});
