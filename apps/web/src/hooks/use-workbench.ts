"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useAuth } from "@/lib/auth";
import { extractAlerts } from "@/lib/compliance";
import { buildWorkbench } from "@/lib/workbench";
import { useAuditLogs } from "./use-audit-logs";
import { useTaskList } from "./use-task-list";

// 工作台取数：按角色只请求其待办需要的来源，并复用各落点页面的查询键（同一份缓存）。
export function useWorkbench() {
  const { user, ready } = useAuth();
  const role = user?.role;
  const trades = role === "provider" || role === "consumer";
  const oversees = role === "compliance" || role === "operator";

  const tasks = useTaskList();
  const contracts = useQuery({ queryKey: ["contracts"], queryFn: () => api.listContracts(), enabled: ready && trades });
  // 站内信（D-NOTIF-1）：所有已绑定参与方的角色都有机构待办
  const notifications = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => api.getUnreadNotificationCount(),
    enabled: ready && Boolean(user?.participantId),
  });
  const audit = useAuditLogs("", { enabled: ready && oversees });
  const breaches = useQuery({
    queryKey: ["rbqm-breaches"],
    queryFn: () => api.getQtlBreaches() as Promise<Array<{ status: string }>>,
    enabled: ready && oversees,
  });
  const certifications = useQuery({
    queryKey: ["admin-certifications", "submitted"],
    queryFn: () => api.getAdminCertifications({ status: "submitted", limit: 1 }),
    enabled: ready && role === "operator",
  });

  return buildWorkbench(role, user?.participantId, {
    tasks: trades ? tasks.data?.rows : undefined,
    contracts: contracts.data,
    alerts: audit.data ? extractAlerts(audit.data) : undefined,
    breaches: breaches.data,
    pendingCertifications: certifications.data?.total,
    unreadNotifications: notifications.data?.unread,
  });
}
