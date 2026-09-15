import test from "node:test";
import assert from "node:assert/strict";
import { classifyRefreshStatus, isSessionRejected } from "./session-errors";

// 只有服务端明确拒绝凭证才算会话失效；网关 5xx（含 Cloudflare 52x）、限流、
// 网络断开都只是暂时不可用，不能清掉登录。

test("refresh: 2xx 视为刷新成功", () => {
  assert.equal(classifyRefreshStatus(200), "refreshed");
  assert.equal(classifyRefreshStatus(201), "refreshed");
});

test("refresh: 400/401/403 视为凭证被拒", () => {
  for (const s of [400, 401, 403]) assert.equal(classifyRefreshStatus(s), "rejected");
});

test("refresh: 429 与 5xx/52x 视为暂时不可用", () => {
  for (const s of [429, 500, 502, 503, 504, 520, 522, 524]) {
    assert.equal(classifyRefreshStatus(s), "unavailable");
  }
});

test("isSessionRejected: 只认 401/403", () => {
  assert.equal(isSessionRejected(Object.assign(new Error("x"), { status: 401 })), true);
  assert.equal(isSessionRejected(Object.assign(new Error("x"), { status: 403 })), true);
  assert.equal(isSessionRejected(Object.assign(new Error("x"), { status: 503 })), false);
  assert.equal(isSessionRejected(new TypeError("Failed to fetch")), false);
  assert.equal(isSessionRejected(undefined), false);
});
