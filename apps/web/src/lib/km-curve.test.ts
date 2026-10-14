import assert from "node:assert/strict";
import test from "node:test";
import { kmRiskTable, kmSegments, kmTimeMax } from "./km-curve";

test("无抑制：一条连续段，按 t 升序", () => {
  const bins = [
    { t: 30, survival: 0.9, atRisk: 90 },
    { t: 0, survival: 1, atRisk: 100 },
    { t: 60, survival: 0.8, atRisk: 80 },
  ];
  const segs = kmSegments(bins);
  assert.equal(segs.length, 1);
  assert.deepEqual(
    segs[0].map((p) => p.t),
    [0, 30, 60],
  );
});

test("被抑制的区间**断开**成两段（不跨洞连线）", () => {
  const bins = [
    { t: 0, survival: 1, atRisk: 100 },
    { t: 30, survival: 0.9, atRisk: 90 },
    { t: 60, survival: 0.5, atRisk: 3, suppressed: true },
    { t: 90, survival: 0.7, atRisk: 70 },
  ];
  const segs = kmSegments(bins);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0].map((p) => p.t), [0, 30]);
  assert.deepEqual(segs[1].map((p) => p.t), [90]);
});

test("在险人数表保留被抑制区间（如实标注），时段上界取最大 t", () => {
  const bins = [
    { t: 30, survival: 0.9, atRisk: 90 },
    { t: 60, survival: 0.5, atRisk: 3, suppressed: true },
  ];
  assert.equal(kmRiskTable(bins).length, 2);
  assert.equal(kmRiskTable(bins)[1].suppressed, true);
  assert.equal(kmTimeMax(bins), 60);
});

test("空输入：没有段，上界为 0", () => {
  assert.deepEqual(kmSegments([]), []);
  assert.equal(kmTimeMax([]), 0);
});
