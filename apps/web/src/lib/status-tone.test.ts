import test from "node:test";
import assert from "node:assert/strict";
import { statusTone } from "./status-tone";

test("已登记的状态映射到各自的语义", () => {
  assert.equal(statusTone("active"), "ok");
  assert.equal(statusTone("approved"), "ok");
  assert.equal(statusTone("pending"), "attention");
  assert.equal(statusTone("submitted"), "attention");
  assert.equal(statusTone("disabled"), "blocked");
  assert.equal(statusTone("rejected"), "blocked");
  assert.equal(statusTone("revoked"), "blocked");
});

test("大小写不敏感；未登记、空值一律中性，不冒充正常", () => {
  assert.equal(statusTone("ACTIVE"), "ok");
  assert.equal(statusTone("draft"), "neutral");
  assert.equal(statusTone("something-new"), "neutral");
  assert.equal(statusTone(undefined), "neutral");
  assert.equal(statusTone(null), "neutral");
});
