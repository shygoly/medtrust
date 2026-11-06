import { ParticipantCommercialService } from "./participant-commercial.service";

function repo(seed: any[] = []) {
  const rows = seed;
  return {
    rows,
    // 与 TypeORM 一致：where 可为对象，也可为数组（OR）；机构既可按 slug 也可按 uuid 查到。
    findOne: async (o: any) => {
      const where = o?.where;
      const match = (w: any) =>
        rows.find(
          (r) =>
            (w?.id !== undefined && r.id === w.id) ||
            (w?.participantId !== undefined &&
              r.participantId === w.participantId),
        ) ?? null;
      if (Array.isArray(where)) {
        for (const w of where) {
          const hit = match(w);
          if (hit) return hit;
        }
        return null;
      }
      return match(where);
    },
    save: async (x: any) => {
      const i = rows.findIndex((r) => r.id === x.id);
      if (i >= 0) rows[i] = { ...rows[i], ...x };
      return x;
    },
  } as any;
}

describe("ParticipantCommercialService（P6.5 / D-SPD-13）", () => {
  it("读取商业属性；无则 null", async () => {
    const r = repo([{ id: "p-huashan", org: "华山医院" }]);
    const svc = new ParticipantCommercialService(r);
    expect(await svc.get("p-huashan")).toBeNull();
  });

  it("分段浅合并：只覆盖传入分区，未传分区保留", async () => {
    const r = repo([
      {
        id: "p-huashan",
        commercial: {
          license: { businessLicense: "BL-1" },
          quota: { compute: 10 },
        },
      },
    ]);
    const svc = new ParticipantCommercialService(r);
    const merged = await svc.upsert("p-huashan", {
      quota: { storage: 500 },
      subscription: { plan: "pro" },
    });
    expect(merged.license).toEqual({ businessLicense: "BL-1" });
    expect(merged.quota).toEqual({ compute: 10, storage: 500 });
    expect(merged.subscription).toEqual({ plan: "pro" });
    expect(r.rows[0].commercial.quota.storage).toBe(500);
  });

  it("负例：参与方不存在即拒（不得凭空创建机构）", async () => {
    const svc = new ParticipantCommercialService(repo());
    await expect(svc.get("nope")).rejects.toThrow(/不存在/);
    await expect(svc.upsert("nope", { quota: { compute: 1 } })).rejects.toThrow(
      /不存在/,
    );
  });

  it("按平台 slug（participantId）也能查到——合约/任务里用的是 slug 不是 uuid", async () => {
    const r = repo([
      { id: "9f1c-uuid", participantId: "p-huashan", org: "华山医院" },
    ]);
    const svc = new ParticipantCommercialService(r);
    expect(await svc.get("p-huashan")).toBeNull();
  });
});
