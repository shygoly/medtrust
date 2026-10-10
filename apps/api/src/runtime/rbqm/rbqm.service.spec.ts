import { evaluateBreach } from "./rbqm.service";
import { SEED_KRI_DEFINITIONS } from "./kri-catalog";
import type { QtlThreshold } from "@medtrust/database";

/**
 * QTL 越限检测（rbqm-central-monitoring）单元验收：
 * 方向语义（higher/lower_worse）、分层取最严重、未越限不产生记录。
 * 测纯函数 evaluateBreach，无需 DB。
 */

const HL: QtlThreshold[] = [
  { level: "warning", op: "gte", value: 0.25 },
  { level: "critical", op: "gte", value: 0.4 },
];
const LL: QtlThreshold[] = [
  { level: "warning", op: "lte", value: 0.8 },
  { level: "critical", op: "lte", value: 0.6 },
];

describe("evaluateBreach", () => {
  it("higher_worse: value at/above critical → critical", () => {
    const hit = evaluateBreach("higher_worse", HL, 0.42);
    expect(hit?.level).toBe("critical");
    expect(hit?.value).toBe(0.4);
  });

  it("higher_worse: value in warning band → warning", () => {
    const hit = evaluateBreach("higher_worse", HL, 0.3);
    expect(hit?.level).toBe("warning");
  });

  it("higher_worse: value below all thresholds → no breach", () => {
    expect(evaluateBreach("higher_worse", HL, 0.1)).toBeNull();
  });

  it("lower_worse: value at/below critical → critical", () => {
    const hit = evaluateBreach("lower_worse", LL, 0.55);
    expect(hit?.level).toBe("critical");
  });

  it("lower_worse: value in warning band → warning", () => {
    const hit = evaluateBreach("lower_worse", LL, 0.75);
    expect(hit?.level).toBe("warning");
  });

  it("picks the most severe level when multiple thresholds match", () => {
    // 0.9 matches both warning(gte .25) and critical(gte .4) → critical
    const hit = evaluateBreach("higher_worse", HL, 0.9);
    expect(hit?.level).toBe("critical");
  });

  it("no thresholds → never a breach", () => {
    expect(evaluateBreach("higher_worse", null, 1)).toBeNull();
    expect(evaluateBreach("higher_worse", [], 1)).toBeNull();
  });

  it("seeded AE_SUBJECT_RATE fixture breaches as designed (示范甲 0.42 critical, 示范乙 0.276 warning)", () => {
    const ae = SEED_KRI_DEFINITIONS.find((d) => d.code === "AE_SUBJECT_RATE")!;
    expect(evaluateBreach(ae.direction, ae.thresholds, 53 / 126)?.level).toBe(
      "critical",
    );
    expect(evaluateBreach(ae.direction, ae.thresholds, 27 / 98)?.level).toBe(
      "warning",
    );
  });
});
