import { CollaborationService } from "./collaboration.service";

function repo(rows: any[] = []) {
  let seq = 0;
  return {
    rows,
    create: (x: any) => ({ ...x }),
    save: async (x: any) => {
      if (!x.id) x.id = "c-" + ++seq;
      const i = rows.findIndex((r) => r.id === x.id);
      if (i >= 0) rows[i] = x;
      else rows.push(x);
      return x;
    },
    find: async (o: any) => rows.filter((r) => r.spaceId === o?.where?.spaceId),
    findOne: async (o: any) =>
      rows.find(
        (r) => r.id === o?.where?.id && r.spaceId === o?.where?.spaceId,
      ) ?? null,
  } as any;
}

function membershipOf(active: string[]) {
  return {
    listMembers: async () =>
      active.map((subjectId) => ({ subjectId, status: "active" })),
  } as any;
}

describe("协作与可见性作用域（P8 / D-SPD-3）", () => {
  it("创建协作：参与方必须是空间成员（子集约束）", async () => {
    const svc = new CollaborationService(repo(), membershipOf(["p-a", "p-b"]));
    await expect(
      svc.create({
        spaceId: "s1",
        name: "RWS",
        participants: ["p-a", "p-outsider"],
      }),
    ).rejects.toThrow(/必须是本空间成员/);
    const ok = await svc.create({
      spaceId: "s1",
      name: "RWS",
      participants: ["p-a", "p-a"],
    });
    expect(ok.participants).toEqual(["p-a"]);
  });

  it("竞争方隔离：只看到自己参与的协作", async () => {
    const rows = [
      {
        id: "c1",
        spaceId: "s1",
        name: "药企A-RWS",
        participants: ["p-a"],
        status: "active",
      },
      {
        id: "c2",
        spaceId: "s1",
        name: "药企B-RWS",
        participants: ["p-b"],
        status: "active",
      },
      {
        id: "c3",
        spaceId: "s2",
        name: "别空间的",
        participants: ["p-a"],
        status: "active",
      },
    ];
    const svc = new CollaborationService(
      repo(rows),
      membershipOf(["p-a", "p-b"]),
    );
    const visibleA = await svc.listVisible("s1", "p-a");
    expect(visibleA.map((c) => c.id)).toEqual(["c1"]);
    expect(visibleA.map((c) => c.name)).not.toContain("药企B-RWS");
  });

  it("负例：不可见的协作即拒（不泄漏其是否存在之外的信息）", async () => {
    const rows = [
      {
        id: "c2",
        spaceId: "s1",
        name: "药企B",
        participants: ["p-b"],
        status: "active",
      },
    ];
    const svc = new CollaborationService(
      repo(rows),
      membershipOf(["p-a", "p-b"]),
    );
    await expect(svc.assertVisible("s1", "p-a", "c2")).rejects.toThrow(
      /无权访问/,
    );
    await expect(svc.assertVisible("s1", "p-a", "nope")).rejects.toThrow(
      /不存在/,
    );
    expect((await svc.assertVisible("s1", "p-b", "c2")).name).toBe("药企B");
  });

  it("负例：跨空间的协作 id 不生效", async () => {
    const rows = [
      {
        id: "c9",
        spaceId: "s2",
        name: "别空间",
        participants: ["p-a"],
        status: "active",
      },
    ];
    const svc = new CollaborationService(repo(rows), membershipOf(["p-a"]));
    await expect(svc.assertVisible("s1", "p-a", "c9")).rejects.toThrow(
      /不存在/,
    );
  });

  it("读取时丢掉不属于本空间的产品 id", async () => {
    const rows = [
      {
        id: "c1",
        spaceId: "s1",
        name: "A",
        participants: ["p-a"],
        dataProductIds: ["dp-here", "dp-there"],
        status: "active",
      },
    ];
    const products = {
      find: async () => [
        { id: "dp-here", homeSpace: "s1" },
        { id: "dp-there", homeSpace: "s-other" },
      ],
    };
    const svc = new CollaborationService(
      repo(rows),
      membershipOf(["p-a"]),
      products as never,
    );
    const visible = await svc.listVisible("s1", "p-a");
    expect(visible[0].dataProductIds).toEqual(["dp-here"]);
  });

  it("未参加的协作，其产品与成员都不可见", async () => {
    const rows = [
      {
        id: "c1",
        spaceId: "s1",
        participants: ["p-a"],
        dataProductIds: ["dp-a"],
        status: "active",
      },
      {
        id: "c2",
        spaceId: "s1",
        participants: ["p-b", "p-other"],
        dataProductIds: ["dp-b"],
        status: "active",
      },
    ];
    const svc = new CollaborationService(
      repo(rows),
      membershipOf(["p-a", "p-b"]),
    );
    expect([...(await svc.hiddenProductIds("s1", "p-a"))]).toEqual(["dp-b"]);
    const hiddenPeople = await svc.hiddenParticipantIds("s1", "p-a");
    expect(hiddenPeople.has("p-b")).toBe(true);
    expect(hiddenPeople.has("p-other")).toBe(true);
    expect(hiddenPeople.has("p-a")).toBe(false);
    expect(await svc.listVisible("s1", "p-a")).toHaveLength(1);
  });

  it("归档：软删（status=archived），不物理删除", async () => {
    const rows = [
      { id: "c1", spaceId: "s1", participants: ["p-a"], status: "active" },
    ];
    const svc = new CollaborationService(repo(rows), membershipOf(["p-a"]));
    await svc.remove("s1", "c1");
    expect(rows[0].status).toBe("archived");
  });
});
