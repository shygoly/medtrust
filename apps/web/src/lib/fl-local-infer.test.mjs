import assert from "node:assert/strict";
import test from "node:test";
import { encodePancreatitisForm, scoreWeightBundle } from "./fl-local-infer.ts";

test("encodePancreatitisForm aligns to featureNames", () => {
  const names = [
    "ageBand=50-59",
    "ageBand=60-69",
    "sex=male",
    "sex=female",
    "exposed_insulin",
  ];
  const v = encodePancreatitisForm(
    { ageBand: "50-59", sex: "male", exposed_insulin: true },
    names,
  );
  assert.deepEqual(v, [1, 0, 1, 0, 1]);
});

test("scoreWeightBundle rises with insulin coefficient", () => {
  const bundle = {
    taskId: "t1",
    featureSchemaVersion: "pancreatitis-risk-v1",
    featureNames: ["ageBand=50-59", "sex=male", "exposed_insulin"],
    theta: [0, 0, 2],
    intercept: -1,
    modelHash: "FL:x",
    trainedOnSynthetic: true,
    sampleCount: 100,
  };
  const p0 = scoreWeightBundle(bundle, {
    ageBand: "50-59",
    sex: "male",
    exposed_insulin: false,
  });
  const p1 = scoreWeightBundle(bundle, {
    ageBand: "50-59",
    sex: "male",
    exposed_insulin: true,
  });
  assert.ok(p1 > p0);
});
