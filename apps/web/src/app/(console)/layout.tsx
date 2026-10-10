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

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${plexMono.variable} ${plexSans.variable} cs`}>
      <ThemeOverrides />
      <AuthGate>
        <ConsoleProviders>
          <div className="relative z-10 flex min-h-screen">
            <SpaceNav />
            <main className="flex-1 min-w-0">
              <SectionBar />
              <RouteGuard>{children}</RouteGuard>
            </main>
          </div>
        </ConsoleProviders>
      </AuthGate>
    </div>
  );
}
