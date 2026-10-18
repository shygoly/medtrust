import { NotificationEntity } from "@medtrust/database";
import { NotificationService } from "./notification.service";

/**
 * 站内信（D-NOTIF-1）的语义钉子。
 *
 * 三条要钉住：
 * 1. **收件人是参与方**：查/标已读都只按 `recipientParticipantId` 过滤——越权看不到别人的待办；
 * 2. **通知不是闸门**：写入失败（仓库抛错）时 `notify` 返回 null 而不抛，业务动作照常；
 * 3. **已读按参与方记**：机构内任一成员标记已读即视为机构已知悉（本仓授权主体就是参与方）。
 */
describe("NotificationService（站内信）", () => {
  let rows: NotificationEntity[];
  let updates: Array<{
    where: Record<string, unknown>;
    patch: Record<string, unknown>;
  }>;
  let failWrites: boolean;

  /** 查询构造器替身：按 andWhere 收集的条件在内存里过滤（够用且不引入真库）。 */
  const qbFor = () => {
    const calls: Array<{
      condition: string;
      params?: Record<string, unknown>;
    }> = [];
    const qb: Record<string, unknown> = {
      calls,
      andWhere: (condition: string, params?: Record<string, unknown>) => {
        calls.push({ condition, params });
        return qb;
      },
      orderBy: () => qb,
      take: () => qb,
      getMany: async () => {
        const me = calls.find((c) =>
          c.condition.includes("recipientParticipantId"),
        )?.params?.me;
        const st = calls.find((c) => c.condition.includes("status"))?.params
          ?.st;
        return rows.filter(
          (row) =>
            (!me || row.recipientParticipantId === me) &&
            (!st || row.status === st),
        );
      },
      getCount: async () =>
        rows.filter(
          (row) =>
            row.recipientParticipantId ===
              calls.find((c) => c.condition.includes("recipientParticipantId"))
                ?.params?.me && row.status === "unread",
        ).length,
    };
    return qb;
  };

  const repo = {
    create: (input: Partial<NotificationEntity>) => ({ ...input }),
    save: async (row: NotificationEntity) => {
      if (failWrites) throw new Error("db locked");
      if (!rows.includes(row)) rows.push(row);
      return row;
    },
    findOne: async ({ where }: { where: { id: string } }) =>
      rows.find((row) => row.id === where.id) ?? null,
    update: async (
      where: Record<string, unknown>,
      patch: Record<string, unknown>,
    ) => {
      updates.push({ where, patch });
      let affected = 0;
      for (const row of rows) {
        if (
          row.recipientParticipantId === where.recipientParticipantId &&
          row.status === where.status
        ) {
          Object.assign(row, patch);
          affected += 1;
        }
      }
      return { affected };
    },
    createQueryBuilder: () => qbFor(),
  };

  let service: NotificationService;

  beforeEach(() => {
    rows = [];
    updates = [];
    failWrites = false;
    service = new NotificationService(
      repo as never,
      { scope: (qb: unknown) => qb } as never,
      { current: () => ({ spaceId: "sh-med" }) } as never,
    );
  });

  it("写入收件箱：收件方/类型/资源/触发者/空间都要落库", async () => {
    const view = await service.notify({
      recipientParticipantId: "p-hosp-a",
      type: "contract.request",
      title: "新的数据合约申请",
      body: "p-sponsor 申请使用 dp-controls",
      resourceType: "contract",
      resourceId: "ct-1",
      actorParticipantId: "p-sponsor",
      details: { contractId: "ct-1" },
    });

    expect(view).toMatchObject({
      recipientParticipantId: "p-hosp-a",
      type: "contract.request",
      status: "unread",
      resourceId: "ct-1",
      actorParticipantId: "p-sponsor",
    });
    expect(rows[0].spaceId).toBe("sh-med");
  });

  it("收件箱只返回发给自己的（越权看不到别家待办）", async () => {
    await service.notify({
      recipientParticipantId: "p-hosp-a",
      type: "t",
      title: "给我",
    });
    await service.notify({
      recipientParticipantId: "p-other",
      type: "t",
      title: "给别家",
    });

    const mine = await service.list({ recipientParticipantId: "p-hosp-a" });
    expect(mine.map((n) => n.title)).toEqual(["给我"]);
    await expect(service.unreadCount("p-hosp-a")).resolves.toBe(1);
    await expect(service.unreadCount("p-nobody")).resolves.toBe(0);
  });

  it("标记已读：只能标自己的；重复标记幂等；read-all 只影响自己", async () => {
    const mine = await service.notify({
      recipientParticipantId: "p-hosp-a",
      type: "t",
      title: "待处理",
    });
    await service.notify({
      recipientParticipantId: "p-other",
      type: "t",
      title: "别家",
    });

    await expect(service.markRead(mine!.id, "p-other")).rejects.toThrow(
      /通知不存在/,
    );

    const read = await service.markRead(mine!.id, "p-hosp-a");
    expect(read.status).toBe("read");
    expect(read.readAt).toBeTruthy();
    const again = await service.markRead(mine!.id, "p-hosp-a");
    expect(again.status).toBe("read");

    const second = await service.notify({
      recipientParticipantId: "p-hosp-a",
      type: "t",
      title: "又一条",
    });
    await expect(service.markAllRead("p-hosp-a")).resolves.toMatchObject({
      updated: 1,
    });
    expect(rows.find((r) => r.id === second!.id)?.status).toBe("read");
    // 别家的仍未读
    expect(
      rows.find((r) => r.recipientParticipantId === "p-other")?.status,
    ).toBe("unread");
  });

  it("通知是旁路：写失败返回 null 而不抛（业务动作不因通知失败而失败）", async () => {
    failWrites = true;
    await expect(
      service.notify({
        recipientParticipantId: "p-hosp-a",
        type: "t",
        title: "写不进去",
      }),
    ).resolves.toBeNull();
  });

  it("没有收件方就不写（空收件人会变成谁都看不到的孤儿记录）", async () => {
    await expect(
      service.notify({ recipientParticipantId: "", type: "t", title: "x" }),
    ).resolves.toBeNull();
    expect(rows).toHaveLength(0);
  });
});
