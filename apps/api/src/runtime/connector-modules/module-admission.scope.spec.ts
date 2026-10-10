import { ModuleAdmissionService } from "./module-admission.service";

function makeService(opts: {
  admissionsFind?: jest.Mock;
  revocationsFind?: jest.Mock;
  revocationsCount?: jest.Mock;
}) {
  const admissions = { find: opts.admissionsFind ?? jest.fn() } as any;
  const revocations = {
    find: opts.revocationsFind ?? jest.fn(),
    count: opts.revocationsCount ?? jest.fn(),
  } as any;
  return new ModuleAdmissionService(admissions, revocations, {} as any, {} as any);
}

describe("module-admission 空间范围（P5 / D-SPD-17）", () => {
  it("无空间上下文：只查 global（fail-closed，不假设默认空间）", async () => {
    const find = jest.fn().mockResolvedValue([]);
    await makeService({ admissionsFind: find }).list({});
    const where = find.mock.calls[0][0].where as Array<Record<string, unknown>>;
    expect(where).toHaveLength(1);
    expect(where[0].spaceId).toBeDefined();
  });

  it("有空间上下文：global ∪ 本空间，且不含其它空间", async () => {
    const find = jest.fn().mockResolvedValue([]);
    await makeService({ admissionsFind: find }).list({ spaceId: "s1" });
    const where = find.mock.calls[0][0].where as Array<Record<string, unknown>>;
    expect(where).toHaveLength(2);
    expect(where[1]).toEqual({ spaceId: "s1" });
    // 负例：查询条件里 MUST NOT 出现其它空间
    expect(JSON.stringify(where)).not.toContain("s2");
  });

  it("基础过滤条件与空间范围叠加", async () => {
    const find = jest.fn().mockResolvedValue([]);
    await makeService({ admissionsFind: find }).list({ spaceId: "s1", status: "active" });
    const where = find.mock.calls[0][0].where as Array<Record<string, unknown>>;
    expect(where[1]).toEqual({ status: "active", spaceId: "s1" });
  });

  it("吊销名单按空间可见范围过滤", async () => {
    const find = jest.fn().mockResolvedValue([]);
    await makeService({ revocationsFind: find }).revocationList("s1");
    const where = find.mock.calls[0][0].where as Array<Record<string, unknown>>;
    expect(where).toHaveLength(2);
    expect(where[1]).toEqual({ spaceId: "s1" });
  });

  it("吊销判定同样按空间范围（别空间的吊销不作用于本空间）", async () => {
    const count = jest.fn().mockResolvedValue(0);
    const key = "ab".repeat(32);
    await makeService({ revocationsCount: count }).isRevoked(key, "s1");
    const where = count.mock.calls[0][0].where as Array<Record<string, unknown>>;
    expect(where).toHaveLength(2);
    expect(where[1]).toEqual({ spaceId: "s1", sm3: key });
  });
});
