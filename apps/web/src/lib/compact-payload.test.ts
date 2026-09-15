import test from "node:test";
import assert from "node:assert/strict";
import { compactPayload } from "./compact-payload";

// 后端校验"可选字段要么不传、要么非空"，表单里留空的输入框必须在任意层级剔除。

test("剔除嵌套 SAP 里的空字符串（L2 表单留空多重性校正）", () => {
  const out = compactPayload({
    type: "comparative-effect",
    sap: { significanceLevel: 0.05, multiplicityAlphaAdjustment: "", sampleSizeJustification: "x" },
  });
  assert.deepEqual(out, {
    type: "comparative-effect",
    sap: { significanceLevel: 0.05, sampleSizeJustification: "x" },
  });
});

test("0 与 false 是有效值，保留", () => {
  assert.deepEqual(compactPayload({ a: 0, b: false, c: "" }), { a: 0, b: false });
});

test("剔除 undefined、空数组，以及剔空后变成空对象的字段", () => {
  assert.deepEqual(
    compactPayload({ tte: undefined, inclusion: [], sap: { note: "" }, keep: ["x", ""] }),
    { keep: ["x"] },
  );
});
