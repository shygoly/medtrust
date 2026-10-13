"use client";

import Link from "next/link";

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
      {!isFl && rwsQuery.data?.analysis?.type === "disproportionality" ? (
        <div
          className="p-3 mb-4 text-[0.72rem] leading-relaxed"
          style={{ border: "1px solid var(--cs-line)", color: "var(--cs-dim)" }}
        >
          本任务是<strong>迁移前经旧通道产生</strong>的 L1.5 失衡检测结果，现为<strong>只读历史</strong>。L1.5 已统一由 MDOP
          作业执行：新任务请在 RWS 向导提交，并在{" "}
          <Link href="/space/tasks?channel=mdop" style={{ textDecoration: "underline" }}>
            MDOP 作业
          </Link>{" "}
          页跟进。
        </div>
      ) : null}
      {isFl ? (
        <FlPredictionOrchestrationDetail task={flQuery.data!} />
      ) : (
        <RwsOrchestrationDetail task={rwsQuery.data!} />
      )}
    </OrchestrationDetailShell>
  );
}
