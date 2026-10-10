"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";
import {
  SPACE_COOKIE,
  THEME_COOKIE,
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
  const [spaces, setSpaces] = useState<string[]>([]);
  const [active, setActive] = useState<string>("");
  const [ready, setReady] = useState(false);
  const [failing, setFailing] = useState<string | null>(null);

  const cacheTheme = useCallback(async (spaceId: string) => {
    try {
      const theme = await api.getSpaceTheme(spaceId);
      writeCookie(THEME_COOKIE, serializeThemeCookie(theme as never));
    } catch {
      writeCookie(THEME_COOKIE, serializeThemeCookie(null));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .getMySpaces()
      .then(async (r) => {
        if (!alive) return;
        setSpaces(r.spaces);
        setActive(r.spaceId);
        const cached = readCookie(SPACE_COOKIE);
        if (!cached && r.spaceId) {
          writeCookie(SPACE_COOKIE, r.spaceId);
          await cacheTheme(r.spaceId);
        }
      })
      .catch(() => { if (alive) setFailing("空间列表不可用"); })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [cacheTheme]);

  const switchTo = useCallback(
    async (spaceId: string) => {
      if (!spaceId || spaceId === active) return;
      setFailing(null);
      try {
        const r = await api.switchSpace(spaceId);
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
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      {failing ? (
        <div className="text-xs" style={{ color: "var(--cs-red)" }}>{failing}</div>
      ) : null}
    </div>
  );
}
