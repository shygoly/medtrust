"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useAuth } from "@/lib/auth";
import type { SecretFlowTaskSummary } from "@/lib/federated-tasks";
import { toTaskRows } from "@/lib/task-list";

/** 读取失败返回 undefined 并记下来源名：一个通道挂了不该让整个列表空掉，但要让用户知道。 */
async function optional<T>(name: string, failed: string[], fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    failed.push(name);
    return undefined;
  }
}

// 统一任务列表的取数：四个通道 + 提供方的入站分派（仅 provider 请求）。映射逻辑在 lib/task-list。
// `live`：任务列表页需要跟踪进度，轮询；只拿它做「任务 ID → 详情地址」反查的页面（账本）不轮询。
export function useTaskList({ live = false }: { live?: boolean } = {}) {
  const { user, ready } = useAuth();
  const role = user?.role;
  const participantId = user?.participantId;
  return useQuery({
    queryKey: ["task-list", role ?? "", participantId ?? ""],
    enabled: ready,
    refetchInterval: live ? 5000 : false,
    queryFn: async () => {
      const failed: string[] = [];
      const [rws, fl, secretflow, mdopJobs, inbox] = await Promise.all([
        optional("RWS", failed, () => api.listRwsTasks()),
        optional("L4 联邦预测", failed, () => api.listFlPredictionTasks()),
        optional("SecretFlow", failed, () => api.listSecretFlowTasks() as Promise<SecretFlowTaskSummary[]>),
        optional("MDOP", failed, () => api.listMdopJobs()),
        role === "provider"
          ? optional("入站分派", failed, async () => {
              const [a, b] = await Promise.all([api.listRwsInbox(), api.listFlInbox()]);
              return [...a, ...b];
            })
          : Promise.resolve(undefined),
      ]);
      return { rows: toTaskRows({ rws, fl, secretflow, mdopJobs, inbox }, { participantId }), failed };
    },
  });
}
