import assert from "node:assert/strict";
import { test } from "node:test";
import {
  registrationEffectText,
  registrationResultView,
} from "./registration-result-view";

const complete = () => ({
  analysisType: "external-control-registration",
  synthetic: true,
  estimand: "ATT",
  estimator: "IPTW-ATT",
  cohort: {
    trialN: 480,
    controlPoolN: 18000,
    analysisTrialN: 460,
    analysisControlN: 17500,
  },
  effect: {
    measure: "risk-ratio",
    estimate: 0.61,
    ciLow: 0.48,
    ciHigh: 0.78,
  },
  balance: [
    { covariate: "age", smdBefore: 0.42, smdAfter: 0.03 },
    { covariate: "severity", smdBefore: 0.55, smdAfter: 0.07 },
  ],
  overlap: {
    minPropensity: 0.02,
    maxPropensity: 0.91,
    trimmed: 12,
    eesTrial: 402.4,
    eesControl: 1190.7,
  },
  weights: {
    maxWeight: 4.8,
    p99Weight: 3.1,
    truncatedFraction: 0.013,
    effectiveSampleSize: 1593.1,
  },
  missingness: { mode: "MAR", missingFraction: 0.061, imputedN: 1060 },
  censoring: { observedN: 17920, censoredN: 1140, competingRiskN: 19 },
  sensitivity: [
    {
      id: "overlap-trimming",
      estimate: 0.64,
      ciLow: 0.51,
      ciHigh: 0.8,
      direction: "same-direction",
    },
  ],
  truthComparison: {
    rrTrue: 0.6,
    rrEstimated: 0.61,
    absoluteError: 0.01,
    withinExpectedRange: true,
  },
  study: {
    profileVersion: "registration-eca/1.0.0",
    timeZero: "treatment-start",
    estimandSapVersion: "sap-3",
  },
});

test("完整注册型 C3：保留诊断并固定合成数据边界", () => {
  const view = registrationResultView(complete());
  assert.ok(view);
  assert.equal(view.synthetic, true);
  assert.equal(view.estimand, "ATT");
  assert.equal(view.balance[1]?.smdAfter, 0.07);
  assert.equal(view.sensitivity[0]?.id, "overlap-trimming");
  assert.equal(view.truthComparison?.withinExpectedRange, true);
  assert.deepEqual(view.problems, []);
  assert.equal(
    registrationEffectText(view.effect),
    "RR 0.610（95% CI 0.480 – 0.780）",
  );
});

test("诊断缺失或矛盾时显式报告，不伪造零值或通过", () => {
  const payload = complete();
  delete (payload as Partial<ReturnType<typeof complete>>).overlap;
  payload.balance = [
    { covariate: "severity", smdBefore: 0.55, smdAfter: 0.18 },
  ];
  payload.effect.ciLow = 0.7;
  const view = registrationResultView(payload);
  assert.ok(view);
  assert.equal(view.overlap, null);
  assert.ok(view.problems.includes("缺少完整 overlap 诊断"));
  assert.ok(view.problems.includes("加权后仍有协变量 SMD > 0.1"));
  assert.ok(view.problems.includes("主分析点估计不在 95% 置信区间内"));
});

test("真实数据不要求答案键；非法基础形状返回 null", () => {
  const real = { ...complete(), synthetic: false };
  delete (real as Partial<ReturnType<typeof complete>>).truthComparison;
  const view = registrationResultView(real);
  assert.ok(view);
  assert.equal(view.truthComparison, null);
  assert.equal(
    view.problems.includes("合成数据演练缺少答案键真值对照"),
    false,
  );

  assert.equal(registrationResultView(null), null);
  assert.equal(
    registrationResultView({ ...complete(), analysisType: "external-control" }),
    null,
  );
  assert.equal(
    registrationResultView({
      ...complete(),
      effect: { measure: "hazard-ratio", estimate: 1, ciLow: 1, ciHigh: 1 },
    }),
    null,
  );
});
