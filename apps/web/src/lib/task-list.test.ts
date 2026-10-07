import test from "node:test";
import assert from "node:assert/strict";
import { filterTaskRows, parseTaskFacets, taskHrefIndex, taskListHref, toTaskRows, type TaskSources } from "./task-list";

const sources = {
  rws: [
    { taskId: "rws-1", title: "队列统计", purpose: "RWE", status: "completed", consumerId: "p-pharma", createdAt: "2026-10-01T00:00:00Z", assignments: [{}, {}], merged: { cohortSize: 120 }, analysis: { type: "cohort" } },
    { taskId: "rws-2", title: "失衡信号", purpose: "PV", status: "running", consumerId: "p-other", createdAt: "2026-10-03T00:00:00Z", assignments: [{}], analysis: { type: "disproportionality" } },
  ],
  fl: [
    { taskId: "fl-1", title: "胰腺炎风险", purpose: "预测", status: "failed", consumerId: "p-pharma", createdAt: "2026-10-02T00:00:00Z", assignments: [{}], flPredictionSpec: { modelType: "lr", targetColumn: "ap" } },
  ],
  secretflow: [{ taskId: "sf/1", state: "COMPLETED", purpose: "CKD", createdAt: "2026-10-04T00:00:00Z", consumerId: "p-pharma", providerCount: 3 }],
  mdopJobs: [{ id: "job-1", purpose: "疫苗 SCRI", status: "completed", createdAt: "2026-10-05T00:00:00Z" }, { id: "job-2", status: "awaiting_signatures" }],
} as unknown as TaskSources;

test("五个来源映射成同一行模型，按创建时间倒序，各自链接到所属通道的详情", () => {
  const rows = toTaskRows(sources, { participantId: "p-pharma" });
  assert.deepEqual(rows.map((r) => r.taskId), ["job-1", "sf/1", "rws-2", "fl-1", "rws-1", "job-2"]);
  const href = Object.fromEntries(rows.map((r) => [r.taskId, r.href]));
  assert.equal(href["rws-1"], "/space/tasks/rws-1?workload=rws");
  assert.equal(href["fl-1"], "/space/tasks/fl-1?workload=fl_prediction");
  assert.equal(href["sf/1"], "/space/federated/sf%2F1");
  assert.equal(href["job-1"], "/space/mdop/jobs/job-1");
});

test("状态归一：各通道的状态词映射到进行中 / 已完成 / 受阻", () => {
  const badge = Object.fromEntries(toTaskRows(sources).map((r) => [r.taskId, r.badge]));
  assert.deepEqual(badge, { "rws-1": "completed", "rws-2": "running", "fl-1": "blocked", "sf/1": "completed", "job-1": "completed", "job-2": "running" });
});

test("我方角色：我方发起的任务标 initiator，他人发起的与无归属的 MDOP 作业为空", () => {
  const role = Object.fromEntries(toTaskRows(sources, { participantId: "p-pharma" }).map((r) => [r.taskId, r.myRole]));
  assert.equal(role["rws-1"], "initiator");
  assert.equal(role["rws-2"], undefined);
  assert.equal(role["job-1"], undefined);
});

test("提供方入站分派：标 provider，带本院进度；与任务列表重复时以入站行为准", () => {
  const inbox = [
    { kind: "rws", assignmentId: "a-1", taskId: "rws-2", title: "失衡信号", purpose: "PV", consumerId: "p-other", workloadLabel: "L1.5", contractId: "c-1", status: "running", latestProgress: { at: "", stage: "院内执行", detail: "输出闸门" }, createdAt: "2026-10-03T00:00:00Z" },
    { kind: "fl_prediction", assignmentId: "a-2", taskId: "fl-9", title: "", purpose: "预测", consumerId: "p-x", workloadLabel: "L4", contractId: "c-2", status: "failed", error: "合约已撤销", createdAt: "2026-10-06T00:00:00Z" },
  ];
  const rows = toTaskRows({ ...sources, inbox } as unknown as TaskSources, { participantId: "p-huashan" });
  assert.equal(rows.filter((r) => r.taskId === "rws-2").length, 1);
  const rws2 = rows.find((r) => r.taskId === "rws-2")!;
  assert.equal(rws2.myRole, "provider");
  assert.equal(rws2.statusLabel, "执行中");
  assert.equal(rws2.summary, "院内执行 · 输出闸门");
  const fl9 = rows.find((r) => r.taskId === "fl-9")!;
  assert.deepEqual([fl9.title, fl9.badge, fl9.summary, fl9.href], ["预测", "blocked", "合约已撤销", "/space/tasks/fl-9?workload=fl_prediction"]);
});

test("来源缺失（未请求或读取失败）不影响其余来源", () => {
  assert.deepEqual(toTaskRows({ mdopJobs: sources.mdopJobs }).map((r) => r.channel), ["mdop", "mdop"]);
  assert.deepEqual(toTaskRows({}), []);
});

test("账本反查：按任务 ID 找到所属通道的详情地址，找不到返回 undefined", () => {
  const index = taskHrefIndex(toTaskRows(sources));
  assert.equal(index.get("sf/1"), "/space/federated/sf%2F1");
  assert.equal(index.get("fl-1"), "/space/tasks/fl-1?workload=fl_prediction");
  assert.equal(index.get("unknown"), undefined);
});

test("分面：从查询串解析，闭集外的取值忽略", () => {
  const facets = parseTaskFacets(new URLSearchParams("channel=mdop&status=done&role=provider&x=1"));
  assert.deepEqual(facets, { channel: "mdop", status: undefined, role: "provider" });
});

test("分面：按通道、状态、我方角色组合筛选", () => {
  const rows = toTaskRows(sources, { participantId: "p-pharma" });
  assert.deepEqual(filterTaskRows(rows, { channel: "mdop" }).map((r) => r.taskId), ["job-1", "job-2"]);
  assert.deepEqual(filterTaskRows(rows, { status: "completed", role: "initiator" }).map((r) => r.taskId), ["sf/1", "rws-1"]);
  assert.equal(filterTaskRows(rows, {}).length, rows.length);
});

test("分面地址：参数顺序固定，无分面时是裸地址，解析与构造互逆", () => {
  assert.equal(taskListHref(), "/space/tasks");
  assert.equal(taskListHref({ role: "provider", channel: "rws" }), "/space/tasks?channel=rws&role=provider");
  const href = taskListHref({ channel: "secretflow", status: "running" });
  assert.deepEqual(parseTaskFacets(new URLSearchParams(href.split("?")[1])), { channel: "secretflow", status: "running", role: undefined });
});
