import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./console.css";
import { SpaceNav } from "@/components/console/space-nav";
import { AuthGate } from "@/components/console/auth-gate";

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

export const metadata: Metadata = {
  title: "可信数据空间控制台 · MedTrust",
  description: "联邦可信数据空间 — 数据不出域,可用不可见",
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${plexMono.variable} ${plexSans.variable} cs`}>
      <AuthGate>
        <div className="relative z-10 flex min-h-screen">
          <SpaceNav />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </AuthGate>
    </div>
  );
}
