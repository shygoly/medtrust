import { generateSm2KeyPair } from '@medtrust/mdop';
import { MDOP_OUTBOUND_TIMEOUT_MS, MdopOutboundClient, MdopOutboundHttpError } from './mdop-client';

/**
 * 连接器/节点 → 平台出站客户端的**总时限**（2026-10-07 真机事故回归）。
 *
 * 连接器与可信空间节点都是串行处置消息：一条出站请求挂住，后面的要约、派发、销毁全都排不上。
 * 这里钉的是「挂住的请求一定会在时限内被中止并抛出」——由调用点既有的失败路径接手重试。
 */
const KEYS = generateSm2KeyPair();
const neverSettles = <T>(): Promise<T> => new Promise<T>(() => undefined);

function client(fetchImpl: typeof fetch, timeoutMs = 40) {
  return new MdopOutboundClient({
    baseUrl: 'http://127.0.0.1:1/api/v1',
    participantId: 'p-demohospb',
    privateKey: KEYS.privateKey,
    timeoutMs,
    fetchImpl,
  });
}

const statusEnvelope = (c: MdopOutboundClient) =>
  c.buildEnvelope({
    msgType: 'StageStatus',
    jobId: 'job-1',
    receiver: 'urn:tds:sh-med:participant:platform',
    idempotencyKey: 'status:job-1:seal:1',
    body: { job_id: 'job-1', stage_id: 'seal', attempt: 1, status: 'SUCCEEDED' },
  });

describe('MDOP 出站客户端的总时限', () => {
  it('缺省时限 60 秒', () => {
    expect(MDOP_OUTBOUND_TIMEOUT_MS).toBe(60_000);
  });

  it('平台迟迟不回响应头 → 到点中止并抛出（控制面 / 数据面 / 中继三个出口同一口径）', async () => {
    const signals: AbortSignal[] = [];
    const impl = ((_url: string | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return neverSettles<Response>();
    }) as unknown as typeof fetch;
    const c = client(impl);
    // 签名在计时之外：整库并行时 SM2 会占掉数秒，不能算进出站时限。
    const envelopes = [statusEnvelope(c), statusEnvelope(c), statusEnvelope(c)];
    const started = Date.now();

    await expect(c.sendMessage(envelopes[0])).rejects.toThrow(/\/mdop\/messages 超时/);
    await expect(
      c.sendDelivery(envelopes[1], { handle: 'art://x', label: 'C3', digest: 'sm3:0' }),
    ).rejects.toThrow(/\/mdop\/deliveries 超时/);
    await expect(
      c.relayEnvelope({
        envelope: envelopes[2],
        sealed: { ciphertext: 'QUFB', iv: 'aXY=', tag: 'dGFn' },
        target: 'urn:tds:sh-med:participant:tee-node-a',
      }),
    ).rejects.toThrow(/\/mdop\/envelopes 超时/);

    expect(Date.now() - started).toBeLessThan(3_000);
    expect(signals).toHaveLength(3);
    expect(signals.every((s) => s.aborted)).toBe(true);
  }, 20_000);

  it('响应头已到、响应体滴流不完 → 同样中止（时限覆盖读响应体）', async () => {
    const impl = (async () =>
      ({ ok: true, status: 200, text: () => neverSettles<string>() }) as unknown as Response) as unknown as typeof fetch;
    const c = client(impl);
    await expect(c.sendMessage(statusEnvelope(c))).rejects.toThrow(/超时：40ms/);
  });

  it('正常应答不受影响：2xx 返回解析后的正文，非 2xx 抛出带状态码的错误', async () => {
    const ok = (async () =>
      ({ ok: true, status: 201, text: async () => '{"accepted":true}' }) as unknown as Response) as unknown as typeof fetch;
    const c = client(ok);
    await expect(c.sendMessage(statusEnvelope(c))).resolves.toEqual({ accepted: true });

    const bad = (async () =>
      ({ ok: false, status: 400, text: async () => '{"code":"E_RUNTIME"}' }) as unknown as Response) as unknown as typeof fetch;
    const c2 = client(bad);
    await expect(c2.sendMessage(statusEnvelope(c2))).rejects.toThrow('MDOP 出站失败 /mdop/messages: HTTP 400');
  });

  it('平台明确应答的非 2xx 带着状态码与协议错误码抛出（调用方据此区分「被拒」与「没送到」）', async () => {
    const respond = (status: number, text: string) =>
      (async () => ({ ok: false, status, text: async () => text }) as unknown as Response) as unknown as typeof fetch;

    const rejected = client(respond(400, '{"statusCode":400,"code":"E_KEY_RELEASE_DENIED","message":"释放凭据已过期"}'));
    const err = await rejected.sendMessage(statusEnvelope(rejected)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MdopOutboundHttpError);
    expect(err).toMatchObject({ path: '/mdop/messages', status: 400, platformCode: 'E_KEY_RELEASE_DENIED' });

    // 没有协议错误码的应答（普通 4xx/5xx、网关的 HTML 错页）只带状态码——不从正文里猜
    for (const [status, text] of [
      [403, '{"statusCode":403,"message":"发送方证书已吊销"}'],
      [502, '<html>Bad Gateway</html>'],
      [400, '{"code":"not-a-protocol-code"}'],
    ] as const) {
      const c = client(respond(status, text));
      const plain = (await c.sendMessage(statusEnvelope(c)).catch((e: unknown) => e)) as MdopOutboundHttpError;
      expect(plain).toBeInstanceOf(MdopOutboundHttpError);
      expect(plain.status).toBe(status);
      expect(plain.platformCode).toBeUndefined();
    }
  });
});
