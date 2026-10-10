import { ForbiddenException } from "@nestjs/common";
import { isSpaceScopedEntity } from "@medtrust/space-kernel";
import { SPACE_SCOPED_TABLES } from "@medtrust/database";
import "./space-scope.registration";
import { SpaceScopeService } from "./space-scope.service";
import { firstValueFrom, Observable } from "rxjs";
import { SpaceContextService } from "./space-context.service";
import { SpaceContextInterceptor } from "./space-context.interceptor";
import {
  assertSpaceAllowed,
  resolveRequestedSpace,
  resolveSpaces,
} from "./space-resolver";

function ctxFor(user: unknown, headers: Record<string, unknown> = {}) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, headers }) }),
  } as any;
}

function handlerCapturing(captured: { spaceId?: string }) {
  return {
    handle: () =>
      new Observable((sub) => {
        // 处理器内部必须能读到空间上下文（P2.2）
        captured.spaceId = spaceContext.require().spaceId;
        sub.next("ok");
        sub.complete();
      }),
  } as any;
}

const spaceContext = new SpaceContextService();

describe("space-resolver", () => {
  it("无 spaces 声明时回落默认空间（单空间零变更）", () => {
    expect(resolveSpaces(undefined, "sh-med")).toEqual(["sh-med"]);
    expect(resolveSpaces({ spaces: [] }, "sh-med")).toEqual(["sh-med"]);
  });

  it("请求头优先于令牌当前空间", () => {
    expect(resolveRequestedSpace("s2", { spaceId: "s1" }, "sh-med")).toBe("s2");
    expect(resolveRequestedSpace(undefined, { spaceId: "s1" }, "sh-med")).toBe(
      "s1",
    );
  });

  it("越权空间被拒，且不区分不存在与不属于", () => {
    expect(() => assertSpaceAllowed("s2", ["s1"])).toThrow(ForbiddenException);
    expect(() => assertSpaceAllowed(undefined, ["s1"])).toThrow(
      ForbiddenException,
    );
    expect(assertSpaceAllowed("s1", ["s1", "s2"])).toBe("s1");
  });
});

describe("SpaceContextInterceptor", () => {
  const interceptor = new SpaceContextInterceptor(spaceContext);

  it("已认证请求建立上下文，处理器内可读", async () => {
    const captured: { spaceId?: string } = {};
    const value = await firstValueFrom(
      interceptor.intercept(
        ctxFor({ spaces: ["sh-med", "bj-med"], spaceId: "sh-med" }),
        handlerCapturing(captured),
      ),
    );
    expect(value).toBe("ok");
    expect(captured.spaceId).toBe("sh-med");
  });

  it("负例：伪造 spaceId 越权访问即拒绝（P2.6）", () => {
    // 越权在进入处理器之前即被拒：intercept 同步抛出，由 Nest 异常过滤器转为 403。
    expect(() =>
      interceptor.intercept(
        ctxFor({ spaces: ["sh-med"] }, { "x-space-id": "bj-med" }),
        handlerCapturing({}),
      ),
    ).toThrow(ForbiddenException);
  });

  it("未认证请求直接放行，不建立上下文", async () => {
    const seen: { value?: unknown; space?: unknown } = {};
    const next = {
      handle: () =>
        new Observable((sub) => {
          seen.space = spaceContext.current();
          sub.next("public");
          sub.complete();
        }),
    } as any;
    const value = await firstValueFrom(
      interceptor.intercept(ctxFor(undefined), next),
    );
    expect(value).toBe("public");
    expect(seen.space).toBeUndefined();
  });
});

describe("space-scope 登记与仓储注入（P2.3 / P4）", () => {
  const scopeService = new SpaceScopeService(spaceContext);

  function fakeQb(alias: string) {
    const calls: Array<{
      condition: string;
      parameters?: Record<string, unknown>;
    }> = [];
    return {
      alias,
      calls,
      andWhere(condition: string, parameters?: Record<string, unknown>) {
        calls.push({ condition, parameters });
        return this;
      },
    };
  }

  it("域内活动表已登记（P4.1）", () => {
    expect(SPACE_SCOPED_TABLES.length).toBeGreaterThan(20);
    for (const t of [
      "cp_digital_contract",
      "cp_mdop_job",
      "cp_settlement_record",
      "cp_attestation_ref",
      "cp_connector_audit_digest",
    ]) {
      expect(isSpaceScopedEntity(t)).toBe(true);
    }
  });

  it("身份 / 主体表 NOT 登记，且 org 唯一性语义不变（P4.4）", () => {
    for (const t of [
      "cp_participant",
      "cp_org_certification_application",
      "cp_interop_subject",
      "cp_space",
    ]) {
      expect(isSpaceScopedEntity(t)).toBe(false);
      expect(SPACE_SCOPED_TABLES).not.toContain(t);
    }
  });

  it("查询域内活动表时注入 space_id 过滤", () => {
    const qb = fakeQb("c");
    spaceContext.run({ spaceId: "s1" }, () =>
      scopeService.scope(qb, "cp_digital_contract"),
    );
    expect(qb.calls).toHaveLength(1);
    expect(qb.calls[0].condition).toBe("c.space_id = :__spaceId");
    expect(qb.calls[0].parameters).toEqual({ __spaceId: "s1" });
  });

  it("查询身份表时不注入（机构身份全局）", () => {
    const qb = fakeQb("p");
    spaceContext.run({ spaceId: "s1" }, () =>
      scopeService.scope(qb, "cp_participant"),
    );
    expect(qb.calls).toHaveLength(0);
  });

  it("无空间上下文时不注入（守卫负责拒绝，不由仓储猜默认空间）", () => {
    const qb = fakeQb("c");
    scopeService.scope(qb, "cp_digital_contract");
    expect(qb.calls).toHaveLength(0);
  });
});
