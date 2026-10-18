import type { Metadata } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./console.css";
import { SpaceNav } from "@/components/console/space-nav";
import { AuthGate } from "@/components/console/auth-gate";
import { RouteGuard } from "@/components/console/route-guard";
import { SectionBar } from "@/components/console/section-bar";
import { ConsoleProviders } from "./providers";
import {
  THEME_COOKIE,
  parseThemeCookie,
  resolveDocumentTitle,
  themeCssVariables,
} from "@/lib/space-context";

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
});

const FALLBACK_TITLE = "可信数据空间控制台 · MedTrust";

// P7.4：标题不再硬编码——从空间主题 cookie 解析（令牌在 localStorage，SSR 只能靠 cookie）。
export async function generateMetadata(): Promise<Metadata> {
  const store = await cookies();
  const theme = parseThemeCookie(store.get(THEME_COOKIE)?.value ?? null);
  return {
    title: resolveDocumentTitle(theme, FALLBACK_TITLE),
    description: "联邦可信数据空间 — 数据不出域,可用不可见",
  };
}

/** 受约束的空间主题覆盖层（值已过白名单 + 格式校验，只产出 #rrggbb 及其派生 rgba）。 */
async function ThemeOverrides() {
  const store = await cookies();
  const theme = parseThemeCookie(store.get(THEME_COOKIE)?.value ?? null);
  const vars = themeCssVariables(theme);
  const body = Object.entries(vars)
    .map(([k, v]) => k + ":" + v + ";")
    .join("");
  if (!body) return null;
  return <style>{`.cs,.codex{ ${body} }`}</style>;
}

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // 左上角品牌 = 当前空间的主题名（空间品牌 > 实例 > 平台，由控制面 resolve 后写进 theme cookie）。
  // 放服务端解析：SSR 就出正确品牌，不会先闪一下「医疗」再变成「电力」。
  const theme = parseThemeCookie((await cookies()).get(THEME_COOKIE)?.value ?? null);
  const brand = theme?.title?.trim() || theme?.shortName?.trim() || undefined;
  return (
    <div className={`${plexMono.variable} ${plexSans.variable} cs`}>
      <ThemeOverrides />
      <AuthGate>
        <ConsoleProviders>
          {/* 导航区与工作区分离（DESIGN §3）：外壳固定一屏高，两列各自内部滚动，页面整体不滚。
              侧栏恒为满视口列，身份/状态块钉在底部；工作区独立滚动。 */}
          <div className="relative z-10 flex h-dvh overflow-hidden">
            <SpaceNav brand={brand} />
            <main className="flex-1 min-w-0 overflow-y-auto">
              <SectionBar />
              <RouteGuard>{children}</RouteGuard>
            </main>
          </div>
        </ConsoleProviders>
      </AuthGate>
    </div>
  );
}
