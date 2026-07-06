"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { SecretFlowMergedResult } from "@/lib/federated-tasks";

export type ConsumerDeliverable = {
  taskId: string;
  taskRef?: string;
  total?: number;
  currency?: string;
  paidAt?: string;
  state?: string;
  lastLoss?: number;
  currentEpoch?: number;
  result?: SecretFlowMergedResult;
  resultPending?: boolean;
};

export function useConsumerDeliverables() {
  const settlementsQ = useQuery({
    queryKey: ["settlements", "consumer"],
    queryFn: () => api.getSettlements() as Promise<any[]>,
  });

  const settlements = Array.isArray(settlementsQ.data) ? settlementsQ.data : [];
  const taskIds = [...new Set(settlements.map((s) => s.taskId).filter(Boolean))];

  const statusQueries = useQueries({
    queries: taskIds.map((taskId) => ({
      queryKey: ["secretflow-task", taskId],
      queryFn: () => api.getSecretFlowTask(taskId),
      staleTime: 30_000,
    })),
  });

  const resultQueries = useQueries({
    queries: taskIds.map((taskId, i) => ({
      queryKey: ["secretflow-result", taskId],
      queryFn: () => api.getSecretFlowResult(taskId) as Promise<SecretFlowMergedResult>,
      enabled: statusQueries[i]?.data?.state === "COMPLETED",
      staleTime: 60_000,
      retry: false,
    })),
  });

  const rows: ConsumerDeliverable[] = settlements.map((s, i) => {
    const idx = taskIds.indexOf(s.taskId);
    const status = idx >= 0 ? statusQueries[idx]?.data : undefined;
    const result = idx >= 0 ? resultQueries[idx]?.data : undefined;
    return {
      taskId: s.taskId,
      taskRef: s.taskRef,
      total: s.total,
      currency: s.currency,
      paidAt: s.at,
      state: status?.state,
      lastLoss: status?.lastLoss,
      currentEpoch: status?.currentEpoch,
      result,
      resultPending: status?.state === "COMPLETED" && !result && resultQueries[idx]?.isLoading,
    };
  });

  return {
    rows,
    isLoading: settlementsQ.isLoading,
    error: settlementsQ.error,
    refetch: settlementsQ.refetch,
    isFetching: settlementsQ.isFetching,
  };
}
