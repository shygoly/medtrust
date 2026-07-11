import {
  assertMergedDpCompliance,
  assertPartyResultsDpCompliance,
  FlDpViolation,
} from "./fl-dp-gate";
import { ckdEsrdRiskFlPredictionSpec } from "./fl-prediction-task-spec";
import {
  buildMockFlPartyRunResult,
  mergeFlPartyResults,
} from "./fl-run-result";

describe("fl-dp-gate", () => {
  const spec = ckdEsrdRiskFlPredictionSpec();

  it("requires dpApplied on all parties when epsilon declared", () => {
    const raw = buildMockFlPartyRunResult("t1", "p-huashan", 50, 5);
    const party = { ...raw, dpApplied: undefined, dpEpsilon: undefined };
    expect(() => assertPartyResultsDpCompliance(spec, [party])).toThrow(
      FlDpViolation,
    );
  });

  it("merges when all parties applied DP within budget", () => {
    const parties = [
      buildMockFlPartyRunResult("t1", "p-huashan", 50, 5),
      buildMockFlPartyRunResult("t1", "p-ruijin", 40, 5),
    ];
    assertPartyResultsDpCompliance(spec, parties);
    const merged = mergeFlPartyResults(parties, spec);
    assertMergedDpCompliance(spec, merged);
    expect(merged.privacySummary.dpApplied).toBe(true);
  });
});
