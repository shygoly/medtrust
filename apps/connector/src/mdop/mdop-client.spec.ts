import { generateSm2KeyPair } from '@medtrust/mdop';
import { MDOP_OUTBOUND_TIMEOUT_MS, MdopOutboundClient } from './mdop-client';

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
    participantId: 'p-ruijin',
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
    const started = Date.now();

    await expect(c.sendMessage(statusEnvelope(c))).rejects.toThrow(/\/mdop\/messages 超时/);
    await expect(
      c.sendDelivery(statusEnvelope(c), { handle: 'art://x', label: 'C3', digest: 'sm3:0' }),
    ).rejects.toThrow(/\/mdop\/deliveries 超时/);
    await expect(
      c.relayEnvelope({
        envelope: statusEnvelope(c),
        sealed: { ciphertext: 'QUFB', iv: 'aXY=', tag: 'dGFn' },
        target: 'urn:tds:sh-med:participant:tee-node-a',
      }),
    ).rejects.toThrow(/\/mdop\/envelopes 超时/);

    expect(Date.now() - started).toBeLessThan(3_000);
    expect(signals).toHaveLength(3);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

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
});
