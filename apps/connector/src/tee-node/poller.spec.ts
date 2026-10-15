import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { signEnvelope, type Envelope, type UnsignedEnvelope } from '@medtrust/mdop';
import { generateSm2KeyPair } from '@medtrust/mdop';
import {
  POLL_RESPONSE_GRACE_MS,
  dispatchNodeMessages,
  pollNodeMessages,
  type NodePollerDeps,
} from './poller';

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

/**
 * 走真实传输的用例共用的三样东西，都是为了让它们在机器很忙时（全量并跑、编译缓存未热）也稳定：
 *  - 预热：先打一个立刻返回的请求，把连接建立与运行时初始化的耗时挡在被测调用之外；
 *  - 条件等待：等「对端看到连接断开」这类事实时轮询条件，不靠固定时长的 sleep；
 *  - 用例时限放宽：这些用例真的要花一两秒，不能卡在缺省的 5 秒上。
 */
const WARM_UP_PATH = '/__warm';
const REAL_TRANSPORT_TEST_MS = 30_000;

async function listenWarm(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await (await fetch(`http://127.0.0.1:${port}${WARM_UP_PATH}`)).text();
  return port;
}

async function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
}

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

  /**
   * 2026-10-07 真机事故回归：一次长轮询响应 5.2MB、链路约 1KB/分钟。响应头早就回来了，
   * 响应体一直在「滴」——运行时自带的空闲超时永远不触发，节点静默了好几分钟。
   */
  describe('长轮询总时限（滴流/卡死的响应必须被中止并重试）', () => {
    const neverSettles = <T>(): Promise<T> => new Promise<T>(() => undefined);

    it('响应头迟迟不来 → 到「等待上限 + 宽限」即中止（中止信号交给了 fetch）', async () => {
      let signal: AbortSignal | undefined;
      const impl = ((_url: string | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return neverSettles<Response>();
      }) as unknown as typeof fetch;
      // TD-11：这里原来断言「墙钟 <2s」，机器忙（全量并跑）时会假红。改成**假定时器**——
      // 时限语义由「推进到 等待上限+宽限 即中止」确定性地钉住，不依赖真实时间。
      jest.useFakeTimers();
      try {
        const pending = pollNodeMessages(
          deps({ fetchImpl: impl, responseGraceMs: 40 }),
          { waitMs: 10 },
        );
        const rejected = expect(pending).rejects.toThrow(/节点长轮询超时/);
        await jest.advanceTimersByTimeAsync(10 + 40 + 200);
        await rejected;
        expect(signal?.aborted).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('响应头已到、响应体滴流不完 → 同样中止（时限覆盖读响应体，不只是等响应头）', async () => {
      let signal: AbortSignal | undefined;
      const impl = (async (_url: string | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return { ok: true, status: 200, json: () => neverSettles<unknown>() } as unknown as Response;
      }) as unknown as typeof fetch;
      await expect(
        pollNodeMessages(deps({ fetchImpl: impl, responseGraceMs: 40 }), { waitMs: 0 }),
      ).rejects.toThrow(/节点长轮询超时：40ms/);
      expect(signal?.aborted).toBe(true);
    });

    it('中止之后下一轮照常拉取：被中止的那批消息没有被记成「已处理」', async () => {
      const relay = signedByPlatform();
      const processed = new Set<string>();
      let round = 0;
      const impl = (async () => {
        round += 1;
        return {
          ok: true,
          status: 200,
          json: () => (round === 1 ? neverSettles<unknown>() : Promise.resolve({ mdop: [relay] })),
        } as unknown as Response;
      }) as unknown as typeof fetch;
      const poll = () =>
        pollNodeMessages(deps({ fetchImpl: impl, processed, responseGraceMs: 40 }), { waitMs: 0 });
      await expect(poll()).rejects.toThrow(/超时/);
      expect(processed.size).toBe(0);
      const retried = await poll();
      expect(retried.messages.map((m) => m.envelope.msg_id)).toEqual([relay.msg_id]);
    });

    it('真实传输（本机 HTTP 服务 + 运行时自带 fetch）：响应体滴流不止 → 到点中止，连接被真正断开', async () => {
      // 事故原样：响应头立刻回来，响应体每隔一小会儿「滴」几个字节——永远不空闲、永远收不完
      let closedByClient = false;
      let drip: ReturnType<typeof setInterval> | undefined;
      const server = createServer((req, res) => {
        if (req.url === WARM_UP_PATH) return void res.end('ok');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"mdop":[');
        drip = setInterval(() => res.write(' '), 20);
        res.on('close', () => {
          closedByClient = true;
          if (drip) clearInterval(drip);
        });
      });
      const port = await listenWarm(server);
      try {
        const started = Date.now();
        // 被测的是**响应体**的进展判定：响应头那一段给足宽限，免得机器忙时先撞上响应头时限
        await expect(
          pollNodeMessages(
            deps({ baseUrl: `http://127.0.0.1:${port}/api/v1`, responseGraceMs: 8_000, bodyStallWindowMs: 150 }),
            { waitMs: 0 },
          ),
        ).rejects.toThrow(/节点长轮询超时：响应体 150ms 内只收到/);
        const elapsed = Date.now() - started;
        // 第一个窗口只要求「有字节」，第二个窗口才按下限判 → 至少两个窗口；远早于响应头宽限
        expect(elapsed).toBeGreaterThanOrEqual(290);
        // TD-11：上界式墙钟断言（原 `<8_000`）在机器忙时会假红，已去掉。
        // 「不会拖太久才中止」的时限语义由上面那条**假定时器**用例确定性钉住；
        // 这条真实传输用例只保证「确实中止了、且底层连接真的断开」（下面 closedByClient）。
        // 不只是放行调用方：底层连接也断了（否则每超时一次就漏一条挂着的连接）
        await until(() => closedByClient);
        expect(closedByClient).toBe(true);
      } finally {
        if (drip) clearInterval(drip);
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }, REAL_TRANSPORT_TEST_MS);

    it('真实传输：响应体慢但一直在传 → 不得被掐断（超过响应头宽限也要让它传完）', async () => {
      // 回归：上线当天 1.3MB 的批次经慢链路约 15KB/s，被「等待上限 + 60 秒」的总时限连续误杀。
      const relay = signedByPlatform();
      // 响应头宽限盖住出站签名：全量并跑时 SM2 会占掉数秒，1 秒宽限会在 fetch 发出前就被掐断。
      const graceMs = 12_000;
      const payload = Buffer.from(JSON.stringify({ mdop: [relay], padding: 'x'.repeat(1_400_000) }));
      const server = createServer((req, res) => {
        if (req.url === WARM_UP_PATH) return void res.end('ok');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        let offset = 0;
        const pump = setInterval(() => {
          res.write(payload.subarray(offset, offset + 2_000));
          offset += 2_000;
          if (offset >= payload.length) {
            clearInterval(pump);
            res.end();
          }
        }, 20);
        res.on('close', () => clearInterval(pump));
      });
      const port = await listenWarm(server);
      try {
        const started = Date.now();
        // 响应体约 14 秒才传完，长过响应头宽限。停滞窗口放到 8 秒：事件循环被别的套件堵住几秒时，
        // 仍算「一直在传」，不会被误判成滴流。
        const outcome = await pollNodeMessages(
          deps({
            baseUrl: `http://127.0.0.1:${port}/api/v1`,
            responseGraceMs: graceMs,
            bodyStallWindowMs: 8_000,
            bodyMinBytesPerWindow: 1_000,
          }),
          { waitMs: 0 },
        );
        expect(Date.now() - started).toBeGreaterThan(graceMs);
        expect(outcome.messages.map((m) => m.envelope.msg_id)).toEqual([relay.msg_id]);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }, 90_000);

    it('宽限缺省 60 秒：正常的长轮询（服务端挂满 25 秒再回）不会被误杀', async () => {
      expect(POLL_RESPONSE_GRACE_MS).toBe(60_000);
      // 签名在假定时器之外：全量并跑时 SM2 会超过 Jest 缺省的 5 秒。
      const relay = signedByPlatform();
      jest.useFakeTimers();
      try {
        const impl = ((_url: string | URL) =>
          new Promise<Response>((resolve) =>
            setTimeout(
              () => resolve({ ok: true, status: 200, json: async () => ({ mdop: [relay] }) } as unknown as Response),
              25_000,
            ),
          )) as unknown as typeof fetch;
        const pending = pollNodeMessages(deps({ fetchImpl: impl }), { waitMs: 25_000 });
        await jest.advanceTimersByTimeAsync(25_000);
        expect((await pending).messages).toHaveLength(1);
      } finally {
        jest.useRealTimers();
      }
    }, 20_000);
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
