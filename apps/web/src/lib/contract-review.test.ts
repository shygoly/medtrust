import test from "node:test";
import assert from "node:assert/strict";
import {
  appliedAt,
  defaultFacet,
  facetCounts,
  facetOf,
  formatTime,
  mdopHint,
  orgLabel,
  personLabel,
  preReviewLabel,
  reviewStateLabel,
  reviewStateOf,
  type ContractRow,
} from "./contract-review";

// 审核页最易漂的两件事：revoked 同时承担「驳回/解除」，以及「未记录」不能假装有值。

function row(over: Partial<ContractRow> = {}): ContractRow {
  return {
    id: "c1",
    dataProductId: "dp-1",
    providerId: "p-demohospa",
    consumerId: "p-meddata",
    purpose: "药物警戒",
    ...over,
  };
}

test("draft / active / expired 归一", () => {
  assert.equal(reviewStateOf(row({ status: "draft" })), "pending");
  assert.equal(reviewStateOf(row({ status: "active" })), "active");
  assert.equal(reviewStateOf(row({ status: "active", effectiveStatus: "expired" })), "expired");
  // effectiveStatus 优先于 status（服务端惰性算过期）
  assert.equal(reviewStateOf(row({ status: "draft", effectiveStatus: "expired" })), "expired");
});

test("revoked 按留痕拆成「已驳回」/「已撤回」/「已解除」/「未记录」", () => {
  assert.equal(reviewStateOf(row({ status: "revoked", decision: { outcome: "rejected" } })), "rejected");
  assert.equal(reviewStateOf(row({ status: "revoked", decision: { outcome: "withdrawn" } })), "withdrawn");
  assert.equal(reviewStateOf(row({ status: "revoked", revocation: { at: "2026-11-01T00:00:00Z" } })), "terminated");
  assert.equal(reviewStateOf(row({ status: "revoked" })), "revoked-legacy");
  assert.equal(reviewStateLabel(row({ status: "revoked" })).label, "已撤销（未记录原因）");
  assert.equal(reviewStateLabel(row({ status: "revoked", decision: { outcome: "withdrawn" } })).label, "已撤回");
});

test("legacy revoked 并入「已解除」分面，不会在任何分面里消失", () => {
  assert.equal(facetOf(row({ status: "revoked" })), "terminated");
  const counts = facetCounts([
    row({ id: "a", status: "draft" }),
    row({ id: "b", status: "revoked" }),
    row({ id: "c", status: "revoked", decision: { outcome: "rejected" } }),
    row({ id: "d", status: "revoked", decision: { outcome: "withdrawn" } }),
  ]);
  assert.deepEqual(counts, {
    pending: 1,
    active: 0,
    rejected: 1,
    withdrawn: 1,
    terminated: 1,
    expired: 0,
  });
});

test("默认分面：有待审批先看待办，否则看已生效", () => {
  const pending = [row({ status: "draft" }), row({ id: "b", status: "active" })];
  assert.equal(defaultFacet("provider", pending), "pending");
  assert.equal(defaultFacet("consumer", pending), "pending");
  assert.equal(defaultFacet("provider", [row({ status: "active" })]), "active");
  assert.equal(defaultFacet("consumer", [row({ status: "active" })]), "active");
});

test("机构名查不到回退 slug；人不编造", () => {
  assert.equal(orgLabel("示范甲医院", "p-demohospa"), "示范甲医院");
  assert.equal(orgLabel(null, "p-demohospa"), "p-demohospa");
  assert.equal(orgLabel("  ", "p-demohospa"), "p-demohospa");
  assert.equal(personLabel("李主任", "li@demo.example"), "李主任 <li@demo.example>");
  assert.equal(personLabel(null, "li@demo.example"), "li@demo.example");
  assert.equal(personLabel("李主任", null), "李主任");
  assert.equal(personLabel(null, null), null);
});

test("时间：本地 YYYY-MM-DD HH:mm；无值返回 null（界面显示未记录）", () => {
  assert.match(formatTime("2026-11-06T02:03:00Z")!, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(formatTime(undefined), null);
  assert.equal(formatTime("not-a-date"), null);
  assert.equal(appliedAt(row({ createdAt: "2026-11-06T02:03:00Z" })), formatTime("2026-11-06T02:03:00Z"));
  assert.equal(appliedAt(row({ requestedBy: { at: "2026-11-05T01:00:00Z" }, createdAt: "2026-11-06T02:03:00Z" })), formatTime("2026-11-05T01:00:00Z"));
});

test("MDOP 未签完时给次级提示，不把「网页签发」说成已签署", () => {
  assert.equal(mdopHint(row({ status: "active", mdopStatus: "unsigned" })), "待院方连接器签署");
  assert.equal(mdopHint(row({ status: "active", mdopStatus: "offered" })), "已发出要约，待院方连接器签署");
  assert.equal(mdopHint(row({ status: "active", mdopStatus: "agreed" })), null);
  assert.equal(mdopHint(row({ status: "active", mdopStatus: null })), null);
  assert.equal(mdopHint(row({ status: "draft", mdopStatus: "unsigned" })), null);
});

test("预审裁决枚举 → 中文", () => {
  assert.equal(preReviewLabel("auto_approve"), "批准");
  assert.equal(preReviewLabel("manual_review"), "需审批");
  assert.equal(preReviewLabel("block"), "驳回");
  assert.equal(preReviewLabel(undefined), null);
});
