import {
  FlPredictionAssignmentEntity,
  FlOrchestrationStatus,
  FlPredictionTaskEntity,
} from "@medtrust/database";
import { FlPredictionTaskSpec } from "../../compute-task/dto/fl-prediction-task-spec";
import {
  assertMergedDpCompliance,
  assertMinCohort,
  assertPartyResultsDpCompliance,
} from "../../compute-task/dto/fl-dp-gate";
import {
  filterFlRunResultByPolicy,
  FlAttestationSummary,
  FlPartyRunResult,
  isFlPartyRunResult,
  mergeFlPartyResults,
} from "../../compute-task/dto/fl-run-result";
import { projectFlRunResultToTaskSummary } from "../../compute-task/dto/fl-result-projection";
import {
  ConnectorContractPayload,
  ConnectorPendingFlTask,
  FlOrchestrationRecord,
  FlPartyRunResultPayload,
  FlProgressEvent,
  FlProgressStage,
  FlTaskAssignment,
} from "./types";

export function toOrchestrationRecord(
  task: FlPredictionTaskEntity,
  assignments: FlPredictionAssignmentEntity[],
): FlOrchestrationRecord {
  return {
    taskId: task.taskId,
    title: task.title,
    purpose: task.purpose,
    flPredictionSpec: task.flPredictionSpec as unknown as FlPredictionTaskSpec,
    consumerId: task.consumerId,
    contractIds: task.contractIds,
    computeTaskId: task.computeTaskId ?? undefined,
    status: task.status,
    assignments: assignments.map(toAssignmentDto),
    merged: task.merged ?? undefined,
    attestation:
      (task.merged as { attestation?: FlAttestationSummary } | null)
        ?.attestation ?? undefined,
    resultSummary: task.resultSummary ?? undefined,
    createdAt: (task.createdAt ?? new Date()).toISOString(),
    completedAt: task.completedAt?.toISOString(),
  };
}

export function toAssignmentDto(
  row: FlPredictionAssignmentEntity,
): FlTaskAssignment {
  return {
    assignmentId: row.assignmentId,
    taskId: row.taskId,
    providerId: row.providerId,
    purpose: row.purpose,
    flPredictionSpec: row.flPredictionSpec as unknown as FlPredictionTaskSpec,
    contract: row.contract as unknown as ConnectorContractPayload,
    status: row.status,
    progress: (row.progress ?? []) as unknown as FlProgressEvent[],
    partyResult:
      (row.partyResult as unknown as FlPartyRunResultPayload | null) ??
      undefined,
    error: row.error ?? undefined,
    startedAt: row.startedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
  };
}

export function toPendingFlTask(
  row: FlPredictionAssignmentEntity,
): ConnectorPendingFlTask {
  return {
    assignmentId: row.assignmentId,
    taskId: row.taskId,
    purpose: row.purpose,
    workloadType: "federated_learning",
    flPredictionSpec: row.flPredictionSpec as unknown as FlPredictionTaskSpec,
    contract: row.contract as unknown as ConnectorContractPayload,
  };
}

export function appendFlProgress(
  progress: FlProgressEvent[],
  stage: FlProgressStage,
  detail?: string,
): FlProgressEvent[] {
  return [...progress, { at: new Date().toISOString(), stage, detail }];
}

function extractPartyResults(
  assignments: FlPredictionAssignmentEntity[],
): FlPartyRunResult[] {
  const results: FlPartyRunResult[] = [];
  for (const assignment of assignments) {
    const raw: unknown = assignment.partyResult;
    if (isFlPartyRunResult(raw)) {
      results.push(raw);
    }
  }
  return results;
}

export function mergeFlPartyResultsForTask(
  spec: FlPredictionTaskSpec,
  partyResults: FlPartyRunResult[],
): { merged: Record<string, unknown>; resultSummary: Record<string, unknown> } {
  assertPartyResultsDpCompliance(spec, partyResults);
  assertMinCohort(spec, partyResults);
  const mergedRun = filterFlRunResultByPolicy(
    mergeFlPartyResults(partyResults, spec, { runtime: "connector-ml" }),
    spec.outputPolicy.allowedArtifacts,
  );
  assertMergedDpCompliance(spec, mergedRun);
  const resultSummary = projectFlRunResultToTaskSummary(mergedRun);
  return {
    merged: mergedRun as unknown as Record<string, unknown>,
    resultSummary,
  };
}

export function refreshFlTaskStatus(
  task: FlPredictionTaskEntity,
  assignments: FlPredictionAssignmentEntity[],
  spec: FlPredictionTaskSpec,
): void {
  const done = assignments.every(
    (a) => a.status === "completed" || a.status === "failed",
  );
  if (!done) {
    task.status = "running";
    return;
  }

  const completed = assignments.filter((a) => a.status === "completed");
  if (completed.length === assignments.length) {
    const partyResults = extractPartyResults(completed);
    if (partyResults.length === completed.length) {
      const { merged, resultSummary } = mergeFlPartyResultsForTask(
        spec,
        partyResults,
      );
      task.status = "completed";
      task.merged = merged;
      task.resultSummary = resultSummary;
    } else {
      task.status = "failed";
      task.merged = null;
      task.resultSummary = null;
    }
  } else if (completed.length > 0) {
    const partyResults = extractPartyResults(completed);
    if (partyResults.length > 0) {
      const { merged, resultSummary } = mergeFlPartyResultsForTask(
        spec,
        partyResults,
      );
      task.status = "partial";
      task.merged = merged;
      task.resultSummary = resultSummary;
    } else {
      task.status = "failed";
      task.merged = null;
      task.resultSummary = null;
    }
  } else {
    task.status = "failed";
    task.merged = null;
    task.resultSummary = null;
  }
  task.completedAt = new Date();
}

export type { FlOrchestrationStatus };
