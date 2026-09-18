import test from "node:test";
import assert from "node:assert/strict";
import { isLanded, landedFirst, landingLabel, landingNote, landingTitle } from "./capability-landing";

// 编排页只允许选已落地(status=active)的能力对象;其余一律不可选(fail-closed)。

test("只有显式 active 算已落地;draft / deprecated / 缺省都不算", () => {
  assert.equal(isLanded({ status: "active" }), true);
  assert.equal(isLanded({ status: "draft" }), false);
  assert.equal(isLanded({ status: "deprecated" }), false);
  assert.equal(isLanded({}), false);
});

test("已落地排前,组内保持注册表原顺序", () => {
  const out = landedFirst([
    { key: "a", status: "draft" as const },
    { key: "b", status: "active" as const },
    { key: "c", status: "draft" as const },
    { key: "d", status: "active" as const },
  ]);
  assert.deepEqual(out.map((o) => o.key), ["b", "d", "a", "c"]);
});

test("标签按 status 区分未落地与已退役", () => {
  assert.equal(landingLabel({ status: "active" }), "已落地");
  assert.equal(landingLabel({ status: "draft" }), "未落地");
  assert.equal(landingLabel({ status: "deprecated" }), "已退役");
});

test("落地依据取 metadata.impl,空白或非字符串视为无", () => {
  assert.equal(landingNote({ metadata: { impl: " 连接器 CKKS 盲加 " } }), "连接器 CKKS 盲加");
  assert.equal(landingNote({ metadata: { impl: "  " } }), undefined);
  assert.equal(landingNote({ metadata: { impl: 1 } }), undefined);
  assert.equal(landingNote({ metadata: null }), undefined);
  assert.equal(landingTitle({ status: "draft", metadata: { impl: "仅软件 TEE" } }), "未落地 · 仅软件 TEE");
  assert.equal(landingTitle({ status: "active" }), "已落地");
});
