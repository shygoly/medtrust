"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { normalizeAuditList } from "@/lib/compliance";

export const AUDIT_LOG_LIMIT = 500;

// 审计日志的唯一取数口径：审计日志页、告警视图、合规总览都用它。
// 不带 action 时三处共享同一份缓存，所以总览的告警数与告警视图必然一致。
export function useAuditLogs(action = "", { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    enabled,
    queryKey: ["audit-logs", action],
    queryFn: () => api.getAuditLogs(action ? { action, limit: AUDIT_LOG_LIMIT } : { limit: AUDIT_LOG_LIMIT }),
    select: normalizeAuditList,
  });
}
