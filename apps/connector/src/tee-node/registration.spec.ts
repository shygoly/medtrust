import { generateSm2KeyPair, publicKeyFromPrivateKey, sm2Verify, sm3Hex } from '@medtrust/mdop';
import { stableStringify } from '../domain/canonical-json';
import { heartbeatHeaders, registerNode, sendNodeHeartbeat } from './registration';

/**
 * 节点注册与心跳（任务 3.1）：与连接器同一套端点与认证，且**只提交公钥**、
 * 能力通告**由真跑一次证明得出**（软件提供者恒 `tee: null`）。
 */

const NODE_ID = 'tee-1';
const keys = generateSm2KeyPair();

function fetchStub(response: { ok: boolean; status: number; body?: unknown; text?: string }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: response.ok,
      status: response.status,
      text: async () => response.text ?? JSON.stringify(response.body ?? {}),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('节点注册与心跳（任务 3.1）', () => {
  it('注册只提交公钥，并把平台返回的证书指纹带回（响应里出现私钥字段即标记）', async () => {
    const { impl, calls } = fetchStub({
      ok: true,
      status: 201,
      body: { certificate: { fingerprint: 'SM2:FINGERPRINT' }, connectorId: NODE_ID },
    });
    const out = await registerNode({
      baseUrl: 'http://cp/api/v1',
      participantId: NODE_ID,
      publicKey: publicKeyFromPrivateKey(keys.privateKey),
      operatorToken: 'jwt',
      fetchImpl: impl,
    });
    expect(calls[0].url).toBe('http://cp/api/v1/connectors/register');
    const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({ connectorId: NODE_ID, participantId: NODE_ID });
    expect(sent.subjectPublicKey).toBe(publicKeyFromPrivateKey(keys.privateKey));
    // 私钥绝不上传
    expect(JSON.stringify(sent)).not.toContain(keys.privateKey);
    expect(out).toEqual({ fingerprint: 'SM2:FINGERPRINT', warnedAboutPrivateKey: false });

    const leaky = fetchStub({ ok: true, status: 201, body: { privateKey: 'deadbeef' } });
    const leaked = await registerNode({
      baseUrl: 'http://cp/api/v1',
      participantId: NODE_ID,
      publicKey: publicKeyFromPrivateKey(keys.privateKey),
      operatorToken: 'jwt',
      fetchImpl: leaky.impl,
    });
    expect(leaked.warnedAboutPrivateKey).toBe(true);
  });

  it('注册缺 operator 令牌 / 失败响应 → 明确报错', async () => {
    await expect(
      registerNode({
        baseUrl: 'http://cp/api/v1',
        participantId: NODE_ID,
        publicKey: publicKeyFromPrivateKey(keys.privateKey),
        operatorToken: '',
      }),
    ).rejects.toThrow(/operator 令牌/);
    const failed = fetchStub({ ok: false, status: 403, text: 'forbidden' });
    await expect(
      registerNode({
        baseUrl: 'http://cp/api/v1',
        participantId: NODE_ID,
        publicKey: publicKeyFromPrivateKey(keys.privateKey),
        operatorToken: 'jwt',
        fetchImpl: failed.impl,
      }),
    ).rejects.toThrow(/HTTP 403/);
  });

  it('心跳：证书签名头覆盖请求体（改一个字节即验不过），且带能力通告', async () => {
    const advertisement = { runtime: ['native'], system_ops: [], whitelist_digests: [], tee: null, protocols: [] };
    const { impl, calls } = fetchStub({ ok: true, status: 200, body: { ok: true } });
    await sendNodeHeartbeat({
      baseUrl: 'http://cp/api/v1',
      participantId: NODE_ID,
      certFingerprint: 'SM2:FINGERPRINT',
      privateKey: keys.privateKey,
      advertisement,
      now: 1_760_000_000_000,
      fetchImpl: impl,
    });
    expect(calls[0].url).toBe('http://cp/api/v1/connector/heartbeat');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-Connector-Cert-Fingerprint']).toBe('SM2:FINGERPRINT');
    expect(headers['X-Connector-Timestamp']).toBe('1760000000000');

    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body.mdop).toEqual(advertisement);
    // 签名内容 = ts:pid:bodySm3（与平台侧 verifyRequest 同规则）
    const payload = `1760000000000:${NODE_ID}:${sm3Hex(stableStringify(body))}`;
    expect(sm2Verify(payload, headers['X-Connector-Signature'], publicKeyFromPrivateKey(keys.privateKey))).toBe(
      true,
    );
    // 改一个字节 → 签名不再成立（覆盖请求体的意义）
    const tampered = { ...body, version: '9.9.9' };
    expect(
      sm2Verify(
        `1760000000000:${NODE_ID}:${sm3Hex(stableStringify(tampered))}`,
        headers['X-Connector-Signature'],
        publicKeyFromPrivateKey(keys.privateKey),
      ),
    ).toBe(false);
  });

  it('没有证书指纹 → 拒绝发心跳（不拿「认证通不过」去碰运气）', async () => {
    await expect(
      sendNodeHeartbeat({
        baseUrl: 'http://cp/api/v1',
        participantId: NODE_ID,
        certFingerprint: '',
        privateKey: keys.privateKey,
        advertisement: {},
      }),
    ).rejects.toThrow(/证书指纹/);
  });

  it('心跳请求头是纯函数，便于装配方复用（无副作用）', () => {
    const headers = heartbeatHeaders({
      participantId: NODE_ID,
      certFingerprint: 'SM2:FINGERPRINT',
      privateKey: keys.privateKey,
      body: { a: 1, b: [2, 3] },
      now: 1,
    });
    expect(Object.keys(headers).sort()).toEqual([
      'Content-Type',
      'X-Connector-Cert-Fingerprint',
      'X-Connector-Participant',
      'X-Connector-Signature',
      'X-Connector-Timestamp',
    ]);
  });
});
