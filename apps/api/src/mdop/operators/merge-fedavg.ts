import {
  mergeFlPartyResults,
  type FlPartyRunResult,
} from "../../compute-task/dto/fl-run-result";
import type { FlPredictionTaskSpec } from "../../compute-task/dto/fl-prediction-task-spec";

/**
 * 平台合并算子 `merge.fedavg@1.0.0`（批次 1A：L4 联邦预测迁入 MDOP）。
 *
 * 合并口径**复用旧链同一函数** `mergeFlPartyResults`（样本量加权平均，见
 * `apps/api/src/compute-task/dto/fl-run-result.ts`）——与 L1.5 的合并算子复用同一计算模块同源，
 * 因此等价性是**结构性**的；本算子只做接线与输入校验，不改数字。
 * 出域仍受合约 `outputPolicy.allowedArtifacts`（`aggregate_and_model`）与 D-MDOP-2 接收方约束。
 */
export interface FedAvgParty {
  node: string;
  result: FlPartyRunResult;
}

export function mergeFedAvg(input: {
  spec: FlPredictionTaskSpec;
  parties: FedAvgParty[];
}): ReturnType<typeof mergeFlPartyResults> {
  if (!input.parties || input.parties.length === 0) {
    throw new Error("合并阶段没有任何参与方结果");
  }
  for (const party of input.parties) {
    if (party.result.taskId !== input.parties[0].result.taskId) {
      throw new Error(
        "合并阶段只接受同一作业的参与方结果（taskId 不一致：" +
          party.result.taskId +
          " vs " +
          input.parties[0].result.taskId +
          "）",
      );
    }
  }
  return mergeFlPartyResults(
    input.parties.map((party) => party.result),
    input.spec,
    { runtime: "connector-ml" },
  );
}
