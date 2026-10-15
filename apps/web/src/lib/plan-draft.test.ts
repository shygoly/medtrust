import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addStage,
  emptyPlanDraft,
  fromTemplatePlan,
  moveStage,
  planHints,
  removeStage,
  stageIdHint,
  toPlanPayload,
  type PlanDraft,
  type PlanStageDraft,
} from "./plan-draft";

function draft(): PlanDraft {
  const d = emptyPlanDraft(new Date("2026-10-14T00:00:00Z"));
  return { ...d, purpose: "队列规模", contracts: ["c-1"] };
}

const stage = (id: string, from?: string): PlanStageDraft => ({
  id,
  op: "rws.categorical-count@1.0.0",
  inputs: from ? [{ from }] : [],
  params: { categoryKeys: ["40-49"] },
});

test("空计划：30 天时间窗，其余留空", () => {
  const d = emptyPlanDraft(new Date("2026-10-14T00:00:00Z"));
  assert.equal(d.stages.length, 0);
  assert.deepEqual(d.contracts, []);
  const days =
    (new Date(d.notAfter).getTime() - new Date(d.notBefore).getTime()) / 86400000;
  assert.equal(days, 30);
});

test("增删改：移动只影响顺序；删除列出悬空引用（提示，不阻止）", () => {
  let d = draft();
  d = addStage(d, stage("src"));
  d = addStage(d, stage("count", "src"));
  d = addStage(d, stage("dec", "count"));
  assert.deepEqual(d.stages.map((s) => s.id), ["src", "count", "dec"]);
  assert.deepEqual(moveStage(d, 0, 2).stages.map((s) => s.id), ["count", "dec", "src"]);
  const removed = removeStage(d, "src");
  assert.deepEqual(removed.draft.stages.map((s) => s.id), ["count", "dec"]);
  assert.deepEqual(removed.danglingRefs, ["count"]);
  // 追加是拷贝语义：原对象不变
  const before = d.stages.length;
  addStage(d, stage("x"));
  assert.equal(d.stages.length, before);
});

test("阶段 id 提示：空 / 非法字符 / 重名；合法返回 null", () => {
  const d = addStage(draft(), stage("src"));
  assert.match(stageIdHint(d, "")!, /不能为空/);
  assert.match(stageIdHint(d, "1bad")!, /字母开头/);
  assert.match(stageIdHint(d, "src")!, /已存在/);
  assert.equal(stageIdHint(d, "ok_1"), null);
});

test("表单提示：缺用途/合约/阶段/算子，时间窗倒挂", () => {
  const hints = planHints(emptyPlanDraft(new Date("2026-10-14T00:00:00Z")));
  assert.ok(hints.some((h) => h.includes("用途")));
  assert.ok(hints.some((h) => h.includes("合约")));
  assert.ok(hints.some((h) => h.includes("还没有阶段")));
  const bad = {
    ...draft(),
    stages: [{ ...stage("a"), op: "" }],
    notBefore: "2026-10-20T00:00:00Z",
    notAfter: "2026-10-14T00:00:00Z",
  };
  const h2 = planHints(bad);
  assert.ok(h2.some((h) => h.includes("未指定算子")));
  assert.ok(h2.some((h) => h.includes("结束时间不晚于")));
});

test("模板产出 -> 编辑器 -> 提交载荷：往返同形（任务 1.2 的可执行证明）", () => {
  const original = toPlanPayload({
    ...draft(),
    ethicsRef: "eth-1",
    stages: [
      {
        ...stage("src"),
        op: "source.dataset@1.0.0",
        params: { uri: "ds://h/dp" },
        at: "p-h1",
      },
      stage("count", "src"),
    ],
  });
  const back = fromTemplatePlan(original);
  assert.ok(back, "模板产出必须可编辑");
  assert.deepEqual(toPlanPayload(back!), original);
  // 形状不对就返回 null，不猜
  assert.equal(fromTemplatePlan({ stages: [{ id: "a" }] }), null);
  assert.equal(fromTemplatePlan(null), null);
});
