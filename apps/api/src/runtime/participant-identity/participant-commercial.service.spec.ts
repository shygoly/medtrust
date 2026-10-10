import { ParticipantCommercialService } from "./participant-commercial.service";

function repo(seed: any[] = []) {
  const rows = seed;
  return {
    rows,
    findOne: async (o: any) => rows.find((r) => r.id === o?.where?.id) ?? null,
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
});
