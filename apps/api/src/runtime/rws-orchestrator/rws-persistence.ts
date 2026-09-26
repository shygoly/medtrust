import {
  isPinnedModuleClause,
  pinnedModuleSm3,
} from "@medtrust/wasm-algorithms";
import {
  ConnectorContractPayload,
  ConnectorPendingTask,
  RwsAnalysisSpec,
  RwsMergedAggregate,
  RwsOrchestrationRecord,
  RwsPartyAggregate,
  RwsProgressEvent,
  RwsProgressStage,
  RwsTaskAssignment,
} from "./types";
import {
  RwsAssignmentEntity,
  RwsAssignmentStatus,
  RwsOrchestrationStatus,
  RwsTaskEntity,
  weakestExecutionIsolation,
} from "@medtrust/database";
import { mergeCausalEffectAggregates } from "./causal-effect-merge";
import { mergeComparativeEffectAggregates } from "./comparative-effect-merge";
import { mergeDisproportionalityAggregates } from "./disproportionality";
import type { MetaMergeOutcome } from "./meta-analysis.service";
import type { L0MergeOutcome } from "./l0-validation-merge";

/** Union of all per-analysis-type merge outcomes. RefreshTaskOptions carries
 * whichever one applies to the task being finalized. */
export type AnyMergeOutcome = MetaMergeOutcome | L0MergeOutcome;

export function toOrchestrationRecord(
  task: RwsTaskEntity,
  assignments: RwsAssignmentEntity[],
): RwsOrchestrationRecord {
  const merged =
    (task.merged as unknown as RwsOrchestrationRecord["merged"]) ?? undefined;
  const metaPooled = merged?.metaPooled;
  // L0 attestation is hoisted from merged.l0Validation.attestation, mirroring
  // the metaPooled hoist for L2/L3.
  const l0Validation = merged?.l0Validation as
    | {
        merged?: boolean;
        attestation?: { txHash: string; block: number; hash: string };
      }
    | undefined;
  const descriptiveAttestation = (
    merged as unknown as Record<string, unknown> | null
  )?.attestation as { txHash: string; block: number; hash: string } | undefined;
  return {
    taskId: task.taskId,
    title: task.title,
    purpose: task.purpose,
    analysis: task.analysis as unknown as RwsAnalysisSpec,
    consumerId: task.consumerId,
    contractIds: task.contractIds,
    status: task.status,
    assignments: assignments.map(toAssignmentDto),
    merged,
    attestation:
      metaPooled && metaPooled.merged
        ? metaPooled.attestation
        : l0Validation && l0Validation.merged
          ? l0Validation.attestation
          : descriptiveAttestation,
    protocolVersion: task.protocolVersion ?? 1,
    protocolWarnings:
      (task.protocolWarnings as unknown as string[] | undefined) ?? [],
    createdAt: (task.createdAt ?? new Date()).toISOString(),
    completedAt: task.completedAt?.toISOString(),
    // algorithm-sandbox:任务级取最弱(任一家无隔离 → 任务级无隔离)。
    executionIsolation: weakestExecutionIsolation(
      assignments
        .filter((a) => a.status === "completed")
        .map((a) => a.executionIsolation),
    ),
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
    aggregate:
      (row.aggregate as unknown as RwsTaskAssignment["aggregate"]) ?? undefined,
    error: row.error ?? undefined,
    startedAt: row.startedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    // 只有跑完的分派才有"实际执行隔离";未完成时不臆断(留空)。
    ...(row.status === "completed"
      ? {
          executionIsolation: row.executionIsolation ?? "none",
          moduleSm3: row.moduleSm3 ?? undefined,
          ...(readModuleAdmission(row)
            ? { moduleAdmission: readModuleAdmission(row)! }
            : {}),
          // 背书三件套齐全才显示 —— 入库时已验过签,故此处 verified 恒 true。
          ...(row.resultSm3 &&
          row.connectorResultSig &&
          row.connectorCertFingerprint
            ? {
                endorsement: {
                  resultSm3: row.resultSm3,
                  certFingerprint: row.connectorCertFingerprint,
                  verified: true as const,
                },
              }
            : {}),
        }
      : {}),
  };
}

/**
 * third-party-module-admission:从派发记录携带的合约条款里读出该模块的准入标注。
 * 只在实际跑了固定模块(moduleSm3 有值)时才标 —— 不臆断。
 */
function readModuleAdmission(
  row: RwsAssignmentEntity,
): RwsTaskAssignment["moduleAdmission"] | undefined {
  if (!row.moduleSm3) return undefined;
  const contract = row.contract as unknown as ConnectorContractPayload;
  const analysis = row.analysis as unknown as RwsAnalysisSpec;
  const spec = contract?.pinnedModules?.[analysis?.type];
  if (!spec) return undefined;
  if (isPinnedModuleClause(spec)) {
    return { tier: spec.tier, review: spec.review };
  }
  // 旧口径:纯 SM3 = 平台自研模块,按 Tier A 呈现,无第三方审查背书。
  return { tier: "A" };
}

export function toPendingTask(row: RwsAssignmentEntity): ConnectorPendingTask {
  const contract = row.contract as unknown as ConnectorContractPayload;
  const analysis = row.analysis as unknown as RwsAnalysisSpec;
  // third-party-module-admission:条款可能是纯 SM3(Tier A 旧口径)或
  // {sm3,tier,review}(Tier B)。派发只带 SM3——层级与背书随合约一起下发,
  // 连接器 PEP 从合约里读,不从派发里读(派发字段少一处可被改的地方)。
  const pinnedSpec = contract?.pinnedModules?.[analysis?.type];
  const pinnedSm3 = pinnedSpec ? pinnedModuleSm3(pinnedSpec) : undefined;
  return {
    assignmentId: row.assignmentId,
    taskId: row.taskId,
    purpose: row.purpose,
    workloadType: "rws",
    analysis,
    contract,
    ...(pinnedSm3
      ? { module: { analysisType: analysis.type, sm3: pinnedSm3 } }
      : {}),
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
  aggregates: RwsPartyAggregate[],
): RwsMergedAggregate {
  const counts = new Map<string, number>();
  let cohortSize = 0;
  for (const a of aggregates) {
    cohortSize += a.cohortSize;
    for (const b of a.buckets)
      counts.set(b.key, (counts.get(b.key) ?? 0) + b.count);
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

export interface RefreshTaskOptions {
  metaMerge?: AnyMergeOutcome;
}

function mergePartyAggregates(
  analysis: RwsAnalysisSpec,
  aggregates: RwsPartyAggregate[],
  options?: RefreshTaskOptions,
): RwsMergedAggregate {
  if (analysis.type === "comparative-effect") {
    return mergeComparativeEffectAggregates(
      analysis,
      aggregates,
      // Only MetaMergeOutcome reaches this branch (L0 routes below); the cast
      // preserves the existing merge helper's tighter signature.
      options?.metaMerge as Parameters<
        typeof mergeComparativeEffectAggregates
      >[2],
    );
  }
  if (analysis.type === "causal-psm" || analysis.type === "causal-survival") {
    return mergeCausalEffectAggregates(
      analysis,
      aggregates,
      options?.metaMerge as Parameters<typeof mergeCausalEffectAggregates>[2],
    );
  }
  if (analysis.type === "disproportionality") {
    return mergeDisproportionalityAggregates(analysis, aggregates);
  }
  if (analysis.type === "algorithm-validation") {
    // L0 carries no aggregate buckets to sum; the per-provider results +
    // attestation live on options.metaMerge (L0MergeOutcome). Persist that
    // collection as task.merged so consumers can read it directly.
    if (
      options?.metaMerge &&
      (options.metaMerge as L0MergeOutcome).kind === "l0_validation"
    ) {
      return {
        l0Validation: options.metaMerge,
      } as unknown as RwsMergedAggregate;
    }
    return { analysisType: "algorithm-validation", cohortSize: 0, buckets: [] };
  }
  return mergeAggregates(analysis, aggregates);
}

export function refreshTaskStatus(
  task: RwsTaskEntity,
  assignments: RwsAssignmentEntity[],
  analysis: RwsAnalysisSpec,
  options?: RefreshTaskOptions,
): void {
  const done = assignments.every(
    (a) => a.status === "completed" || a.status === "failed",
  );
  const completed = assignments.filter((a) => a.status === "completed");

  if (!done) {
    task.status = "running";
    if (analysis.type === "comparative-effect" && completed.length > 0) {
      task.merged = mergePartyAggregates(
        analysis,
        completed.map((a) => a.aggregate as unknown as RwsPartyAggregate),
        options,
      ) as unknown as Record<string, unknown>;
    }
    return;
  }

  if (completed.length === assignments.length) {
    task.status = "completed";
    task.merged = mergePartyAggregates(
      analysis,
      completed.map((a) => a.aggregate as unknown as RwsPartyAggregate),
      options,
    ) as unknown as Record<string, unknown>;
  } else if (completed.length > 0) {
    task.status = "partial";
    task.merged = mergePartyAggregates(
      analysis,
      completed.map((a) => a.aggregate as unknown as RwsPartyAggregate),
      options,
    ) as unknown as Record<string, unknown>;
  } else {
    task.status = "failed";
    task.merged = null;
  }
  task.completedAt = new Date();
}

export type { RwsAssignmentStatus, RwsOrchestrationStatus };
