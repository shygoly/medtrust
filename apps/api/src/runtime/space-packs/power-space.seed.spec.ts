import { SPACE_ID } from "@medtrust/demo-scenario";
import {
  CollaborationEntity,
  DataProduct,
  SpaceEntity,
} from "@medtrust/database";
import {
  POWER_DEMO_USERS,
  POWER_PACK_ID,
  POWER_SCENARIOS,
  POWER_SPACE_ID,
  POWER_SPACE_NAME,
  powerCatalogProducts,
} from "@medtrust/domain-power";
import { mockRepo } from "../test-utils/mock-repo";
import { PowerSpaceSeedService } from "./power-space.seed";

function packs(allowed: string[]) {
  const enabled: Record<string, string[]> = {};
  return {
    allowedPacks: () => allowed,
    enableForSpace: (ctx: { spaceId: string }, ids: string[]) => {
      enabled[ctx.spaceId] = ids;
    },
    enabled,
  };
}

function service(
  allowed: string[],
  spaces = mockRepo(),
  products = mockRepo(),
  collaborations = mockRepo(),
  members = mockRepo(),
  users = mockRepo(),
  dataSource?: {
    transaction: (fn: (em: unknown) => Promise<unknown>) => Promise<unknown>;
  },
) {
  return new PowerSpaceSeedService(
    packs(allowed) as never,
    spaces,
    products,
    collaborations,
    members,
    users,
    dataSource as never,
  );
}

describe("电力空间种子", () => {
  it("楼栋级负荷产品不含户表曲线，三个场景标识不重复", () => {
    const products = powerCatalogProducts();
    expect(new Set(products.map((p) => p.id)).size).toBe(products.length);
    const scenarios = new Set(products.map((p) => p.scenarioId));
    expect([...scenarios].sort()).toEqual([
      "renewable-absorption",
      "urban-anomaly",
      "v2g-coordination",
    ]);
    const ami = products.find((p) => p.id === "dp-pwr-ami-load");
    expect(ami?.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining(["buildingId", "anomalyFlag"]),
    );
    expect(ami?.fields.map((f) => f.name)).not.toContain("meterId");
    expect(ami?.scenarioId).toBe("urban-anomaly");
  });

  it("白名单不含电力包时不创建空间、不改默认空间启用集", async () => {
    const spaces = mockRepo();
    await spaces.save({ id: SPACE_ID, name: "上海医疗", enabledPacks: null });
    const users = mockRepo();
    const svc = service(
      ["med"],
      spaces,
      mockRepo(),
      mockRepo(),
      mockRepo(),
      users,
    );
    await svc.onModuleInit();
    expect(
      (await spaces.findOne({ where: { id: SPACE_ID } })).enabledPacks,
    ).toBeNull();
    expect(await spaces.findOne({ where: { id: POWER_SPACE_ID } })).toBeNull();
    expect(await users.count()).toBe(0);
  });

  it("补目录时不改写已属于默认空间的记录，新产品未确权且行数为 0", async () => {
    const spaces = mockRepo();
    const products = mockRepo();
    const collaborations = mockRepo();
    const members = mockRepo();
    const users = mockRepo();
    await spaces.save({
      id: SPACE_ID,
      name: "上海医疗",
      enabledPacks: ["med"],
    });
    await products.save({
      id: "dp-pwr-ami-load",
      urn: `urn:tds:${POWER_SPACE_ID}:dp-pwr-ami-load`,
      homeSpace: SPACE_ID,
      title: "误挂",
    });
    const svc = service(
      [POWER_PACK_ID, "med"],
      spaces,
      products,
      collaborations,
      members,
      users,
    );
    await svc.onModuleInit();
    const stolen = await products.findOne({ where: { id: "dp-pwr-ami-load" } });
    expect(stolen.homeSpace).toBe(SPACE_ID);
    expect(stolen.title).toBe("误挂");
    const owned = await products.find({ where: { homeSpace: POWER_SPACE_ID } });
    expect(owned).toHaveLength(powerCatalogProducts().length - 1);
    expect(
      owned.every((p) => p.rightsConfirmed === false && p.recordCount === 0),
    ).toBe(true);
    const space = await spaces.findOne({ where: { id: POWER_SPACE_ID } });
    expect(space.name).toBe(POWER_SPACE_NAME);
    expect(space.enabledPacks).toEqual([POWER_PACK_ID]);
    const collabs = await collaborations.find({
      where: { spaceId: POWER_SPACE_ID },
    });
    expect(collabs.map((c) => c.name).sort()).toEqual(
      POWER_SCENARIOS.map((s) => s.title).sort(),
    );
    expect(collabs.every((c) => (c.participants ?? []).length > 0)).toBe(true);
    const urban = collabs.find((c) => c.name === "城市用电异常监测");
    expect(urban.participants).toEqual([
      "p-grid-hn",
      "p-weather-hn",
      "p-civic-hn",
      "p-gov-hn",
    ]);
    const plant = collabs.find((c) => c.name === "新能源消纳预测");
    expect(plant.participants).not.toContain("p-gov-hn");
    expect(await users.count()).toBe(POWER_DEMO_USERS.length);
    const memberships = await members.find();
    expect(
      memberships.every(
        (m) => m.spaceId === POWER_SPACE_ID && m.subjectType === "org",
      ),
    ).toBe(true);
    expect(memberships.some((m) => m.spaceId === SPACE_ID)).toBe(false);
    expect(urban.dataProductIds).not.toContain("dp-pwr-ami-load");
    expect(urban.dataProductIds.length).toBe(
      POWER_SCENARIOS.find((s) => s.id === "urban-anomaly")!.products.length -
        1,
    );
  });

  it("产品和协作列表在同一事务里写入", async () => {
    const spaces = mockRepo();
    const products = mockRepo();
    const collaborations = mockRepo();
    let used = false;
    const dataSource = {
      transaction: async (fn: (em: unknown) => Promise<unknown>) => {
        used = true;
        return fn({
          getRepository: (entity: unknown) => {
            if (entity === SpaceEntity) return spaces;
            if (entity === DataProduct) return products;
            if (entity === CollaborationEntity) return collaborations;
            throw new Error("unexpected repository");
          },
        });
      },
    };
    const svc = service(
      ["power", "med"],
      spaces,
      products,
      collaborations,
      mockRepo(),
      mockRepo(),
      dataSource,
    );
    await svc.seedAll();
    expect(used).toBe(true);
    expect(await products.count()).toBe(powerCatalogProducts().length);
    expect(await collaborations.count()).toBe(3);
  });

  it("撤回草稿种子写进电力空间的用户级成员，保留医疗空间与人工邀请", async () => {
    const members = mockRepo();
    await members.save({
      id: "legacy-power",
      spaceId: POWER_SPACE_ID,
      subjectType: "user",
      subjectId: "5",
      role: "operator",
      status: "active",
      invitedBy: "power-space-seed",
    });
    await members.save({
      id: "legacy-med",
      spaceId: SPACE_ID,
      subjectType: "user",
      subjectId: "5",
      role: "operator",
      status: "active",
      invitedBy: "power-space-seed",
    });
    await members.save({
      id: "invited",
      spaceId: POWER_SPACE_ID,
      subjectType: "user",
      subjectId: "9",
      role: "operator",
      status: "active",
      invitedBy: "operator@example",
    });
    const svc = service(
      [POWER_PACK_ID],
      mockRepo(),
      mockRepo(),
      mockRepo(),
      members,
      mockRepo(),
    );
    const prev = process.env.SEED_DEMO_USERS;
    process.env.SEED_DEMO_USERS = "false";
    try {
      await svc.onModuleInit();
    } finally {
      if (prev === undefined) delete process.env.SEED_DEMO_USERS;
      else process.env.SEED_DEMO_USERS = prev;
    }
    expect(await members.findOne({ where: { id: "legacy-power" } })).toBeNull();
    expect(
      await members.findOne({ where: { id: "legacy-med" } }),
    ).toMatchObject({
      spaceId: SPACE_ID,
    });
    expect(await members.findOne({ where: { id: "invited" } })).toMatchObject({
      subjectId: "9",
    });
  });

  it("协作已有参与方时不覆盖，关闭演示账号时不建用户", async () => {
    const prev = process.env.SEED_DEMO_USERS;
    process.env.SEED_DEMO_USERS = "false";
    try {
      const collaborations = mockRepo();
      const users = mockRepo();
      await collaborations.save({
        id: "c-urban",
        spaceId: POWER_SPACE_ID,
        name: "城市用电异常监测",
        participants: ["p-kept"],
        dataProductIds: [],
        status: "active",
      });
      const svc = service(
        ["power", "med"],
        mockRepo(),
        mockRepo(),
        collaborations,
        mockRepo(),
        users,
      );
      await svc.onModuleInit();
      const urban = await collaborations.findOne({
        where: { spaceId: POWER_SPACE_ID, name: "城市用电异常监测" },
      });
      expect(urban.participants).toEqual(["p-kept"]);
      expect(await users.count()).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.SEED_DEMO_USERS;
      else process.env.SEED_DEMO_USERS = prev;
    }
  });

  it("默认空间已有启用集时不覆盖，空启用集则标为医疗包", async () => {
    const spaces = mockRepo();
    await spaces.save({ id: SPACE_ID, enabledPacks: ["med", "custom"] });
    const svc = service(["med", POWER_PACK_ID], spaces);
    await svc.bindDefaultSpacePack();
    expect(
      (await spaces.findOne({ where: { id: SPACE_ID } })).enabledPacks,
    ).toEqual(["med", "custom"]);

    const empty = mockRepo();
    await empty.save({ id: SPACE_ID, enabledPacks: null });
    const svc2 = service(["med"], empty);
    await svc2.bindDefaultSpacePack();
    expect(
      (await empty.findOne({ where: { id: SPACE_ID } })).enabledPacks,
    ).toEqual(["med"]);
  });
});
