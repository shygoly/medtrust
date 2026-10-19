/**
 * 空间上下文（前端）— P9 / D-SPD-15。
 *
 * 选定变体：**保持 /space/... 路径不变，由 cookie 携带空间**（DOC1 §L7 明确允许的
 * 等价做法）。理由：令牌存在 localStorage，SSR 读不到——只有 cookie 能让
 * **服务端**同时拿到空间上下文以渲染标题与主题。API 调用另附 `X-Space-Id` 头。
 */
export const SPACE_COOKIE = "medtrust_space";
export const THEME_COOKIE = "medtrust_space_theme";
export const SPACE_HEADER = "X-Space-Id";

/** 允许进入主题 cookie 的字段（与 DESIGN.md §1.5 白名单一致）。 */
export const THEME_COOKIE_KEYS = [
  "title",
  "shortName",
  "logoKey",
  "primary",
  "accent",
] as const;

export type ThemeCookieKey = (typeof THEME_COOKIE_KEYS)[number];
export type SpaceThemeCookie = Partial<Record<ThemeCookieKey, string>>;

const MAX_VALUE_LENGTH = 200;
const HEX = /^#[0-9a-f]{6}$/i;
const OBJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** 解析 Cookie 头为键值表（服务端可用）。 */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

/**
 * 解析并**严格校验**主题 cookie。
 * cookie 是用户可控数据：不在白名单的键、超长值、非法颜色 / 外链图片一律丢弃，
 * 只当纯文本标题使用（MUST NOT 进 HTML）。
 */
export function parseThemeCookie(raw: string | null | undefined): SpaceThemeCookie | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: SpaceThemeCookie = {};
  for (const key of THEME_COOKIE_KEYS) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    const v = value.trim();
    if (!v || v.length > MAX_VALUE_LENGTH) continue;
    if (key === "primary" || key === "accent") {
      if (!HEX.test(v)) continue;
    }
    if (key === "logoKey") {
      if (!OBJECT_KEY.test(v) || /^https?:/i.test(v)) continue; // 禁外链
    }
    out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

export function serializeThemeCookie(theme: SpaceThemeCookie | null | undefined): string {
  const safe = parseThemeCookie(JSON.stringify(theme ?? {}));
  return JSON.stringify(safe ?? {});
}

/** SSR 文档标题：空间主题 → 回退标题。 */
export function resolveDocumentTitle(
  theme: SpaceThemeCookie | null,
  fallback = "MedTrust 可信数据空间",
): string {
  const title = theme?.title?.trim() || theme?.shortName?.trim();
  return title ? title : fallback;
}

/** 浏览器端读取 cookie（服务端请用 next/headers）。 */
export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const hit = document.cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(name + "="));
  if (!hit) return null;
  try {
    return decodeURIComponent(hit.slice(name.length + 1));
  } catch {
    return hit.slice(name.length + 1);
  }
}

export function writeCookie(name: string, value: string, days = 180): void {
  if (typeof document === "undefined") return;
  const maxAge = Math.max(0, Math.floor(days * 86400));
  document.cookie =
    name + "=" + encodeURIComponent(value) + ";path=/;max-age=" + maxAge + ";samesite=lax";
}

/** 清掉空间 cookie（空间上下文被后端拒绝、或与本人成员关系不符时调用）。 */
export function clearSpaceCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = SPACE_COOKIE + "=;path=/;max-age=0;samesite=lax";
}

/**
 * 把 cookie 里的空间与**本人成员关系**对账。
 *
 * 背景（实测的死循环）：用户换空间或被调整成员后，cookie 仍指着旧空间，
 * 后端 SpaceGuard 按契约回 403「无权访问该空间」；前端把它当成 403 会话拒绝 →
 * 清会话弹 /login?expired=1，而坏 cookie 还在，重新登录又被同一个 403 弹回来。
 *
 * 返回应改写的空间 id；cookie 本身就合法、或成员关系未知时返回 null（不猜、不改写）。
 */
export function reconcileSpaceId(
  cookieSpace: string | null | undefined,
  memberships: readonly string[] | undefined,
  fallbackSpaceId?: string | null,
): string | null {
  const current = (cookieSpace ?? "").trim();
  const list = (memberships ?? []).filter((s) => typeof s === "string" && s.length > 0);
  if (list.length === 0) return null; // 不知道成员关系 → 不动 cookie
  if (current && list.includes(current)) return null; // 合法
  const next = (fallbackSpaceId ?? "").trim() || list[0]!;
  return next === current ? null : next;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * 主题令牌 → CSS 变量（**只映射契约声明的变量**，DESIGN §1.5）。
 * 值已过 parseThemeCookie 校验，故只会产生 #rrggbb 与由它派生的 rgba。
 */
export function themeCssVariables(theme: SpaceThemeCookie | null): Record<string, string> {
  const out: Record<string, string> = {};
  const primary = theme?.primary ? hexToRgb(theme.primary) : null;
  if (primary) {
    const rgb = primary.join(",");
    out["--cs-cyan"] = theme!.primary!;
    out["--cs-cyan-dim"] = "rgba(" + rgb + ",0.15)";
    out["--cs-glow"] = "rgba(" + rgb + ",0.5)";
  }
  const accent = theme?.accent ? hexToRgb(theme.accent) : null;
  if (accent) out["--cs-green"] = theme!.accent!;
  return out;
}

/** API 调用的空间头（仅在本用户已属的空间下发，见后端 SpaceGuard）。 */
export function spaceHeaders(spaceId: string | null | undefined): Record<string, string> {
  return spaceId ? { [SPACE_HEADER]: spaceId } : {};
}

/**
 * 路由 → 所需能力包。基座路由（未登记）任何启用集都可见；
 * 这里登记的是**行业专属**页面（目前为医疗包）。
 */
export const ROUTE_PACK_TAGS: Readonly<Record<string, readonly string[]>> = {
  "/space/rbqm": ["med"],
  "/space/infer": ["med"],
  "/space/tasks/new/rws": ["med"],
  "/space/tasks/new/registration": ["med"],
  "/space/tasks/new/fl-prediction": ["med"],
};

/**
 * 导航按**能力包启用集**过滤（P9.3）。
 * 映射放在前端 lib（不动受 check-nav 守护的 nav.manifest.json）。
 */
export function filterNavByEnabledPacks<T extends { route: string }>(
  entries: readonly T[],
  enabledPacks: readonly string[],
  routePacks: Readonly<Record<string, readonly string[]>>,
): T[] {
  const enabled = new Set(enabledPacks);
  return entries.filter((e) => {
    const required = routePacks[e.route];
    if (!required || !required.length) return true; // 基座页面，任何启用集都可见
    return required.every((p) => enabled.has(p));
  });
}
