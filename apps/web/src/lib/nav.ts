// 控制台导航的类型化访问层。数据唯一来源是 nav.manifest.json（D-UI-2）：
// 侧栏、布局层角色门控、scripts/check-nav.mjs 守护都读同一份清单。
import manifest from "../nav.manifest.json";
import type { AuthUser } from "./auth";
import { ROUTE_PACK_TAGS } from "./space-context";

export type Role = NonNullable<AuthUser["role"]>;

export const NAV_ICONS = ["Activity", "Database", "FlaskConical", "Layers", "Server", "ShieldAlert"] as const;
export type NavIcon = (typeof NAV_ICONS)[number];

export interface NavEntry {
  /** App Router 路径模式，与 page.tsx 一一对应（如 /space/tasks/[id]）。 */
  route: string;
  label: string;
  entry: "menu" | "contextual";
  viewLayer: "list" | "detail" | "form" | "ledger" | "dashboard";
  entities: string[];
  /** 省略 = 全部角色可见。 */
  roles?: Role[];
  /** 非菜单条目必填：上一级页面的 route。 */
  parent?: string;
  /** 回到上一级时需要附带的查询串（如推理页 → 联邦预测任务详情）。 */
  parentQuery?: string;
  flows?: string[];
  guards?: string[];
  /** 菜单条目所属分区 id。 */
  group?: string;
}

/** 侧栏分区：侧栏只列分区，分区内的菜单页在内容区顶部以 tab 呈现。 */
export interface NavGroup {
  id: string;
  label: string;
  en: string;
  icon: NavIcon;
  /** 与上方分区之间加分隔（声明面）。 */
  separated?: boolean;
}

/** 被合并页面的旧地址 → 新地址；带 label 的同时作为命令面板里的旧名称入口。 */
export interface NavRedirect {
  from: string;
  to: string;
  label?: string;
}

export const ROLES = manifest.roles as Role[];
export const navRedirects = manifest.redirects as NavRedirect[];
/** 用户管理里可分配的角色。平台管理员只能在服务器侧授予（D-ID-3），接口也会拒绝，所以不列出。 */
export const ASSIGNABLE_ROLES = ROLES.filter((r) => r !== "admin");
export const navGroups = manifest.groups as NavGroup[];
export const navEntries = manifest.entries as NavEntry[];

const byRoute = new Map(navEntries.map((e) => [e.route, e]));

const segments = (path: string) => path.split(/[?#]/)[0].split("/").filter(Boolean);
const isParam = (segment: string) => segment.startsWith("[") && segment.endsWith("]");

/** 当前路径对应的清单条目；静态段优先于动态段（/space/tasks/new 不会落到 /space/tasks/[id]）。 */
export function matchEntry(pathname: string): NavEntry | undefined {
  const actual = segments(pathname);
  let best: NavEntry | undefined;
  let bestStatic = -1;
  for (const entry of navEntries) {
    const pattern = segments(entry.route);
    if (pattern.length !== actual.length) continue;
    if (!pattern.every((p, i) => isParam(p) || p === actual[i])) continue;
    const staticCount = pattern.filter((p) => !isParam(p)).length;
    if (staticCount > bestStatic) {
      best = entry;
      bestStatic = staticCount;
    }
  }
  return best;
}

export function canAccess(entry: NavEntry, role: string | undefined): boolean {
  if (!entry.roles) return true;
  return !!role && (entry.roles as string[]).includes(role);
}

/** 沿 parent 链回溯到所属菜单项（详情页、表单页高亮其父菜单）。 */
export function menuAncestor(entry: NavEntry | undefined): NavEntry | undefined {
  const seen = new Set<string>();
  let current = entry;
  while (current && current.entry !== "menu") {
    if (!current.parent || seen.has(current.route)) return undefined;
    seen.add(current.route);
    current = byRoute.get(current.parent);
  }
  return current;
}

/** 某角色可见的侧栏：没有可见项的分组不返回。 */
/**
 * 某路由在给定启用集下是否可见（P9.3）。
 * `enabledPacks` 为 undefined = **不做包过滤**（单领域既有部署行为零变更）；
 * 为数组时，登记了所需包的路由必须全部满足。
 */
export function packsAllow(route: string, enabledPacks?: readonly string[]): boolean {
  if (!enabledPacks) return true;
  const required = ROUTE_PACK_TAGS[route];
  if (!required || !required.length) return true;
  return required.every((p) => enabledPacks.includes(p));
}

export function menuFor(
  role: string | undefined,
  enabledPacks?: readonly string[],
): Array<{ group: NavGroup; items: NavEntry[] }> {
  return navGroups
    .map((group) => ({
      group,
      items: navEntries.filter(
        (e) =>
          e.entry === "menu" &&
          e.group === group.id &&
          canAccess(e, role) &&
          packsAllow(e.route, enabledPacks),
      ),
    }))
    .filter((g) => g.items.length > 0);
}

/** 条目所属分区（详情、表单页取其菜单祖先的分区）。 */
export function sectionOf(entry: NavEntry | undefined): NavGroup | undefined {
  const group = menuAncestor(entry)?.group;
  return navGroups.find((g) => g.id === group);
}

/** 分区入口：该分区内当前角色可见的第一个页面。 */
export function sectionHref(groupId: string, role: string | undefined): string | undefined {
  return menuFor(role).find((g) => g.group.id === groupId)?.items[0]?.route;
}

export interface Crumb {
  label: string;
  /** 当前页与无法解析参数的上级没有 href。 */
  href?: string;
  /** 动态路由的参数值（对象 ID）。 */
  detail?: string;
}

/** 面包屑：分区 / 菜单页 / 父链各级 / 当前页，全部由清单 parent 链生成。 */
export function breadcrumbs(pathname: string, role: string | undefined): Crumb[] {
  const entry = matchEntry(pathname);
  const section = sectionOf(entry);
  if (!entry || !section) return [];

  const chain: NavEntry[] = [];
  for (let cur: NavEntry | undefined = entry; cur; cur = cur.parent ? byRoute.get(cur.parent) : undefined) {
    chain.unshift(cur);
    if (cur.entry === "menu") break;
  }

  const actual = segments(pathname);
  const pattern = segments(entry.route);
  const values = pattern.flatMap((p, i) => (isParam(p) ? [decodeURIComponent(actual[i])] : []));

  // 上级路由的参数：与当前路径同前缀时按位置取；否则双方各只有一个参数时复用其值。
  const resolve = (route: string): string | undefined => {
    const parts = segments(route);
    const params = parts.filter(isParam).length;
    const out: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (!isParam(parts[i])) out.push(parts[i]);
      else if (parts.slice(0, i).every((p, j) => p === pattern[j]) && isParam(pattern[i] ?? "")) out.push(actual[i]);
      else if (params === 1 && values.length === 1) out.push(encodeURIComponent(values[0]));
      else return undefined;
    }
    return `/${out.join("/")}`;
  };

  const crumbs: Crumb[] = [{ label: section.label, href: sectionHref(section.id, role) }];
  chain.forEach((item, i) => {
    const last = i === chain.length - 1;
    if (last) {
      crumbs.push({ label: item.label, detail: values.length ? values[values.length - 1] : undefined });
      return;
    }
    const href = resolve(item.route);
    const query = chain[i + 1].parentQuery;
    crumbs.push({ label: item.label, href: href && query ? `${href}?${query}` : href });
  });
  return crumbs;
}

export interface NavCommand {
  kind: "jump" | "action" | "open";
  label: string;
  hint: string;
  href: string;
}

/** 命令面板的固定命令：可见菜单页（跳转）+ 可见的静态表单页（发起类动作）。 */
export function navCommands(role: string | undefined): NavCommand[] {
  const visible = navEntries.filter((e) => canAccess(e, role));
  const jumps = visible
    .filter((e) => e.entry === "menu")
    .map((e): NavCommand => ({ kind: "jump", label: e.label, hint: sectionOf(e)?.label ?? "", href: e.route }));
  const actions = visible
    .filter((e) => e.entry === "contextual" && e.viewLayer === "form" && !e.route.includes("["))
    .map((e): NavCommand => ({ kind: "action", label: e.label, hint: "动作", href: e.route }));
  // 被合并页面的旧名称仍可检索，指向其新地址（如「联邦密算」→ 任务列表的 SecretFlow 分面）。
  const formerNames = navRedirects.flatMap((r): NavCommand[] => {
    const target = matchEntry(r.to);
    return r.label && target && canAccess(target, role)
      ? [{ kind: "jump", label: r.label, hint: `并入 ${target.label}`, href: r.to }]
      : [];
  });
  return [...actions, ...jumps, ...formerNames];
}

/** 按 ID 直达：每个可见的单参数详情页给出一个「打开」命令。 */
export function openByIdCommands(role: string | undefined, id: string): NavCommand[] {
  return navEntries
    .filter((e) => e.viewLayer === "detail" && segments(e.route).filter(isParam).length === 1 && canAccess(e, role))
    .map((e): NavCommand => ({
      kind: "open",
      label: `打开${e.label}`,
      hint: id,
      href: e.route.replace(/\[[^\]]+\]/, encodeURIComponent(id)),
    }));
}

const looksLikeId = (text: string) => /^[A-Za-z0-9][\w.:/-]{2,}$/.test(text);

/** 命令检索：按名称、分区、路径匹配；都不匹配且输入形如对象 ID 时，给出按 ID 直达。 */
export function searchCommands(role: string | undefined, query: string): NavCommand[] {
  const raw = query.trim();
  const all = navCommands(role);
  if (!raw) return all;
  const q = raw.toLowerCase();
  const hits = all.filter((c) => `${c.label} ${c.hint} ${c.href}`.toLowerCase().includes(q));
  if (hits.length) return hits;
  return looksLikeId(raw) ? openByIdCommands(role, raw) : [];
}
