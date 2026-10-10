import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ConnectorAuthService } from "../../runtime/participant-identity/connector-auth.service";
import { ConnectorTokenGuard } from "./connector-token.guard";

function context(
  headers: Record<string, string>,
  body?: unknown,
  query?: Record<string, string>,
): { ctx: ExecutionContext; req: Record<string, unknown> } {
  const req: Record<string, unknown> = { headers, body, query };
  return {
    req,
    ctx: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
  };
}

describe("ConnectorTokenGuard — 缺省强制证书认证 (outbound-longpoll-agent-auth D5)", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function guard(verified = true, reason?: string) {
    const auth = {
      verifyRequest: jest.fn().mockResolvedValue({
        verified,
        participantId: verified ? "p-demohospa" : undefined,
        reason,
      }),
    } as unknown as ConnectorAuthService;
    return { guard: new ConnectorTokenGuard(auth), auth };
  }

  it("不带证书签名 → 拒绝(令牌降级缺省关闭)", async () => {
    const { guard: g } = guard();
    const { ctx } = context({ "x-connector-token": "dev-connector-token" });
    await expect(g.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("即使配置了令牌,未开启开发开关仍拒绝", async () => {
    process.env.CONNECTOR_PULL_TOKEN = "configured-token";
    const { guard: g } = guard();
    const { ctx } = context({ "x-connector-token": "configured-token" });
    await expect(g.canActivate(ctx)).rejects.toThrow(/强制模式/);
  });

  it("显式开启开关但未配置令牌值 → 拒绝(代码里没有缺省令牌)", async () => {
    process.env.CONNECTOR_TOKEN_AUTH_ALLOWED = "true";
    const { guard: g } = guard();
    const { ctx } = context({ "x-connector-token": "dev-connector-token" });
    await expect(g.canActivate(ctx)).rejects.toThrow(
      /未显式配置 CONNECTOR_PULL_TOKEN/,
    );
  });

  it("开关打开 + 显式配置 + 令牌正确 → 放行", async () => {
    process.env.CONNECTOR_TOKEN_AUTH_ALLOWED = "true";
    process.env.CONNECTOR_PULL_TOKEN = "explicit-token";
    const { guard: g } = guard();
    const { ctx, req } = context(
      {
        "x-connector-token": "explicit-token",
        "x-connector-participant": "p-demohospb",
      },
      undefined,
      { participantId: "p-demohospb" },
    );
    await expect(g.canActivate(ctx)).resolves.toBe(true);
    expect(req.connectorParticipantId).toBe("p-demohospb");
    expect(req.connectorCertFingerprint).toBeUndefined();
  });

  it("带证书头 → 走证书验签,并把请求体 SM3 交给验签(D5)", async () => {
    const { guard: g, auth } = guard();
    const body = { aggregate: { cohortSize: 5 } };
    const { ctx, req } = context(
      {
        "x-connector-cert-fingerprint": "SM2:ABC",
        "x-connector-timestamp": "1700000000000",
        "x-connector-signature": "sig",
      },
      body,
    );
    await expect(g.canActivate(ctx)).resolves.toBe(true);
    const arg = (auth.verifyRequest as jest.Mock).mock.calls[0][0];
    expect(arg.fingerprint).toBe("SM2:ABC");
    expect(arg.bodySm3).toMatch(/^[0-9a-f]{64}$/);
    expect(req.connectorParticipantId).toBe("p-demohospa");
    expect(req.connectorCertFingerprint).toBe("SM2:ABC");
  });

  it("GET(无请求体)时 bodySm3 为空串", async () => {
    const { guard: g, auth } = guard();
    const { ctx } = context({
      "x-connector-cert-fingerprint": "SM2:ABC",
      "x-connector-timestamp": "1700000000000",
      "x-connector-signature": "sig",
    });
    await g.canActivate(ctx);
    expect((auth.verifyRequest as jest.Mock).mock.calls[0][0].bodySm3).toBe("");
  });

  // 回归:Express body-parser 对无请求体的 GET 会置 req.body={}(而非 undefined),
  // 若据此哈希会得到 sm3("{}") 与连接器的 "" 不一致,导致长轮询领取任务恒 401。
  it("无体 GET 被 body-parser 置为 {} 时 bodySm3 仍为空串", async () => {
    const { guard: g, auth } = guard();
    const { ctx } = context(
      {
        "x-connector-cert-fingerprint": "SM2:ABC",
        "x-connector-timestamp": "1700000000000",
        "x-connector-signature": "sig",
      },
      {},
    );
    await g.canActivate(ctx);
    expect((auth.verifyRequest as jest.Mock).mock.calls[0][0].bodySm3).toBe("");
  });

  it("证书验签失败 → 401(带原因)", async () => {
    const { guard: g } = guard(false, "签名验证失败");
    const { ctx } = context({
      "x-connector-cert-fingerprint": "SM2:ABC",
      "x-connector-timestamp": "1700000000000",
      "x-connector-signature": "bad",
    });
    await expect(g.canActivate(ctx)).rejects.toThrow(/签名验证失败/);
  });
});
