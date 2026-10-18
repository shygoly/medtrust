import { AuditAction } from "@medtrust/database";
import { AuditController } from "./audit.controller";
import type { AuditService } from "./audit.service";

/**
 * CSV 导出端点的**接线**（格式本身在 audit-csv.spec.ts 里钉）。
 *
 * 为什么值得单独测：端点用的是 `@Res()` 直写响应，一旦漏了 Content-Type 或 BOM，
 * 用户拿到的文件在 Excel 里就是乱码/被当成纯文本——而应用层不报错，属于静默失败。
 */
describe("AuditController · export.csv", () => {
  const res = () => {
    const state: { headers: Record<string, string>; body?: string } = {
      headers: {},
    };
    return {
      state,
      set(headers: Record<string, string>) {
        state.headers = headers;
      },
      send(body: string) {
        state.body = body;
      },
    };
  };

  it("带筛选条件取 CSV，并写成附件下载（text/csv + BOM，Excel 不乱码）", async () => {
    const seen: unknown[] = [];
    const auditService = {
      exportCsv: async (query: unknown) => {
        seen.push(query);
        return "id,action\n1,COMPUTE\n";
      },
    } as unknown as AuditService;
    const controller = new AuditController(auditService, {} as never);
    const response = res();

    await controller.exportCsv(
      { user: { tenantId: 9 } } as never,
      response as never,
      AuditAction.COMPUTE,
      "rws-task",
      "2026-10-01",
      "2026-10-31",
      "50",
    );

    expect(seen[0]).toMatchObject({
      tenantId: 9,
      action: AuditAction.COMPUTE,
      resource: "rws-task",
      limit: 50,
    });
    expect(seen[0]).toMatchObject({
      startDate: new Date("2026-10-01"),
      endDate: new Date("2026-10-31"),
    });
    expect(response.state.headers["Content-Type"]).toContain("text/csv");
    expect(response.state.headers["Content-Disposition"]).toContain(
      "attachment",
    );
    expect(response.state.headers["Content-Disposition"]).toContain(".csv");
    expect(response.state.body?.startsWith("\uFEFF")).toBe(true);
    expect(response.state.body).toContain("1,COMPUTE");
  });
});
