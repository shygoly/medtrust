import {
  mergeFlPartyResults,
  type FlPartyRunResult,
} from "../../compute-task/dto/fl-run-result";

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

/**
 * 深度剔除 `undefined` 成员。
 *
 * 为什么必须在**算子边界**做：旧链共享函数 `mergeFlPartyResults` 的返回形状里有些成员天然缺席
 * （某指标无值 → `weightedMetric` 返回 `undefined`；spec 无隐私配置 → `dpEpsilon` 等为 `undefined`）。
 * 而 MDOP 的交付摘要用 **JCS 规范化**（`canonicalSm3`），JCS 明确拒绝 undefined 成员并抛
 * `CanonicalizationError` —— 2026-10-13 的 L4 端到端测试就是这么抓到合并链路会崩的。
 * 剔除它们**不改变交付语义**：JSON 传输本就会丢掉 undefined 成员，剔一遍只是让摘要与"真正被传输的字节"一致。
 * 不放松 canonicalizer（它的严格是对的），也不改旧链共享函数（那会动到 legacy 链的输出）。
 */
function dropUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value))
    return value.map((v) => dropUndefinedDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = dropUndefinedDeep(v);
    }
    return out as T;
  }
  return value;
}

export function mergeFedAvg(input: {
  /** 训练规格：基座只当**不透明值**透传（解释与校验在非基座的 `fl-run-result`）。 */
  spec: unknown;
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
  return dropUndefinedDeep(
    mergeFlPartyResults(
      input.parties.map((party) => party.result),
      input.spec,
      { runtime: "connector-ml" },
    ),
  );
}
