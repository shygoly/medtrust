import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { ConnectorAuthService } from "./connector-auth.service";

function mockRepo(rows: Record<string, unknown>) {
  return {
    findOne: jest.fn(
      async ({ where }: { where: { sm2Fingerprint: string } }) => {
        return rows[where.sm2Fingerprint] ?? null;
      },
    ),
  };
}

describe("ConnectorAuthService — 连接器 SM2 证书签名验证 (P1-4)", () => {
  it("缺少证书头时拒绝", async () => {
    const svc = new ConnectorAuthService(
      new GMCryptoService(),
      mockRepo({}) as any,
    );
    const r = await svc.verifyRequest({});
    expect(r.verified).toBe(false);
  });

  it("有效 SM2 签名返回 participantId", async () => {
    const gm = new GMCryptoService();
    const pair = gm.generateSM2KeyPair();
    const timestamp = Date.now().toString();
    const participantId = "p-demohospa";
    const signature = gm.sm2Sign(
      `${timestamp}:${participantId}`,
      pair.privateKey,
    );
    const cert = {
      sm2Fingerprint: "SM2:ABC",
      participantId,
      subjectPublicKey: pair.publicKey,
      validUntil: new Date(Date.now() + 86_400_000),
      revoked: false,
    };
    const svc = new ConnectorAuthService(
      gm,
      mockRepo({ "SM2:ABC": cert }) as any,
    );
    const r = await svc.verifyRequest({
      fingerprint: "SM2:ABC",
      timestamp,
      signature,
    });
    expect(r).toEqual({ verified: true, participantId });
  });

  it("带请求体时签名须覆盖请求体 SM3 (D5)", async () => {
    const gm = new GMCryptoService();
    const pair = gm.generateSM2KeyPair();
    const timestamp = Date.now().toString();
    const participantId = "p-demohospa";
    const bodySm3 = gm.sm3Hash('{"aggregate":{"cohortSize":5}}');
    const cert = {
      sm2Fingerprint: "SM2:BODY",
      participantId,
      subjectPublicKey: pair.publicKey,
      validUntil: new Date(Date.now() + 86_400_000),
      revoked: false,
    };
    const svc = new ConnectorAuthService(
      gm,
      mockRepo({ "SM2:BODY": cert }) as any,
    );

    // 签名覆盖请求体 → 通过
    const ok = await svc.verifyRequest({
      fingerprint: "SM2:BODY",
      timestamp,
      signature: gm.sm2Sign(
        `${timestamp}:${participantId}:${bodySm3}`,
        pair.privateKey,
      ),
      bodySm3,
    });
    expect(ok).toEqual({ verified: true, participantId });

    // 只签 ts:pid(旧口径)但带着请求体 → 拒绝(请求体未被签名覆盖)
    const legacy = await svc.verifyRequest({
      fingerprint: "SM2:BODY",
      timestamp,
      signature: gm.sm2Sign(`${timestamp}:${participantId}`, pair.privateKey),
      bodySm3,
    });
    expect(legacy.verified).toBe(false);

    // 请求体被改(SM3 变) → 原签名失效
    const tampered = await svc.verifyRequest({
      fingerprint: "SM2:BODY",
      timestamp,
      signature: gm.sm2Sign(
        `${timestamp}:${participantId}:${bodySm3}`,
        pair.privateKey,
      ),
      bodySm3: gm.sm3Hash('{"aggregate":{"cohortSize":6}}'),
    });
    expect(tampered.verified).toBe(false);
  });

  it("已吊销证书拒绝", async () => {
    const gm = new GMCryptoService();
    const pair = gm.generateSM2KeyPair();
    const timestamp = Date.now().toString();
    const cert = {
      sm2Fingerprint: "SM2:REVOKED",
      participantId: "p-demohospb",
      subjectPublicKey: pair.publicKey,
      validUntil: new Date(Date.now() + 86_400_000),
      revoked: true,
    };
    const svc = new ConnectorAuthService(
      gm,
      mockRepo({ "SM2:REVOKED": cert }) as any,
    );
    const r = await svc.verifyRequest({
      fingerprint: "SM2:REVOKED",
      timestamp,
      signature: gm.sm2Sign(`${timestamp}:p-demohospb`, pair.privateKey),
    });
    expect(r.verified).toBe(false);
    expect((r as { reason?: string }).reason).toContain("吊销");
  });
});
