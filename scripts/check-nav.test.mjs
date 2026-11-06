// 导航契约守护的**负例自检**：把一份合法输入逐条改坏，断言「改坏会被抓住」，并断言合法写法不被误伤。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findLiteralPageTitles, findPageRoleGates, loadInput, resolveGuard, runNavCheck } from './check-nav.mjs';

const SPACE = 'apps/web/src/app/(console)/space';

const AUDIT_CONTROLLER = `
@Controller("audit")
@UseGuards(JwtAuthGuard, ParticipantRolesGuard)
export class AuditController {
  @Post()
  async create(@Body() dto: any) {}

  @Get()
  @ParticipantRoles("compliance", "operator")
  @ApiOperation({ summary: "查询" })
  async findAll(@Query() q: any) {}

  @Get("by-user")
  async byUser() {}
}
`;
const INTEROP_CONTROLLER = `
@Controller()
export class SilkRoadController {
  @Get("admin/interop/subjects")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("operator", "admin")
  subjects() {}
}
`;
const ADMIN_CONTROLLER = `
@Controller("admin")
@UseGuards(JwtAuthGuard, ParticipantRolesGuard)
@ParticipantRoles("operator")
export class AdminController {
  @Get("users")
  async listUsers() {}
}
`;

/** 一份全绿的最小输入；每个用例在其上改一处。 */
function base() {
  return {
    manifest: {
      roles: ['provider', 'consumer', 'operator', 'compliance', 'admin'],
      groups: [{ id: 'runtime', label: '运行面', en: 'RUNTIME', icon: 'Activity' }],
      entries: [
        { route: '/space/tasks', label: '编排任务', entry: 'menu', group: 'runtime', en: 'TASKS', icon: 'FlaskConical', viewLayer: 'list', entities: ['cp_rws_task', 'secretflow_task'] },
        { route: '/space/tasks/[id]', label: '任务详情', entry: 'contextual', parent: '/space/tasks', viewLayer: 'detail', entities: ['cp_rws_task'] },
        { route: '/space/infer/[taskId]', label: '本地推理', entry: 'contextual', parent: '/space/tasks/[id]', viewLayer: 'form', entities: ['fl_weight_bundle'], flows: ['FLOW-RWS-04'] },
        { route: '/space/federated', label: '联邦密算', entry: 'menu', group: 'runtime', en: 'FED', icon: 'Share2', viewLayer: 'list', entities: ['secretflow_task'] },
        { route: '/space/audit', label: '审计日志', entry: 'menu', group: 'runtime', en: 'AUDIT', icon: 'ClipboardList', viewLayer: 'list', entities: ['audit_logs'], roles: ['compliance', 'operator'], guards: ['audit/audit.controller.ts#GET'] },
        { route: '/space/admin/interop', label: '互认', entry: 'menu', group: 'runtime', en: 'INTEROP', icon: 'Share2', viewLayer: 'list', entities: ['cp_interop_subject'], roles: ['operator', 'admin'], guards: ['silk-road.controller.ts#GET admin/interop/subjects'] },
        { route: '/space/admin/users', label: '用户', entry: 'menu', group: 'runtime', en: 'USERS', icon: 'Users', viewLayer: 'list', entities: ['users'], roles: ['operator'], guards: ['admin/admin.controller.ts'] },
      ],
      waivers: {
        duplicateList: [{ routes: ['/space/tasks', '/space/federated'], reason: 'SecretFlow 双列表', until: 'ia-task-surface' }],
      },
      redirects: [
        { from: '/space/mdop/jobs', to: '/space/tasks?channel=mdop', label: 'MDOP 作业' },
        { from: '/space/deliverables/:taskId', to: '/space/tasks/:taskId?tab=deliverables' },
      ],
    },
    pages: ['/space/tasks', '/space/tasks/[id]', '/space/infer/[taskId]', '/space/federated', '/space/audit', '/space/admin/interop', '/space/admin/users'],
    webSources: [
      { path: `${SPACE}/tasks/page.tsx`, text: 'const href = `/space/tasks/${t.id}`;' },
      { path: `${SPACE}/tasks/[id]/page.tsx`, text: 'const href = `/space/infer/${id}`;' },
      { path: `${SPACE}/infer/[taskId]/page.tsx`, text: 'export default function Page() { return null; }' },
    ],
    controllers: {
      'audit/audit.controller.ts': AUDIT_CONTROLLER,
      'silk-road.controller.ts': INTEROP_CONTROLLER,
      'admin/admin.controller.ts': ADMIN_CONTROLLER,
    },
    flowsMd: '### FLOW-RWS-04 · L4\n\n```yaml flow\nsteps:\n  - actor: ts:apps/api/src/x.ts#X\n  - actor: ts:apps/web/src/app/(console)/space/infer/[taskId]/page.tsx\n```\n',
    authTs: 'export interface AuthUser {\n  role?: "provider" | "consumer" | "operator" | "compliance" | "admin";\n}',
    userDto: '  @IsOptional()\n  @IsIn(["provider", "consumer", "operator", "compliance", "admin"])\n  participantRole?: ParticipantRole;',
    designMd: '- 角色定义：`provider` / `consumer` / `operator` / `compliance` / `admin`。',
    layoutTsx: '<main><RouteGuard>{children}</RouteGuard></main>',
    nextConfig: 'import manifest from "./src/nav.manifest.json";\nasync redirects() { return manifest.redirects.map(x => x); }',
  };
}

const entryOf = (input, route) => input.manifest.entries.find((e) => e.route === route);
const errorsOf = (mutate) => {
  const input = base();
  mutate(input);
  return runNavCheck(input).errors;
};
const caught = (errors, rule, needle = '') => errors.some((e) => e.startsWith(`[${rule}]`) && e.includes(needle));

test('基线：最小合法输入零违规', () => {
  assert.deepEqual(runNavCheck(base()).errors, []);
});

test('N0 违规：viewLayer / entry 不在闭集、分区缺图标、菜单项分区不存在、角色不在册', () => {
  assert.ok(caught(errorsOf((i) => { entryOf(i, '/space/tasks').viewLayer = 'board'; }), 'N0', 'viewLayer'));
  assert.ok(caught(errorsOf((i) => { entryOf(i, '/space/tasks').entry = 'internal'; }), 'N0', 'entry'));
  assert.ok(caught(errorsOf((i) => { delete i.manifest.groups[0].icon; }), 'N0', 'icon'));
  assert.ok(caught(errorsOf((i) => { entryOf(i, '/space/tasks').group = 'nowhere'; }), 'N0', 'nowhere'));
  assert.ok(caught(errorsOf((i) => { entryOf(i, '/space/audit').roles = ['auditor']; }), 'N0', 'auditor'));
});

test('N1 违规：新增页面未登记 → 抓住', () => {
  assert.ok(caught(errorsOf((i) => { i.pages.push('/space/reports'); }), 'N1', '/space/reports'));
});

test('N2 违规：清单登记了不存在的页面 → 抓住', () => {
  assert.ok(caught(errorsOf((i) => { i.pages = i.pages.filter((p) => p !== '/space/federated'); }), 'N2', '/space/federated'));
});

test('N3 违规：详情页没有任何入口链接 → 抓住（自身目录内的引用不算）', () => {
  const errors = errorsOf((i) => {
    i.webSources[1].text = '';
    i.webSources[2].text = 'const self = `/space/infer/${id}`;';
  });
  assert.ok(caught(errors, 'N3', '/space/infer/[taskId]'));
});

test('N3 违规：缺 parent、parent 悬空、父链成环 → 抓住', () => {
  assert.ok(caught(errorsOf((i) => { delete entryOf(i, '/space/tasks/[id]').parent; }), 'N3', '缺 parent'));
  assert.ok(caught(errorsOf((i) => { entryOf(i, '/space/tasks/[id]').parent = '/space/nowhere'; }), 'N3', '不存在'));
  const cyc = errorsOf((i) => {
    entryOf(i, '/space/tasks/[id]').parent = '/space/infer/[taskId]';
  });
  assert.ok(caught(cyc, 'N3', '成环'));
});

test('N3 合法：测试文件里的路由字面量不算入口链接', () => {
  const errors = errorsOf((i) => {
    i.webSources[1].text = '';
    i.webSources.push({ path: 'apps/web/src/lib/nav.test.ts', text: 'matchEntry(`/space/infer/${id}`)' });
  });
  assert.ok(caught(errors, 'N3', '/space/infer/[taskId]'));
});

test('N4 违规：流程 actor 页面未标注 flows / 不在清单 → 抓住', () => {
  assert.ok(caught(errorsOf((i) => { delete entryOf(i, '/space/infer/[taskId]').flows; }), 'N4', 'FLOW-RWS-04'));
  const missing = errorsOf((i) => {
    i.manifest.entries = i.manifest.entries.filter((e) => e.route !== '/space/infer/[taskId]');
    i.pages = i.pages.filter((p) => p !== '/space/infer/[taskId]');
  });
  assert.ok(caught(missing, 'N4', '不在导航清单'));
});

test('N4 违规：清单引用了不存在的 FLOW → 抓住', () => {
  assert.ok(caught(errorsOf((i) => { entryOf(i, '/space/tasks').flows = ['FLOW-NOPE-01']; }), 'N4', 'FLOW-NOPE-01'));
});

test('N5 违规：四处角色任一处与清单不一致 → 抓住', () => {
  assert.ok(caught(errorsOf((i) => { i.designMd = '- 角色定义：`provider` / `consumer` / `operator` / `compliance`。'; }), 'N5', 'DESIGN.md'));
  assert.ok(caught(errorsOf((i) => { i.authTs = i.authTs.replace(' | "admin"', ''); }), 'N5', 'auth.ts'));
  assert.ok(caught(errorsOf((i) => { i.userDto = i.userDto.replace(', "admin"', ''); }), 'N5', 'update-user.dto.ts'));
  assert.ok(caught(errorsOf((i) => { i.manifest.roles.push('auditor'); }), 'N5'));
});

test('N5 违规：格式契约被破坏（解析不到）→ 红，而不是静默通过', () => {
  assert.ok(caught(errorsOf((i) => { i.designMd = '角色见上文。'; }), 'N5', '解析不到'));
});

test('N6 违规：菜单比服务端严（有能力无入口）→ 抓住', () => {
  const errors = errorsOf((i) => { entryOf(i, '/space/admin/interop').roles = ['admin']; });
  assert.ok(caught(errors, 'N6', '比服务端严'));
  assert.ok(caught(errors, 'N6', 'operator'));
});

test('N6 违规：菜单比服务端松 → 抓住（含省略 roles = 全部角色）', () => {
  assert.ok(caught(errorsOf((i) => { delete entryOf(i, '/space/audit').roles; }), 'N6', '比服务端松'));
  assert.ok(caught(errorsOf((i) => { entryOf(i, '/space/admin/users').roles = ['operator', 'admin']; }), 'N6', '比服务端松'));
});

test('N6 违规：guard 指向的端点或控制器找不到 → 红，不跳过对拍', () => {
  assert.ok(caught(errorsOf((i) => { entryOf(i, '/space/audit').guards = ['audit/audit.controller.ts#GET nope']; }), 'N6', '找不到端点'));
  assert.ok(caught(errorsOf((i) => { entryOf(i, '/space/audit').guards = ['gone.controller.ts#GET']; }), 'N6', '控制器不存在'));
});

test('N6 解析：方法级优先、无方法级回落类级、都没有 = 全部角色', () => {
  const controllers = base().controllers;
  assert.deepEqual([...resolveGuard('audit/audit.controller.ts#GET', controllers).roles].sort(), ['compliance', 'operator']);
  assert.equal(resolveGuard('audit/audit.controller.ts#GET by-user', controllers).roles, null);
  assert.equal(resolveGuard('audit/audit.controller.ts#POST', controllers).roles, null);
  assert.deepEqual([...resolveGuard('admin/admin.controller.ts#GET users', controllers).roles], ['operator']);
  assert.deepEqual([...resolveGuard('admin/admin.controller.ts', controllers).roles], ['operator']);
});

test('N7 违规：新增未豁免的重复列表 → 抓住', () => {
  const errors = errorsOf((i) => {
    i.manifest.entries.push({ route: '/space/deliverables', label: '交付', entry: 'menu', group: 'runtime', en: 'D', icon: 'Package', viewLayer: 'list', entities: ['secretflow_task'] });
    i.pages.push('/space/deliverables');
  });
  assert.ok(caught(errors, 'N7', '/space/deliverables'));
});

test('N7 违规：豁免已过期 / 缺原因 → 抓住', () => {
  assert.ok(caught(errorsOf((i) => { entryOf(i, '/space/federated').entities = ['cp_other']; }), 'N7', '已过期'));
  assert.ok(caught(errorsOf((i) => { delete i.manifest.waivers.duplicateList[0].until; }), 'N7', 'reason / until'));
});

test('N7 合法：viewLayer 不同的两个菜单项共享对象不算重复', () => {
  assert.deepEqual(errorsOf((i) => {
    entryOf(i, '/space/federated').viewLayer = 'ledger';
    i.manifest.waivers.duplicateList = [];
  }), []);
});

test('N8 违规：布局未挂 RouteGuard → 抓住', () => {
  assert.ok(caught(errorsOf((i) => { i.layoutTsx = '<main>{children}</main>'; }), 'N8', 'RouteGuard'));
});

test('N8 违规：页面手写整页角色早返回（两种既有写法）→ 抓住', () => {
  const allowed = 'if (!user?.role || !ALLOWED.includes(user.role)) {\n    return (\n      <div />\n    );\n  }';
  const consumerOnly = 'if (role !== "consumer") {\n    return (<Panel />);\n  }';
  assert.equal(findPageRoleGates(allowed).length, 1);
  assert.equal(findPageRoleGates(consumerOnly).length, 1);
  assert.equal(findPageRoleGates('if (role !== "consumer") return null;').length, 1);
  const errors = errorsOf((i) => { i.webSources.push({ path: `${SPACE}/audit/page.tsx`, text: allowed }); });
  assert.ok(caught(errors, 'N8', 'audit/page.tsx:1'));
});

test('N8 不误伤：就绪态早返回、按角色切换列与按钮、非 JSX 返回', () => {
  assert.deepEqual(findPageRoleGates('if (!ready) return null;'), []);
  assert.deepEqual(findPageRoleGates('const isOperator = user?.role === "operator";'), []);
  assert.deepEqual(findPageRoleGates('{role === "provider" ? <A /> : <B />}'), []);
  assert.deepEqual(findPageRoleGates('if (role === "provider") return providerColumns;'), []);
  assert.deepEqual(findPageRoleGates('if (role === "provider") {\n  setTab("inbox");\n}'), []);
});

test('N8 范围：只扫 (console)/space 下的页面源码', () => {
  const gate = 'if (role !== "consumer") return null;';
  assert.deepEqual(errorsOf((i) => { i.webSources.push({ path: 'apps/web/src/app/dashboard/x/page.tsx', text: gate }); }), []);
});

test('N9 违规：静态路由页面的页头写字面量标题 → 抓住（同目录的内容组件也算）', () => {
  const header = '<PageHeader\n  kicker="TASKS"\n  title="编排任务"\n/>';
  assert.ok(caught(errorsOf((i) => { i.webSources[0].text += header; }), 'N9', 'tasks/page.tsx'));
  assert.ok(caught(errorsOf((i) => { i.webSources.push({ path: `${SPACE}/audit/audit-content.tsx`, text: header }); }), 'N9', 'audit-content.tsx:1'));
});

test('N9 不误伤：表达式标题、槽内子元素的 title、动态详情页的对象标题', () => {
  assert.deepEqual(findLiteralPageTitles('<PageHeader kicker="K" title={isService ? "服务" : "产品"} />'), []);
  assert.deepEqual(findLiteralPageTitles('<PageHeader kicker="K" action={<Link href="/x" title="提示">去</Link>} />'), []);
  assert.deepEqual(findLiteralPageTitles('<PageHeader kicker="K" desc="说明" />'), []);
  assert.deepEqual(errorsOf((i) => { i.webSources[1].text += '<PageHeader kicker="K" title="联邦合并结果" />'; }), []);
});

test('N10 违规：重定向源仍有页面或清单条目 → 抓住', () => {
  assert.ok(caught(errorsOf((i) => { i.pages.push('/space/mdop/jobs'); }), 'N10', '仍有页面'));
  assert.ok(caught(errorsOf((i) => { i.manifest.redirects[0].from = '/space/federated'; }), 'N10', '仍有页面或清单条目'));
  assert.ok(caught(errorsOf((i) => { i.pages.push('/space/deliverables/[id]'); }), 'N10', '/space/deliverables/:taskId'));
});

test('N10 违规：重定向目标不在清单 → 抓住', () => {
  assert.ok(caught(errorsOf((i) => { i.manifest.redirects[0].to = '/space/nowhere?x=1'; }), 'N10', '目标不在导航清单'));
});

test('N10 违规：源码仍链接旧地址（静态与动态）→ 抓住；测试文件不算', () => {
  assert.ok(caught(errorsOf((i) => { i.webSources[0].text += '<Link href="/space/mdop/jobs">作业</Link>'; }), 'N10', '/space/mdop/jobs'));
  assert.ok(caught(errorsOf((i) => { i.webSources[0].text += 'const h = `/space/deliverables/${id}`;'; }), 'N10', '/space/deliverables/:taskId'));
  assert.deepEqual(errorsOf((i) => { i.webSources.push({ path: 'apps/web/src/lib/nav.test.ts', text: '"/space/mdop/jobs"' }); }), []);
});

test('N10 合法：链接到仍然存在的子路由不算链接旧地址', () => {
  assert.deepEqual(errorsOf((i) => {
    i.manifest.entries.push({ route: '/space/mdop/jobs/[id]', label: '作业详情', entry: 'contextual', parent: '/space/tasks', viewLayer: 'detail', entities: ['cp_mdop_job'] });
    i.pages.push('/space/mdop/jobs/[id]');
    i.webSources[0].text += 'const h = `/space/mdop/jobs/${id}`;';
  }), []);
});

test('N10 违规：next.config 没有从清单生成重定向 → 抓住', () => {
  assert.ok(caught(errorsOf((i) => { i.nextConfig = 'const nextConfig = {};'; }), 'N10', 'next.config'));
});

test('N11 违规：样式表或组件里出现平行令牌 --at-* → 抓住', () => {
  const css = errorsOf((i) => { i.styleSources = [{ path: 'apps/web/src/app/x.css', text: '.codex {\n  --at-ink: red;\n}' }]; });
  assert.ok(caught(css, 'N11', 'x.css:2'));
  assert.ok(caught(errorsOf((i) => { i.webSources[0].text += '<p style={{ color: "var(--at-faint)" }} />'; }), 'N11', 'tasks/page.tsx'));
});

test('N11 不误伤：--cs-* 令牌与含 at- 的普通类名', () => {
  assert.deepEqual(errorsOf((i) => {
    i.styleSources = [{ path: 'apps/web/src/app/console.css', text: '.cs { --cs-bg: black; }' }];
    i.webSources[0].text += '<p className="format-date" style={{ color: "var(--cs-faint)" }} />';
  }), []);
});

test('N12 违规：菜单 tab 的页面只做 redirect → 抓住（点了会落到别的 tab）', () => {
  const stub = 'import { redirect } from "next/navigation";\nexport default function P() { redirect("/space/tasks"); }';
  const errors = errorsOf((i) => { i.webSources.push({ path: `${SPACE}/federated/page.tsx`, text: stub }); });
  assert.ok(caught(errors, 'N12', '/space/federated'));
});

test('N12 不误伤：真页面里的条件跳转 / 客户端页面', () => {
  const withJsx = 'import { redirect } from "next/navigation";\nexport default function P() { if (x) redirect("/space/tasks"); return <div />; }';
  const client = '"use client";\nimport { redirect } from "next/navigation";\nexport default function P() { return null; }';
  assert.deepEqual(errorsOf((i) => { i.webSources.push({ path: `${SPACE}/federated/page.tsx`, text: withJsx }); }), []);
  assert.deepEqual(errorsOf((i) => { i.webSources.push({ path: `${SPACE}/federated/page.tsx`, text: client }); }), []);
});

test('真实仓库：读盘入口可用，清单覆盖全部控制台页面', () => {
  const input = loadInput();
  assert.ok(input.pages.length >= 20);
  const errors = runNavCheck(input).errors;
  assert.deepEqual(errors.filter((e) => /^\[N[12]\]/.test(e)), []);
});
