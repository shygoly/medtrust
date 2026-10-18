"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/api/client";
import {
  SPACE_COOKIE,
  THEME_COOKIE,
  parseThemeCookie,
  readCookie,
  serializeThemeCookie,
  writeCookie,
} from "@/lib/space-context";

/**
 * 空间切换器（P9.2）+ 零空间空态（P9.4）。
 *
 * 切换动作：换发令牌 → 写空间 cookie 与主题 cookie → 重载。
 * 写 cookie 的原因：令牌在 localStorage，**只有 cookie 能让 SSR 拿到空间/主题**（P7.4）。
 */
export function SpaceSwitcher() {
  const router = useRouter();
  const [spaces, setSpaces] = useState<Array<{ spaceId: string; role: string }>>([]);
  const [active, setActive] = useState<string>("");
  const [ready, setReady] = useState(false);
  const [failing, setFailing] = useState<string | null>(null);

  /**
   * 把当前空间的 theme 写进 cookie，并**返回是否真的变了**（调用方据此决定要不要让 SSR 重渲染）。
   * 比较用序列化后的稳定形态：parseThemeCookie 按白名单顺序重建，顺序不会造成假变化 ——
   * 否则会变成"写 cookie → refresh → 再写 → 再 refresh"的回环。
   */
  const cacheTheme = useCallback(async (spaceId: string): Promise<boolean> => {
    const before = serializeThemeCookie(parseThemeCookie(readCookie(THEME_COOKIE)));
    let next: string;
    try {
      next = serializeThemeCookie((await api.getSpaceTheme(spaceId)) as never);
    } catch {
      next = serializeThemeCookie(null);
    }
    writeCookie(THEME_COOKIE, next);
    return next !== before;
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .getMySpaces()
      .then(async (r) => {
        if (!alive) return;
        const memberships =
          r.memberships && r.memberships.length
            ? r.memberships
            : r.spaces.map((spaceId) => ({ spaceId, role: "" }));
        setSpaces(memberships);
        const ids = memberships.map((item) => item.spaceId);
        const cached = readCookie(SPACE_COOKIE);
        const current = cached && ids.includes(cached) ? cached : r.spaceId;
        setActive(current);
        if (current && current !== cached) {
          writeCookie(SPACE_COOKIE, current);
        }
        // theme cookie **没有空间绑定**：空间 cookie 仍有效时，以前那段"只在空间变化时刷新"
        // 永远不会跑，于是会残留上一个空间的品牌/标题（换账号登录后左上角仍写"医疗"就是这么来的）。
        // 改为每次按当前空间对账；变了才让 SSR 重渲染（左上角品牌与文档标题都读它）。
        if (current) {
          const themeChanged = await cacheTheme(current);
          if (themeChanged) router.refresh();
        }
      })
      .catch(() => { if (alive) setFailing("空间列表不可用"); })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [cacheTheme, router]);

  const switchTo = useCallback(
    async (spaceId: string) => {
      if (!spaceId || spaceId === active) return;
      setFailing(null);
      try {
        const r = await api.switchSpace(spaceId);
        api.setToken(r.access_token);
        writeCookie(SPACE_COOKIE, r.spaceId);
        await cacheTheme(r.spaceId);
        window.location.reload();
      } catch {
        setFailing("切换失败：你可能不属于该空间");
      }
    },
    [active, cacheTheme],
  );

  // P9.4：零空间空态——不猜默认空间，明确引导找运营方入域。
  if (ready && spaces.length === 0) {
    return (
      <div className="px-3 pb-2">
        <div className="cs-panel p-3 text-xs" style={{ borderColor: "var(--cs-amber)" }}>
          <div className="font-medium mb-1" style={{ color: "var(--cs-amber)" }}>
            尚未加入任何空间
          </div>
          <div className="cs-dim leading-relaxed">
            空间由运营方创建，入域需邀请或审批。请联系运营方邀请你加入。
          </div>
        </div>
      </div>
    );
  }

  if (!ready) {
    return <div className="px-3 pb-2"><div className="cs-label">加载空间…</div></div>;
  }

  return (
    <div className="px-3 pb-2 flex flex-col gap-1">
      <label className="cs-label" htmlFor="space-switcher">当前空间</label>
      <select
        id="space-switcher"
        value={active}
        onChange={(e) => void switchTo(e.target.value)}
        className="cs-input text-xs"
        style={{ borderColor: "var(--cs-line)", background: "var(--cs-bg-3)", color: "var(--cs-text)" }}
      >
        {spaces.map((s) => (
          <option key={s.spaceId} value={s.spaceId}>
            {/* 只显示空间名：角色是"我在此空间的成员身份"，不是空间的名字；
                当前角色在侧栏用户名下方已有独立标识（space-nav）。 */}
            {s.spaceId}
          </option>
        ))}
      </select>
      {failing ? (
        <div className="text-xs" style={{ color: "var(--cs-red)" }}>{failing}</div>
      ) : null}
    </div>
  );
}
