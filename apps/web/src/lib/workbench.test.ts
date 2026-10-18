import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkbench, type WorkbenchSources } from "./workbench";
import type { TaskRow } from "./task-list";

const row = (taskId: string, myRole: TaskRow["myRole"], badge: TaskRow["badge"]) => ({ taskId, myRole, badge }) as TaskRow;
const sources: WorkbenchSources = {
  tasks: [
    row("a", "provider", "running"),
    row("b", "provider", "running"),
    row("c", "provider", "blocked"),
    row("d", "initiator", "running"),
    row("e", "initiator", "completed"),
    row("f", undefined, "running"),
  ],
  contracts: [
    { status: "draft", providerId: "p-hosp", consumerId: "p-pharma" },
    { status: "draft", providerId: "p-other", consumerId: "p-pharma" },
    { status: "active", providerId: "p-hosp", consumerId: "p-pharma" },
  ],
  alerts: [{ kind: { severity: "high" } }, { kind: { severity: "high" } }, { kind: { severity: "medium" } }],
  breaches: [{ status: "open" }, { status: "acknowledged" }],
  pendingCertifications: 4,
  // 站内信（D-NOTIF-1）：机构未读待办
  unreadNotifications: 3,
};
const counts = (role: string, me?: string, s = sources) =>
  Object.fromEntries(buildWorkbench(role, me, s).map((i) => [i.key, i.count]));

test("提供方：本院执行中 / 受阻的任务与待本院签发的合约，落点带分面", () => {
  assert.deepEqual(counts("provider", "p-hosp"), {
    "unread-notifications": 3,
    "inbound-running": 2,
    "inbound-blocked": 1,
    "contracts-to-issue": 1,
  });
  const items = buildWorkbench("provider", "p-hosp", sources);
  assert.equal(items[0].href, "/space#notifications");
  assert.equal(items[1].href, "/space/tasks?status=running&role=provider");
  assert.equal(items[3].href, "/space/contracts");
});

test("使用方：只数我发起的任务，按状态分项；合约数我方申请中的", () => {
  assert.deepEqual(counts("consumer", "p-pharma"), {
    "unread-notifications": 3,
    "mine-running": 1,
    "mine-blocked": 0,
    "mine-completed": 1,
    "contracts-pending": 2,
  });
});

test("合规方：高危告警与开放越限；运营方另加待审认证", () => {
  assert.deepEqual(counts("compliance"), { "high-alerts": 2, "open-breaches": 1, "unread-notifications": 3 });
  assert.deepEqual(counts("operator"), {
    "high-alerts": 2,
    "open-breaches": 1,
    "unread-notifications": 3,
    "pending-certifications": 4,
  });
  assert.equal(buildWorkbench("compliance", undefined, sources)[0].href, "/space/audit?view=alerts");
});

test("来源读取失败时计数为 null（未知），不是 0", () => {
  assert.deepEqual(counts("provider", "p-hosp", { tasks: sources.tasks }), {
    // 未读通知来源没给 → null（未知），不拿 0 冒充
    "unread-notifications": null,
    "inbound-running": 2,
    "inbound-blocked": 1,
    "contracts-to-issue": null,
  });
  assert.deepEqual(counts("operator", undefined, {}), {
    "high-alerts": null,
    "open-breaches": null,
    "unread-notifications": null,
    "pending-certifications": null,
  });
});

test("没有待办来源的角色不出待办项", () => {
  assert.deepEqual(buildWorkbench("admin", "p-x", sources), []);
  assert.deepEqual(buildWorkbench(undefined, undefined, sources), []);
});

test("不知道我方参与方时，合约项不误算成全部", () => {
  assert.equal(counts("provider", undefined)["contracts-to-issue"], 0);
});

test("站内信：所有绑定参与方的角色都有「未读通知」瓷贴，admin 没有", () => {
  for (const role of ["provider", "consumer", "compliance", "operator"]) {
    const item = buildWorkbench(role, "p-x", sources).find((i) => i.key === "unread-notifications");
    assert.ok(item, `${role} 应该有未读通知瓷贴`);
    assert.equal(item.count, 3);
    assert.equal(item.href, "/space#notifications");
  }
  assert.deepEqual(buildWorkbench("admin", "p-x", sources), []);
});
