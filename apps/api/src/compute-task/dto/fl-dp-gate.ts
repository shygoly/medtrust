import { FlPredictionTaskSpec } from "./fl-prediction-task-spec";
import { FlPartyRunResult, FlRunResult } from "./fl-run-result";

export class FlDpViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlDpViolation";
  }
}

/** 合并前校验各方已按声明 ε 加噪 (任务 6.2). */
export function assertPartyResultsDpCompliance(
  spec: FlPredictionTaskSpec,
  partyResults: FlPartyRunResult[],
): void {
  const epsilon = spec.privacy?.dpEpsilon;
  if (epsilon === undefined) return;
  for (const party of partyResults) {
    if (!party.dpApplied) {
      throw new FlDpViolation(
        `提供方 ${party.participantId} 未施加差分隐私噪声,拒绝合并`,
      );
    }
    if (party.dpEpsilon !== undefined && party.dpEpsilon > epsilon + 1e-9) {
      throw new FlDpViolation(
        `提供方 ${party.participantId} ε=${party.dpEpsilon} 超出任务预算 ${epsilon}`,
      );
    }
  }
}

/** 合并后信封须反映 DP 已应用. */
export function assertMergedDpCompliance(
  spec: FlPredictionTaskSpec,
  result: FlRunResult,
): void {
  const epsilon = spec.privacy?.dpEpsilon;
  if (epsilon === undefined) return;
  if (!result.privacySummary.dpApplied) {
    throw new FlDpViolation("合并结果未标记 dpApplied,拒绝出域");
  }
}
