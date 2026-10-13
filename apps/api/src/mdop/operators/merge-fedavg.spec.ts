import {
  buildMockFlPartyRunResult,
  mergeFlPartyResults,
} from "../../compute-task/dto/fl-run-result";
import { ckdEsrdRiskFlPredictionSpec } from "../../compute-task/dto/fl-prediction-task-spec";
import { mergeFedAvg } from "./merge-fedavg";

/**
 * L4 平台合并算子的对拍（批次 1A，change design D1/D2）。
 *
 * 等价性是**结构性**的：本算子直接调用旧链的 `mergeFlPartyResults`。所以这里钉的是
 * ①接线等价（deep-equal）②加权口径（样本量）③可复现性（modelHash / rounds）④拒绝混作业。
 */
describe("L4 平台合并算子 merge.fedavg（批次 1A）", () => {
  const spec = {
    ...ckdEsrdRiskFlPredictionSpec(),
    modelType: "logistic_regression" as const,
    aggregation: "fedavg" as const,
  };
  const a = buildMockFlPartyRunResult("fl-1", "p-demohospa", 300, 2);
  const b = buildMockFlPartyRunResult("fl-1", "p-demohospb", 100, 2);

  it("与旧链同一函数的结果逐字段一致（结构性等价）", () => {
    const viaMdop = mergeFedAvg({
      spec,
      parties: [
        { node: "p-demohospa", result: a },
        { node: "p-demohospb", result: b },
      ],
    });
    const viaLegacy = mergeFlPartyResults([a, b], spec, {
      runtime: "connector-ml",
    });
    expect(viaMdop).toEqual(viaLegacy);
  });

  it("聚合指标按样本量加权（300:100 = 3:1）", () => {
    const merged = mergeFedAvg({
      spec,
      parties: [
        { node: "a", result: a },
        { node: "b", result: b },
      ],
    });
    const expected =
      ((a.localMetrics.auc ?? 0) * 300 + (b.localMetrics.auc ?? 0) * 100) / 400;
    expect(merged.aggregateMetrics.auc).toBeCloseTo(expected, 10);
  });

  it("modelHash 可复现派生、轮次取最小值", () => {
    const merged = mergeFedAvg({
      spec,
      parties: [
        { node: "a", result: a },
        { node: "b", result: b },
      ],
    });
    expect(merged.modelHash).toBe(
      "FL:" + [a.localModelHash, b.localModelHash].sort().join("|"),
    );
    expect(merged.roundsCompleted).toBe(2);
  });

  it("空参与方与跨作业混入都拒绝（不静默合并）", () => {
    expect(() => mergeFedAvg({ spec, parties: [] })).toThrow(
      /没有任何参与方结果/,
    );
    const other = buildMockFlPartyRunResult("fl-2", "p-demohospc", 50, 1);
    expect(() =>
      mergeFedAvg({
        spec,
        parties: [
          { node: "a", result: a },
          { node: "c", result: other },
        ],
      }),
    ).toThrow(/同一作业/);
  });
});
