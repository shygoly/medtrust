#!/usr/bin/env node
/**
 * check-nav.mjs — 控制台导航契约的机检（D-UI-2，openspec 能力 console-navigation）。
 *
 * 导航清单 `apps/web/src/nav.manifest.json` 是菜单、路由、角色门控的唯一事实源。本守护让
 * 「清单 ↔ page.tsx ↔ 服务端 @ParticipantRoles ↔ FLOWS.md actor ↔ 角色词汇」互相对拍：
 *
 *  N0 形状：分区与条目字段齐全、取值在闭集内、route 唯一。
 *  N1 无孤儿：`(console)/space` 下每个 page.tsx 都在清单里。
 *  N2 无死链：清单每个 route 都有 page.tsx。
 *  N3 入口可达：非菜单条目有 parent，父链终止于菜单项且不成环；前端源码里至少有一处链接指向它。
 *  N4 流程在册：FLOWS.md 里以控制台页面为 actor 的步骤，其页面条目的 flows 含该 FLOW；
 *     清单引用的 FLOW 编号在 FLOWS.md 存在。
 *  N5 角色一致：清单 roles = 前端会话类型 = 服务端用户更新 DTO = DESIGN.md「角色定义」。
 *  N6 与服务端一致：声明了 guards 的条目，roles 必须等于各 guard 端点角色的并集
 *     （方法级 @ParticipantRoles，没有则取类级，都没有视为全部角色）。小于并集 = 有能力无入口，
 *     大于并集 = 看得到页面但主功能必然被拒。guard 定位不到 = 红，不放行。
 *  N7 无重复列表：两个同 viewLayer 的菜单项不得共享 entities，除非在 waivers.duplicateList
 *     登记（带 reason / until）；不再成立的豁免也算错，名单只减不增。
 *  N8 门控单点：布局挂 RouteGuard；`(console)/space` 下的页面不得手写整页角色早返回。
 *  N10 旧地址重定向：清单 redirects 的源不得仍有页面或条目；目标须落在已登记路由；前端源码不得
 *      再链接重定向源；next.config 必须从清单生成重定向（不得另写一份映射）。
 *  N11 单一设计令牌：`apps/web/src` 下（含样式表）不得出现 `--at-*`——控制台只有 `--cs-*` 一套令牌
 *      （DESIGN §9.5）。atlas 曾带一套取值相同的平行令牌，已并入；此规则防止它或同类再长出来。
 *  N9 标签同源：静态路由页面的 PageHeader 不得带字符串字面量 title——标题缺省取清单 label，
 *     与侧栏 tab、面包屑、命令面板同源。动态详情页可传对象自身的标题；`title={表达式}` 不在此列。
 *  N12 菜单页不是重定向桩：菜单 tab 的页面不得只做 `redirect()`——否则点击后落到别的 tab、
 *     高亮也停在别的页面上，用户看到的是「点了没反应」。真要合并页面请走清单 redirects。
 *
 * 局限：guards 靠人声明，未声明的条目不做 N6 对拍；N8 只认「if (…role…) return <JSX|null>」写法；
 * N9 按花括号深度剥离子表达式，属性字符串里含 `>` 或花括号时可能漏检；N12 按「有 JSX / `use client` /
 * 数据 hook 就不是桩」判定，纯服务端跳转壳才算违规。
 * 零依赖，`node scripts/check-nav.mjs` 运行；退出码：有 error 则 1。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".git", "coverage", "build", ".turbo"]);

export const PATHS = {
  manifest: "apps/web/src/nav.manifest.json",
  webSrc: "apps/web/src",
  spaceDir: "apps/web/src/app/(console)/space",
  layout: "apps/web/src/app/(console)/layout.tsx",
  nextConfig: "apps/web/next.config.ts",
  apiSrc: "apps/api/src",
  auth: "apps/web/src/lib/auth.ts",
  userDto: "apps/api/src/admin/dto/update-user.dto.ts",
  flows: "FLOWS.md",
  design: "DESIGN.md",
};

const VIEW_LAYERS = new Set(["list", "detail", "form", "ledger", "dashboard"]);
const ENTRY_KINDS = new Set(["menu", "contextual"]);
const FLOW_ACTOR_PREFIX = "ts:apps/web/src/app/(console)";

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const fmt = (set) => [...set].sort().join(", ") || "∅";
const quoted = (text) => new Set([...text.matchAll(/["'`]([a-z]+)["'`]/g)].map((m) => m[1]));
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** page.tsx 的仓库相对路径 → 路由模式（`…/(console)/space/tasks/[id]/page.tsx` → `/space/tasks/[id]`）。 */
export function routeOfPage(rel) {
  const m = rel.match(/app\/\(console\)(\/space(?:\/.*)?)\/page\.tsx$/);
  return m ? m[1] : null;
}

/** 条目自己的页面目录（该目录内的引用不算「入口链接」）。 */
const ownDir = (route) => `${PATHS.webSrc}/app/(console)${route}/`;

/** 源码里指向该路由的链接写法：静态路由整串出现；动态路由以「静态前缀 + 模板插值/引号」出现。 */
function linkPattern(route) {
  const firstParam = route.indexOf("[");
  if (firstParam === -1) return new RegExp(`${escapeRe(route)}(?![\\w/\\-\\[])`);
  return new RegExp(`${escapeRe(route.slice(0, firstParam))}(?:\\$\\{|["'\`])`);
}

/** 取 `if (` 起的括号平衡条件串与其后紧跟的源码。 */
function ifStatements(text) {
  const out = [];
  const re = /\bif\s*\(/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
    }
    out.push({ condition: text.slice(re.lastIndex, i - 1), after: text.slice(i, i + 40), index: m.index });
  }
  return out;
}

/** N8：整页角色早返回（`if (…role…) return <JSX | ( | null>`）。按角色切换列/按钮的条件渲染不在此列。 */
export function findPageRoleGates(text) {
  return ifStatements(text)
    .filter((s) => /\brole\b/.test(s.condition) && /^\s*\{?\s*return\s*(?:\(|<|null\b)/.test(s.after))
    .map((s) => text.slice(0, s.index).split("\n").length);
}

/** N9：返回带字符串字面量 title 的 `<PageHeader>` 所在行号（只看标签自身属性，不看 `action={…}` 等槽内子元素）。 */
export function findLiteralPageTitles(text) {
  const lines = [];
  const re = /<PageHeader\b/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 0;
    let props = "";
    for (let i = re.lastIndex; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (depth === 0) {
        if (ch === ">") break;
        props += ch;
      }
    }
    if (/\btitle\s*=\s*["']/.test(props)) lines.push(text.slice(0, m.index).split("\n").length);
  }
  return lines;
}

/**
 * N12：页面是否只是重定向桩。有 JSX / 客户端交互 / 数据请求的一律视为真页面——
 * 只有「纯服务端 redirect()」才让 tab 变成死链。
 */
export function isRedirectStub(text) {
  if (!/\bredirect\s*\(/.test(text)) return false;
  if (/<[A-Za-z]/.test(text)) return false;
  if (/["'`]use client["'`]/.test(text)) return false;
  return !/\buse(?:Query|Mutation|State|Effect|Reducer)\b/.test(text);
}

/**
 * N6：解析 guard（`<控制器相对路径>#<METHOD> <子路径>`；无 `#` = 取类级）对应的角色集合。
 * 返回 `{ roles: Set | null }`（null = 全部角色）或 `{ error }`。
 */
export function resolveGuard(guard, controllers) {
  const [file, endpoint] = guard.split("#");
  const text = controllers[file];
  if (text == null) return { error: `控制器不存在：${file}` };
  const lines = text.split("\n");
  const classLine = lines.findIndex((l) => /^export class\b/.test(l));
  const rolesIn = (chunk) => {
    const m = chunk.join("\n").match(/@ParticipantRoles\(([^)]*)\)/);
    return m ? quoted(m[1]) : null;
  };
  const classRoles = rolesIn(lines.slice(0, classLine === -1 ? 0 : classLine));
  if (endpoint === undefined) return { roles: classRoles };

  const [method, subPath = ""] = endpoint.trim().split(/\s+/);
  const verb = method.charAt(0).toUpperCase() + method.slice(1).toLowerCase();
  const routeRe = subPath
    ? new RegExp(`^\\s*@${verb}\\(\\s*["'\`]${escapeRe(subPath)}["'\`]\\s*\\)`)
    : new RegExp(`^\\s*@${verb}\\(\\s*\\)`);
  const at = lines.findIndex((l) => routeRe.test(l));
  if (at === -1) return { error: `在 ${file} 中找不到端点 ${endpoint.trim()}` };

  // 方法上的装饰器块：向上到空行/上一个成员结束，向下到方法签名。
  let start = at;
  while (start > 0 && /^\s*@/.test(lines[start - 1])) start--;
  let end = at + 1;
  const signature = /^\s*(?:public\s+|private\s+|protected\s+)?(?:async\s+)?[A-Za-z_]\w*\s*\(/;
  while (end < lines.length && end - at < 20 && !signature.test(lines[end])) end++;
  return { roles: rolesIn(lines.slice(start, end)) ?? classRoles };
}

/**
 * 纯函数：对给定输入做全部判定（便于负例自检注入）。
 * @param {{
 *   manifest: any,
 *   pages: string[],
 *   webSources: Array<{ path: string; text: string }>,
 *   styleSources?: Array<{ path: string; text: string }>,
 *   controllers: Record<string, string>,
 *   flowsMd: string, authTs: string, userDto: string, designMd: string, layoutTsx: string, nextConfig: string,
 * }} input
 */
export function runNavCheck(input) {
  const errors = [];
  const err = (rule, message) => errors.push(`[${rule}] ${message}`);
  const { manifest } = input;

  // ── N0 形状 ─────────────────────────────────────────────────────────
  const allRoles = new Set(Array.isArray(manifest?.roles) ? manifest.roles : []);
  const groupIds = new Set((manifest?.groups ?? []).map((g) => g.id));
  for (const g of manifest?.groups ?? []) {
    if (!g.id || !g.label || !g.icon || !g.en) err("N0", `分区 ${g.id ?? "(无 id)"} 缺 label / icon / en`);
  }
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
  if (!allRoles.size) err("N0", "清单缺 roles");
  if (!entries.length) err("N0", "清单缺 entries");
  const byRoute = new Map();
  for (const e of entries) {
    const at = e.route ?? "(无 route)";
    if (typeof e.route !== "string" || !e.route.startsWith("/space")) err("N0", `${at} route 非法`);
    if (byRoute.has(e.route)) err("N0", `${at} 重复登记`);
    byRoute.set(e.route, e);
    if (!e.label) err("N0", `${at} 缺 label`);
    if (!ENTRY_KINDS.has(e.entry)) err("N0", `${at} entry 须为 menu | contextual`);
    if (!VIEW_LAYERS.has(e.viewLayer)) err("N0", `${at} viewLayer 不在闭集内：${e.viewLayer}`);
    if (!Array.isArray(e.entities) || !e.entities.length) err("N0", `${at} 缺 entities`);
    if (e.roles !== undefined) {
      if (!Array.isArray(e.roles) || !e.roles.length) err("N0", `${at} roles 为空（不限角色请省略该字段）`);
      else for (const r of e.roles) if (!allRoles.has(r)) err("N0", `${at} 角色不在册：${r}`);
    }
    if (e.entry === "menu" && !groupIds.has(e.group)) err("N0", `${at} 菜单项的 group 不在 groups 中：${e.group}`);
  }

  // ── N1 / N2 清单 ↔ page.tsx ──────────────────────────────────────────
  const pages = new Set(input.pages);
  for (const page of pages) if (!byRoute.has(page)) err("N1", `页面未登记到导航清单：${page}`);
  for (const route of byRoute.keys()) if (!pages.has(route)) err("N2", `清单登记了不存在的页面：${route}`);

  // ── N3 入口可达 ──────────────────────────────────────────────────────
  const linkSources = input.webSources.filter((s) => !/\.test\.[a-z]+$/.test(s.path));
  for (const e of entries) {
    if (e.entry !== "contextual") continue;
    if (!e.parent) { err("N3", `${e.route} 非菜单条目缺 parent`); continue; }
    const seen = new Set();
    let cur = e;
    while (cur && cur.entry !== "menu") {
      if (seen.has(cur.route)) { err("N3", `${e.route} 父链成环`); cur = null; break; }
      seen.add(cur.route);
      const parent = byRoute.get(cur.parent);
      if (!parent) { err("N3", `${cur.route} 的 parent 不存在：${cur.parent}`); cur = null; break; }
      cur = parent;
    }
    const pattern = linkPattern(e.route);
    const own = ownDir(e.route);
    if (!linkSources.some((s) => !s.path.startsWith(own) && pattern.test(s.text))) {
      err("N3", `${e.route} 没有任何入口链接（除其自身目录外，前端源码无处指向它）`);
    }
  }

  // ── N4 流程在册 ──────────────────────────────────────────────────────
  const flowIds = new Set();
  const sections = input.flowsMd.split(/^### (FLOW-[A-Z0-9-]+)/m);
  for (let i = 1; i < sections.length; i += 2) {
    const flow = sections[i];
    flowIds.add(flow);
    for (const m of sections[i + 1].matchAll(/^\s*-\s+actor:\s*(\S+)/gm)) {
      if (!m[1].startsWith(FLOW_ACTOR_PREFIX)) continue;
      const route = routeOfPage(m[1].replace(/^ts:/, "").split("#")[0]);
      if (!route) continue;
      const entry = byRoute.get(route);
      if (!entry) err("N4", `${flow} 的 actor 页面不在导航清单：${route}`);
      else if (!(entry.flows ?? []).includes(flow)) err("N4", `${route} 是 ${flow} 的 actor，但条目 flows 未标注`);
    }
  }
  for (const e of entries) {
    for (const flow of e.flows ?? []) if (!flowIds.has(flow)) err("N4", `${e.route} 引用了 FLOWS.md 中不存在的 ${flow}`);
  }

  // ── N5 角色一致 ──────────────────────────────────────────────────────
  const roleSources = [
    [PATHS.auth, input.authTs.match(/\brole\?:\s*([^;]+);/)?.[1]],
    [PATHS.userDto, input.userDto.match(/@IsIn\(\[([^\]]*)\]\)\s*participantRole\b/)?.[1]],
    [`${PATHS.design}「角色定义」`, input.designMd.split("\n").find((l) => l.includes("角色定义"))],
  ];
  for (const [where, raw] of roleSources) {
    if (!raw) { err("N5", `${where} 解析不到角色枚举（格式契约被破坏）`); continue; }
    const found = quoted(raw);
    if (!sameSet(found, allRoles)) err("N5", `${where} 的角色 {${fmt(found)}} 与清单 {${fmt(allRoles)}} 不一致`);
  }

  // ── N6 与服务端一致 ──────────────────────────────────────────────────
  for (const e of entries) {
    if (!e.guards?.length) continue;
    const union = new Set();
    let resolved = true;
    for (const guard of e.guards) {
      const r = resolveGuard(guard, input.controllers);
      if (r.error) { err("N6", `${e.route} guard 无法解析：${r.error}`); resolved = false; continue; }
      for (const role of r.roles ?? allRoles) union.add(role);
    }
    if (!resolved) continue;
    const declared = new Set(e.roles ?? allRoles);
    const stricter = [...union].filter((r) => !declared.has(r));
    const looser = [...declared].filter((r) => !union.has(r));
    if (stricter.length) err("N6", `${e.route} 比服务端严：服务端允许 ${stricter.join(", ")}，清单未放行（有能力无入口）`);
    if (looser.length) err("N6", `${e.route} 比服务端松：清单放行 ${looser.join(", ")}，服务端会拒绝`);
  }

  // ── N7 无重复列表 ────────────────────────────────────────────────────
  const pairKey = (a, b) => [a, b].sort().join(" ↔ ");
  const overlaps = new Map();
  const menus = entries.filter((e) => e.entry === "menu" && Array.isArray(e.entities));
  for (let i = 0; i < menus.length; i++) {
    for (let j = i + 1; j < menus.length; j++) {
      if (menus[i].viewLayer !== menus[j].viewLayer) continue;
      const shared = menus[i].entities.filter((x) => menus[j].entities.includes(x));
      if (shared.length) overlaps.set(pairKey(menus[i].route, menus[j].route), shared);
    }
  }
  const waived = new Set();
  for (const w of manifest?.waivers?.duplicateList ?? []) {
    const key = Array.isArray(w.routes) && w.routes.length === 2 ? pairKey(w.routes[0], w.routes[1]) : null;
    if (!key) { err("N7", `豁免格式非法（routes 须为两个路由）：${JSON.stringify(w.routes)}`); continue; }
    if (!w.reason || !w.until) err("N7", `豁免 ${key} 缺 reason / until`);
    if (!overlaps.has(key)) err("N7", `豁免已过期，请删除：${key}`);
    waived.add(key);
  }
  for (const [key, shared] of overlaps) {
    if (!waived.has(key)) err("N7", `同一对象有两个菜单列表：${key}（共享 ${shared.join(", ")}）`);
  }

  // ── N8 门控单点 ──────────────────────────────────────────────────────
  if (!/<RouteGuard\b/.test(input.layoutTsx)) err("N8", `${PATHS.layout} 未挂 RouteGuard`);
  for (const s of input.webSources) {
    if (!s.path.startsWith(`${PATHS.spaceDir}/`) || !s.path.endsWith(".tsx")) continue;
    for (const line of findPageRoleGates(s.text)) {
      err("N8", `${s.path}:${line} 手写整页角色门控；角色门控统一在布局层 RouteGuard，按清单 roles 生效`);
    }
  }

  // ── N9 标签同源 ──────────────────────────────────────────────────────
  for (const e of entries) {
    if (typeof e.route !== "string" || e.route.includes("[")) continue;
    const own = ownDir(e.route);
    for (const s of input.webSources) {
      if (!s.path.startsWith(own) || s.path.slice(own.length).includes("/") || !s.path.endsWith(".tsx")) continue;
      for (const line of findLiteralPageTitles(s.text)) {
        err("N9", `${s.path}:${line} 页头标题写了字面量；去掉 title，标题取导航清单中 ${e.route} 的 label`);
      }
    }
  }

  // ── N10 旧地址重定向 ─────────────────────────────────────────────────
  const shape = (route) => route.replace(/\[[^\]]+\]/g, "[]");
  const registeredShapes = new Set([...byRoute.keys()].map(shape));
  const asRoute = (address) => String(address).split("?")[0].replace(/:([A-Za-z_]\w*)/g, "[$1]");
  const redirects = Array.isArray(manifest?.redirects) ? manifest.redirects : [];
  for (const r of redirects) {
    if (typeof r.from !== "string" || typeof r.to !== "string" || !r.from.startsWith("/space")) {
      err("N10", `重定向格式非法：${JSON.stringify(r)}`);
      continue;
    }
    const from = asRoute(r.from);
    if (registeredShapes.has(shape(from)) || [...pages].some((p) => shape(p) === shape(from))) {
      err("N10", `重定向源仍有页面或清单条目：${r.from}`);
    }
    if (!registeredShapes.has(shape(asRoute(r.to)))) err("N10", `重定向目标不在导航清单：${r.to}`);
    const pattern = linkPattern(from);
    for (const s of linkSources) {
      if (pattern.test(s.text)) err("N10", `${s.path} 仍链接已重定向的旧地址 ${r.from}，应改为 ${r.to}`);
    }
  }
  if (redirects.length && !(/nav\.manifest\.json/.test(input.nextConfig) && /\bredirects\s*\(/.test(input.nextConfig))) {
    err("N10", `${PATHS.nextConfig} 未从导航清单生成 redirects()`);
  }

  // ── N11 单一设计令牌 ─────────────────────────────────────────────────
  for (const s of [...input.webSources, ...(input.styleSources ?? [])]) {
    const at = s.text.search(/--at-[a-z]/);
    if (at !== -1) {
      const line = s.text.slice(0, at).split("\n").length;
      err("N11", `${s.path}:${line} 出现平行设计令牌 --at-*；控制台只用 --cs-*（DESIGN §9.5）`);
    }
  }

  // ── N12 菜单页不是重定向桩 ───────────────────────────────────────────
  for (const e of entries) {
    if (e.entry !== "menu" || typeof e.route !== "string" || e.route.includes("[")) continue;
    const page = input.webSources.find((s) => s.path === `${ownDir(e.route)}page.tsx`);
    if (page && isRedirectStub(page.text)) {
      err(
        "N12",
        `${e.route} 是菜单 tab，但页面只做 redirect——点击后会落到别的 tab、看起来「点不动」；` +
          `要么给真实页面，要么把合并关系登记到清单 redirects 并去掉该菜单项`,
      );
    }
  }

  return { errors };
}

// ── 读盘入口 ────────────────────────────────────────────────────────────
function walk(dir, test, out = []) {
  let list;
  try { list = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const item of list) {
    if (SKIP_DIRS.has(item.name)) continue;
    const full = join(dir, item.name);
    if (item.isDirectory()) walk(full, test, out);
    else if (test(item.name)) out.push(full);
  }
  return out;
}

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const rel = (full) => relative(ROOT, full).split("\\").join("/");

export function loadInput() {
  const manifest = JSON.parse(read(PATHS.manifest));
  const webSources = walk(join(ROOT, PATHS.webSrc), (n) => /\.tsx?$/.test(n)).map((f) => ({ path: rel(f), text: readFileSync(f, "utf8") }));
  const controllers = {};
  for (const entry of manifest.entries ?? []) {
    for (const guard of entry.guards ?? []) {
      const file = guard.split("#")[0];
      if (file in controllers) continue;
      try { controllers[file] = read(`${PATHS.apiSrc}/${file}`); } catch { /* resolveGuard 报错 */ }
    }
  }
  return {
    manifest,
    pages: webSources.map((s) => routeOfPage(s.path)).filter(Boolean),
    webSources,
    styleSources: walk(join(ROOT, PATHS.webSrc), (n) => n.endsWith(".css")).map((f) => ({ path: rel(f), text: readFileSync(f, "utf8") })),
    controllers,
    flowsMd: read(PATHS.flows),
    authTs: read(PATHS.auth),
    userDto: read(PATHS.userDto),
    designMd: read(PATHS.design),
    layoutTsx: read(PATHS.layout),
    nextConfig: read(PATHS.nextConfig),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors } = runNavCheck(loadInput());
  if (errors.length) {
    console.error(`✗ check-nav：${errors.length} 处违规`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log("✓ check-nav：导航清单与路由、角色、流程契约一致");
}
