import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSIGNABLE_ROLES,
  NAV_ICONS,
  ROLES,
  breadcrumbs,
  canAccess,
  matchEntry,
  menuAncestor,
  menuFor,
  navGroups,
  searchCommands,
  sectionHref,
  sectionOf,
} from "./nav";

const routesFor = (role: string | undefined) => menuFor(role).flatMap((g) => g.items.map((i) => i.route));

test("静态段优先于动态段", () => {
  assert.equal(matchEntry("/space/tasks/new")?.route, "/space/tasks/new");
  assert.equal(matchEntry("/space/tasks/rws-31")?.route, "/space/tasks/[id]");
  assert.equal(matchEntry("/space/atlas/compose")?.route, "/space/atlas/compose");
  assert.equal(matchEntry("/space/atlas/L3")?.route, "/space/atlas/[layer]");
});

test("查询串与尾斜杠不影响匹配；未登记路径返回 undefined", () => {
  assert.equal(matchEntry("/space/tasks/rws-31?workload=rws")?.route, "/space/tasks/[id]");
  assert.equal(matchEntry("/space/audit/")?.route, "/space/audit");
  assert.equal(matchEntry("/space/infer"), undefined);
});

test("详情与表单页回溯到所属菜单项", () => {
  assert.equal(menuAncestor(matchEntry("/space/tasks/new/rws"))?.route, "/space/tasks");
  assert.equal(menuAncestor(matchEntry("/space/infer/t-1"))?.route, "/space/tasks");
  assert.equal(menuAncestor(matchEntry("/space/atlas/L3"))?.route, "/space/atlas");
  assert.equal(menuAncestor(matchEntry("/space/atlas/yaml"))?.route, "/space/atlas/yaml");
});

test("按角色出菜单：受限项只对声明的角色可见", () => {
  assert.ok(!routesFor("provider").includes("/space/audit"));
  assert.ok(routesFor("compliance").includes("/space/audit"));
  assert.ok(routesFor("admin").includes("/space/admin/system"));
  assert.ok(!routesFor("operator").includes("/space/admin/system"));
});

test("丝路数港互认对 operator 与 admin 都可见（与服务端一致）", () => {
  assert.ok(routesFor("operator").includes("/space/admin/interop"));
  assert.ok(routesFor("admin").includes("/space/admin/interop"));
});

test("未分配角色只看得到不限角色的页面", () => {
  const audit = matchEntry("/space/audit")!;
  assert.equal(canAccess(audit, undefined), false);
  assert.equal(canAccess(matchEntry("/space/catalog")!, undefined), true);
});

test("可分配角色不含平台管理员（只能在服务器侧授予）", () => {
  assert.deepEqual(ASSIGNABLE_ROLES, ["provider", "consumer", "operator", "compliance"]);
});

test("分区的图标名都在 NAV_ICONS 中", () => {
  for (const group of navGroups) {
    assert.ok((NAV_ICONS as readonly string[]).includes(group.icon), `${group.id} 图标未登记：${group.icon}`);
  }
});

test("任一角色的侧栏入口不超过 6 个，且每个入口都指向其可见页面", () => {
  for (const role of [...ROLES, undefined]) {
    const sections = menuFor(role);
    assert.ok(sections.length <= 6, `${role} 可见 ${sections.length} 个分区`);
    for (const { group } of sections) {
      const entry = matchEntry(sectionHref(group.id, role)!);
      assert.ok(entry && canAccess(entry, role), `${role} 的 ${group.id} 入口不可访问`);
    }
  }
});

test("分区入口取当前角色可见的第一个页面；平台分区对业务角色不出现", () => {
  assert.equal(sectionHref("compliance", "provider"), "/space/attestations");
  assert.equal(sectionHref("compliance", "compliance"), "/space/compliance");
  assert.equal(sectionHref("platform", "admin"), "/space/admin/system");
  assert.equal(sectionHref("platform", "operator"), "/space/admin/users");
  assert.equal(sectionHref("platform", "consumer"), undefined);
});

test("详情与表单页归属其菜单祖先的分区", () => {
  assert.equal(sectionOf(matchEntry("/space/infer/t-1"))?.id, "research");
  assert.equal(sectionOf(matchEntry("/space/atlas/L3"))?.id, "declare");
  assert.equal(sectionOf(matchEntry("/space/settlements"))?.id, "data");
});

test("面包屑：详情页一次点击回列表，当前页带对象 ID 且不可点", () => {
  assert.deepEqual(breadcrumbs("/space/mdop/jobs/job-7", "consumer"), [
    { label: "研究与任务", href: "/space/tasks" },
    { label: "编排任务", href: "/space/tasks" },
    { label: "作业详情", detail: "job-7" },
  ]);
});

test("面包屑：父级路径不同名参数时复用 ID，并带上回程查询串", () => {
  const crumbs = breadcrumbs("/space/infer/t%2F1?contractId=c-1", "consumer");
  assert.deepEqual(crumbs.map((c) => c.label), ["研究与任务", "编排任务", "任务详情", "本地推理"]);
  assert.equal(crumbs[2].href, "/space/tasks/t%2F1?workload=fl_prediction");
  assert.equal(crumbs[3].href, undefined);
  assert.equal(crumbs[3].detail, "t/1");
});

test("面包屑：多级静态表单页逐级可回", () => {
  assert.deepEqual(breadcrumbs("/space/tasks/new/rws", "consumer").map((c) => c.href), [
    "/space/tasks",
    "/space/tasks",
    "/space/tasks/new",
    undefined,
  ]);
});

test("发起任务的表单只对 consumer 可见", () => {
  assert.equal(canAccess(matchEntry("/space/tasks/new/rws")!, "provider"), false);
  assert.equal(canAccess(matchEntry("/space/tasks/new/fl-prediction")!, "consumer"), true);
});

test("命令：按名称与分区检索，只列当前角色可见的页面", () => {
  assert.deepEqual(searchCommands("provider", "结算").map((c) => c.href), ["/space/settlements"]);
  assert.deepEqual(searchCommands("provider", "审计"), []);
  assert.ok(searchCommands("compliance", "审计").some((c) => c.href === "/space/audit"));
  assert.ok(searchCommands("operator", "平台").every((c) => c.hint === "平台"));
});

test("命令：被合并页面的旧名称仍可检索，指向新地址；无权访问目标页的角色看不到", () => {
  assert.deepEqual(searchCommands("provider", "联邦密算").map((c) => c.href), ["/space/tasks?channel=secretflow"]);
  assert.deepEqual(searchCommands("consumer", "MDOP").map((c) => c.href), ["/space/tasks?channel=mdop"]);
  assert.deepEqual(searchCommands("compliance", "合规告警").map((c) => c.href), ["/space/audit?view=alerts"]);
  assert.deepEqual(searchCommands("provider", "合规告警"), []);
});

test("命令：发起类动作与全局助手入口按角色出现", () => {
  const actions = (role: string) => searchCommands(role, "").filter((c) => c.kind === "action").map((c) => c.href);
  assert.deepEqual(actions("consumer"), [
    "/space/assistant",
    "/space/tasks/new",
    "/space/tasks/new/rws",
    "/space/tasks/new/registration",
    "/space/tasks/new/fl-prediction",
  ]);
  assert.deepEqual(actions("provider"), ["/space/catalog/new", "/space/assistant"]);
});

test("命令：不匹配任何命令的输入当作对象 ID，给出可见的详情页", () => {
  const open = searchCommands("provider", "job-muxx/1");
  assert.deepEqual(open.map((c) => c.href), [
    "/space/catalog/job-muxx%2F1",
    "/space/tasks/job-muxx%2F1",
    "/space/mdop/jobs/job-muxx%2F1",
    "/space/federated/job-muxx%2F1",
  ]);
});
