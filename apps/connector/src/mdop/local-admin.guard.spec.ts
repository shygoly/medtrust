import { UnauthorizedException } from "@nestjs/common";
import { LocalAdminGuard } from "./local-admin.guard";

/**
 * 院内本地管理守卫（D-MDOP-4）：
 * - 没配令牌 = 一律拒（fail-closed），不回落默认值；
 * - 令牌必须精确匹配；
 * - 院内身份走 HTTP 头（ISO-8859-1），中文由页面 percent-encode，服务端解码后留痕。
 */
describe("LocalAdminGuard（院内本地管理）", () => {
  const guard = new LocalAdminGuard();
  const ctxFor = (headers: Record<string, string>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as never;

  const original = process.env.CONNECTOR_LOCAL_ADMIN_TOKEN;
  afterEach(() => {
    if (original === undefined) delete process.env.CONNECTOR_LOCAL_ADMIN_TOKEN;
    else process.env.CONNECTOR_LOCAL_ADMIN_TOKEN = original;
  });

  it("未配置令牌 → 401（fail-closed，不提供缺省令牌）", () => {
    delete process.env.CONNECTOR_LOCAL_ADMIN_TOKEN;
    expect(() => guard.canActivate(ctxFor({ "x-connector-admin-token": "x" }))).toThrow(
      /未配置 CONNECTOR_LOCAL_ADMIN_TOKEN/,
    );
  });

  it("令牌不匹配 → 401", () => {
    process.env.CONNECTOR_LOCAL_ADMIN_TOKEN = "expected-token";
    expect(() =>
      guard.canActivate(ctxFor({ "x-connector-admin-token": "wrong" })),
    ).toThrow(UnauthorizedException);
  });

  it("中文身份（percent-encoded）解码后留痕；不填身份回落 local-admin", () => {
    process.env.CONNECTOR_LOCAL_ADMIN_TOKEN = "expected-token";
    const req: any = {
      headers: {
        "x-connector-admin-token": "expected-token",
        "x-connector-admin-actor": encodeURIComponent("华山医院-合同管理员-张医生"),
      },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as never;
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.localAdminActor).toBe("华山医院-合同管理员-张医生");

    const req2: any = { headers: { "x-connector-admin-token": "expected-token" } };
    guard.canActivate({ switchToHttp: () => ({ getRequest: () => req2 }) } as never);
    expect(req2.localAdminActor).toBe("local-admin");
  });

  it("非法 percent 编码按原样留痕（不因编码问题挡住签署）", () => {
    process.env.CONNECTOR_LOCAL_ADMIN_TOKEN = "expected-token";
    const req: any = {
      headers: {
        "x-connector-admin-token": "expected-token",
        "x-connector-admin-actor": "%E4%B8", // 截断的编码
      },
    };
    guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as never);
    expect(req.localAdminActor).toBe("%E4%B8");
  });
});
