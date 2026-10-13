import { SPACE_ID } from "@medtrust/demo-scenario";
import { SpaceBackfillService } from "./space-backfill.service";

describe("目录归属回填", () => {
  it("只把空的 homeSpace 补到默认空间", async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const ds = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (!sql.includes("homeSpace")) throw new Error("no such table");
      },
    };
    const svc = new SpaceBackfillService(ds as never);
    await svc.onModuleInit();
    const home = queries.find((q) => q.sql.includes("homeSpace"));
    expect(home?.sql).toContain('"homeSpace" IS NULL');
    expect(home?.sql).toContain(`"homeSpace" = ''`);
    expect(home?.sql).not.toContain('homeSpace" IS NOT NULL');
    expect(home?.params).toEqual([SPACE_ID]);
  });
});
