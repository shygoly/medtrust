import type { AuditLog } from "@medtrust/database";

/**
 * 审计条目 → CSV（P2-5 补充：报告导出的表格形态）。
 *
 * 为什么单独一个纯函数：CSV 的坑全在**转义**（字段里有逗号、引号、换行就会被拆列，
 * 下游用 Excel 打开时静默错位）。把它从服务里摘出来，才能用用例把转义钉住。
 */

const HEADER = [
  "id",
  "timestamp",
  "action",
  "resourceType",
  "resourceId",
  "userId",
  "userName",
  "ipAddress",
  "complianceLevel",
  "requiresReview",
  "details",
  "entryHash",
  "prevHash",
] as const;

/** RFC4180：含 `,` `"` 换行 → 整体加引号，内部引号翻倍。 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function auditLogsToCsv(entries: AuditLog[]): string {
  const lines = [HEADER.join(",")];
  for (const entry of entries) {
    lines.push(
      [
        entry.id,
        entry.timestamp ? new Date(entry.timestamp).toISOString() : "",
        entry.action,
        entry.resourceType,
        entry.resourceId,
        entry.userId,
        entry.user?.name ?? entry.user?.email ?? "",
        entry.ipAddress,
        entry.complianceLevel,
        entry.requiresReview,
        entry.details ?? null,
        entry.entryHash,
        entry.prevHash,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // 末尾保留换行：`wc -l` 与大多数 CSV 工具都按"每行一条"数记录
  return lines.join("\n") + "\n";
}
