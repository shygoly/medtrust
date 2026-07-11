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
    attestation: result.attestation,
    attestationReportHash: result.attestation?.reportHash,
    chainTxHash: result.attestation?.chainTxHash,
    warnings: result.warnings,
    // 4.3 — expose privacy summary / DP declaration so the result page can
    // verify differential privacy was actually applied (dpApplied=true).
    privacy: result.privacySummary,
    dpApplied: result.privacySummary?.dpApplied,
    dpEpsilon: result.privacySummary?.dpEpsilon,
    safeOutputOnly: result.privacySummary?.safeOutputOnly,
  };
}
