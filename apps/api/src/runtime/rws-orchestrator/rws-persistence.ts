import {
  ConnectorContractPayload,
  ConnectorPendingTask,
  RwsAnalysisSpec,
  RwsOrchestrationRecord,
  RwsProgressEvent,
  RwsProgressStage,
  RwsTaskAssignment,
} from './types';
import { RwsAssignmentEntity, RwsAssignmentStatus, RwsOrchestrationStatus, RwsTaskEntity } from '@medtrust/database';

export function toOrchestrationRecord(
  task: RwsTaskEntity,
  assignments: RwsAssignmentEntity[],
): RwsOrchestrationRecord {
  return {
    taskId: task.taskId,
    title: task.title,
    purpose: task.purpose,
    analysis: task.analysis as unknown as RwsAnalysisSpec,
    consumerId: task.consumerId,
    contractIds: task.contractIds,
    status: task.status,
    assignments: assignments.map(toAssignmentDto),
    merged: (task.merged as RwsOrchestrationRecord['merged']) ?? undefined,
    createdAt: (task.createdAt ?? new Date()).toISOString(),
    completedAt: task.completedAt?.toISOString(),
  };
}

export function toAssignmentDto(row: RwsAssignmentEntity): RwsTaskAssignment {
  return {
    assignmentId: row.assignmentId,
    taskId: row.taskId,
    providerId: row.providerId,
    purpose: row.purpose,
    analysis: row.analysis as unknown as RwsAnalysisSpec,
    contract: row.contract as unknown as ConnectorContractPayload,
    status: row.status,
    progress: (row.progress ?? []) as unknown as RwsProgressEvent[],
    aggregate: (row.aggregate as RwsTaskAssignment['aggregate']) ?? undefined,
    error: row.error ?? undefined,
    startedAt: row.startedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
  };
}

export function toPendingTask(row: RwsAssignmentEntity): ConnectorPendingTask {
  return {
    assignmentId: row.assignmentId,
    taskId: row.taskId,
    purpose: row.purpose,
    workloadType: 'rws',
    analysis: row.analysis as unknown as RwsAnalysisSpec,
    contract: row.contract as unknown as ConnectorContractPayload,
  };
}

export function appendProgress(
  progress: RwsProgressEvent[],
  stage: RwsProgressStage,
  detail?: string,
): RwsProgressEvent[] {
  return [...progress, { at: new Date().toISOString(), stage, detail }];
}

export function mergeAggregates(
  analysis: RwsAnalysisSpec,
  aggregates: NonNullable<RwsTaskAssignment['aggregate']>[],
): RwsTaskAssignment['aggregate'] {
  const counts = new Map<string, number>();
  let cohortSize = 0;
  for (const a of aggregates) {
    cohortSize += a.cohortSize;
    for (const b of a.buckets) counts.set(b.key, (counts.get(b.key) ?? 0) + b.count);
  }
  const n = cohortSize || 1;
  return {
    analysisType: aggregates[0]?.analysisType ?? analysis.type,
    cohortSize,
    buckets: [...counts.entries()]
      .map(([key, count]) => ({ key, count, rate: +(count / n).toFixed(4) }))
      .sort((a, b) => b.count - a.count),
  };
}

export function refreshTaskStatus(
  task: RwsTaskEntity,
  assignments: RwsAssignmentEntity[],
  analysis: RwsAnalysisSpec,
): void {
  const done = assignments.every((a) => a.status === 'completed' || a.status === 'failed');
  if (!done) {
    task.status = 'running';
    return;
  }

  const completed = assignments.filter((a) => a.status === 'completed');
  if (completed.length === assignments.length) {
    task.status = 'completed';
    task.merged = mergeAggregates(
      analysis,
      completed.map((a) => a.aggregate as NonNullable<RwsTaskAssignment['aggregate']>),
    );
  } else if (completed.length > 0) {
    task.status = 'partial';
    task.merged = mergeAggregates(
      analysis,
      completed.map((a) => a.aggregate as NonNullable<RwsTaskAssignment['aggregate']>),
    );
  } else {
    task.status = 'failed';
    task.merged = null;
  }
  task.completedAt = new Date();
}

export type { RwsAssignmentStatus, RwsOrchestrationStatus };
