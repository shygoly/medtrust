import { firstValueFrom, of } from "rxjs";
import { MaskingInterceptor } from "./masking.interceptor";

/**
 * 脱敏拦截器不能把「值对象」当容器展开。
 *
 * 线上回归：`GET /contracts` 返回的普通对象里 `createdAt` 是 Date，
 * 拦截器 `{...date}` 得到 `{}`，前端按时间排序时 `.localeCompare` 直接抛
 * `TypeError: e(...).localeCompare is not a function`，整页白屏。
 */
describe("MaskingInterceptor（全局脱敏）", () => {
  const context = (role = "consumer") =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    }) as never;

  const run = async (payload: unknown, maskingType?: string) => {
    const reflector = { get: () => maskingType } as never;
    const next = { handle: () => of(payload) } as never;
    return firstValueFrom(
      new MaskingInterceptor(reflector).intercept(context(), next),
    );
  };

  it("普通对象里的 Date 原样保留（回归：createdAt 不得变成 {}）", async () => {
    const createdAt = new Date("2026-11-06T14:20:55.574Z");
    const result: any = await run([{ id: "c1", createdAt }]);
    expect(result[0].createdAt).toBeInstanceOf(Date);
    expect(JSON.parse(JSON.stringify(result))[0].createdAt).toBe(
      "2026-11-06T14:20:55.574Z",
    );
  });

  it("嵌套对象与数组里的 Date 也不会被展开", async () => {
    const at = new Date("2026-11-01T00:00:00.000Z");
    const result: any = await run({
      decision: { at, by: { name: "李主任" } },
      history: [{ at }],
    });
    expect(result.decision.at).toBeInstanceOf(Date);
    expect(result.history[0].at).toBeInstanceOf(Date);
    expect(result.decision.by.name).toBe("李主任");
  });

  it("类实例上的 @Masked 字段仍然脱敏（修复没有关掉脱敏）", async () => {
    class UserRow {
      phone = "13800001234";
    }
    const result: any = await run([new UserRow()], "phone");
    expect(result[0].phone).toBe("138****1234");
  });

  it("admin 跳过脱敏的行为不变", async () => {
    const reflector = { get: () => "phone" } as never;
    const next = { handle: () => of([{ phone: "13800001234" }]) } as never;
    const result: any = await firstValueFrom(
      new MaskingInterceptor(reflector).intercept(context("admin"), next),
    );
    expect(result[0].phone).toBe("13800001234");
  });
});
