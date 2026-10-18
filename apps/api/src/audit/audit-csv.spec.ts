import { AuditAction, type AuditLog } from "@medtrust/database";
import { auditLogsToCsv, csvCell } from "./audit-csv";

/**
 * CSV 导出的转义契约（plan 5.4「按时间段导出审计日志」的表格形态）。
 *
 * 这里只钉**格式**：字段里的逗号/引号/换行必须被转义，否则下游表格工具会把一条记录
 * 拆成两行两列——而且是静默的（文件打开没报错，行数却不对）。
 */
describe("auditLogsToCsv", () => {
  const entry = (over: Partial<AuditLog> = {}): AuditLog =>
    ({
      id: 1,
      tenantId: 1,
      userId: 7,
      action: AuditAction.COMPUTE,
      resourceType: "rws-task",
      resourceId: null,
      details: { jobId: "job-1", contractId: "ct-1" },
      ipAddress: "127.0.0.1",
      userAgent: "jest",
      complianceLevel: "medium",
      requiresReview: false,
      entryHash: "SM3:abc",
      prevHash: "GENESIS",
      timestamp: new Date("2026-10-16T12:00:00.000Z"),
      ...over,
    }) as AuditLog;

  it("表头固定，行数与条目数一致（末尾换行，便于 wc -l）", () => {
    const csv = auditLogsToCsv([entry(), entry({ id: 2 })]);
    const lines = csv.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      "id,timestamp,action,resourceType,resourceId,userId,userName,ipAddress," +
        "complianceLevel,requiresReview,details,entryHash,prevHash",
    );
  });

  it("含逗号/引号/换行的字段整体加引号且内部引号翻倍（否则表格会被拆列）", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('说"引号"')).toBe('"说""引号"""');
    expect(csvCell("两\n行")).toBe('"两\n行"');
    expect(csvCell(null)).toBe("");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');

    const csv = auditLogsToCsv([
      entry({ details: { note: '含逗号,和"引号"' }, resourceType: "contract" }),
    ]);
    // details 是个 JSON 串 → 整体被引起来；换行仍然是**行内**的，不会多出一行
    expect(csv.trimEnd().split("\n")).toHaveLength(2);
    expect(csv).toContain('""note"":""含逗号,和');
  });

  it("时间统一成 ISO（导出可跨时区对账）", () => {
    const csv = auditLogsToCsv([entry()]);
    expect(csv).toContain("2026-10-16T12:00:00.000Z");
  });
});
