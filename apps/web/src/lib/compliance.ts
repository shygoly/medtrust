// 合规视图共享逻辑:把控制面审计日志按动作语义分类为合规告警。
// 数据全部来自真实 /audit 端点,不做 mock。

export interface AuditLogRow {
  id?: number | string;
  action?: string;
  resourceType?: string;
  resource?: string;
  resourceId?: string | number;
  timestamp?: string;
  user?: { name?: string; email?: string };
}

export type Severity = "high" | "medium";

export interface AlertKind {
  severity: Severity;
  label: string;
}

// 动作名 → 风险等级。命中即视为合规告警(高危=红,关注=琥珀)。
const RISK_RULES: Array<{ re: RegExp; severity: Severity; label: string }> = [
  { re: /DELETE|REMOVE|DESTROY|PURGE/i, severity: "high", label: "数据删除" },
  { re: /DENY|REJECT|BLOCK|SUPPRESS|FORBID/i, severity: "high", label: "访问/输出被拦截" },
  { re: /UNAUTHORIZED|FORBIDDEN|INVALID_CREDENTIAL/i, severity: "high", label: "越权/未授权" },
  { re: /REVOKE|DISABLE|REVOKED/i, severity: "medium", label: "权限撤销" },
  { re: /FAIL|ERROR/i, severity: "medium", label: "操作失败" },
  { re: /EXPORT|DOWNLOAD/i, severity: "medium", label: "数据导出" },
];

export function classifyAlert(action?: string): AlertKind | null {
  if (!action) return null;
  for (const r of RISK_RULES) if (r.re.test(action)) return { severity: r.severity, label: r.label };
  return null;
}

// /audit 返回 TypeORM getManyAndCount 元组 [logs, total];兼容旧 {logs} 与裸数组。
export function normalizeAuditList(raw: unknown): AuditLogRow[] {
  if (Array.isArray(raw)) return (Array.isArray(raw[0]) ? raw[0] : raw) as AuditLogRow[];
  const obj = raw as { logs?: AuditLogRow[] } | null;
  return obj?.logs ?? [];
}

export function extractAlerts(logs: AuditLogRow[]): Array<AuditLogRow & { kind: AlertKind }> {
  return logs
    .map((l) => {
      const kind = classifyAlert(l.action);
      return kind ? { ...l, kind } : null;
    })
    .filter((x): x is AuditLogRow & { kind: AlertKind } => x !== null);
}
