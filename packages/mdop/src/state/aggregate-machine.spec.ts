import {
  acceptContribution,
  expireAggregate,
  noteAggregateFinished,
  rejectAggregate,
  startAggregating,
  type AggregateMachineState,
} from "./aggregate-machine";

function pending(): AggregateMachineState {
  return {
    phase: "PENDING",
    parties: ["node-a", "node-b"],
    received: [],
    finished: [],
    deadlineMs: 1_000,
  };
}

describe("aggregate machine", () => {
  it("收齐两方贡献后进入 AGGREGATED，再双方完成后 SUCCEEDED", () => {
    const started = startAggregating(pending(), 0);
    const one = acceptContribution(started, "node-a", 10);
    expect(one.phase).toBe("AGGREGATING");
    const both = acceptContribution(one, "node-b", 20);
    expect(both.phase).toBe("AGGREGATED");
    expect(both.received).toEqual(["node-a", "node-b"]);
    const done = noteAggregateFinished(
      noteAggregateFinished(both, "node-a"),
      "node-b",
    );
    expect(done.phase).toBe("SUCCEEDED");
  });

  it("超时缺一方则 REJECTED，不把已提交方当成结果", () => {
    const started = startAggregating(pending(), 0);
    const one = acceptContribution(started, "node-a", 10);
    const expired = expireAggregate(one, 1_001);
    expect(expired.phase).toBe("REJECTED");
    expect(expired.received).toEqual(["node-a"]);
    expect(acceptContribution(expired, "node-b", 1_002).phase).toBe("REJECTED");
  });

  it("解密失败拒绝整个聚合", () => {
    const started = startAggregating(pending(), 0);
    const both = acceptContribution(acceptContribution(started, "node-a", 1), "node-b", 2);
    expect(rejectAggregate(both).phase).toBe("REJECTED");
  });
});