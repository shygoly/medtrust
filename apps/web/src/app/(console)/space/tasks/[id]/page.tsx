"use client";

import {
  FlPredictionOrchestrationDetail,
} from "@/components/console/orchestration/fl-prediction-detail";
import {
  OrchestrationDetailShell,
  RwsOrchestrationDetail,
  useFlPredictionTaskQuery,
  useOrchestrationWorkloadKind,
  useRwsTaskQuery,
  useTaskIdParam,
} from "@/components/console/orchestration/orchestration-task-detail";

export default function TaskDetailPage() {
  const taskId = useTaskIdParam();
  const kind = useOrchestrationWorkloadKind();
  const isFl = kind === "fl_prediction";

  const rwsQuery = useRwsTaskQuery(taskId, !isFl);
  const flQuery = useFlPredictionTaskQuery(taskId, isFl);

  const isLoading = isFl ? flQuery.isLoading : rwsQuery.isLoading;
  const task = isFl ? flQuery.data : rwsQuery.data;

  if (isLoading) {
    return <div className="p-8 cs-label">加载中…</div>;
  }

  if (!task) {
    return <div className="p-8 cs-label">任务不存在</div>;
  }

  return (
    <OrchestrationDetailShell
      kind={kind}
      title={task.title}
      taskId={task.taskId}
      consumerId={task.consumerId}
      createdAt={task.createdAt}
      status={task.status}
      contractIds={task.contractIds}
    >
      {isFl ? (
        <FlPredictionOrchestrationDetail task={flQuery.data!} />
      ) : (
        <RwsOrchestrationDetail task={rwsQuery.data!} />
      )}
    </OrchestrationDetailShell>
  );
}
