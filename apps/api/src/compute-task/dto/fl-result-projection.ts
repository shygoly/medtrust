import { FlRunResult } from "./fl-run-result";

/**
 * 将 FlRunResult 投影为 ComputeTask.resultSummary（含 UI 扁平字段 + 完整信封）。
 */
export function projectFlRunResultToTaskSummary(
  result: FlRunResult,
): Record<string, unknown> {
  return {
    workloadType: "federated_learning",
    flRunResult: result,
    roundsCompleted: result.roundsCompleted,
    totalRounds: result.totalRounds,
    modelHash: result.modelHash,
    modelType: result.modelType,
    objective: result.objective,
    auc: result.aggregateMetrics.auc,
    f1: result.aggregateMetrics.f1,
    precision: result.aggregateMetrics.precision,
    recall: result.aggregateMetrics.recall,
    accuracy: result.aggregateMetrics.accuracy,
    partyCount: result.partyContributions.length,
    attestationReportHash: result.attestation?.reportHash,
  };
}
