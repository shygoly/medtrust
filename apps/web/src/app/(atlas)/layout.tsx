import type { Metadata } from "next";
import "./atlas.css";
import { codexFontVars } from "./fonts";
import { AtlasProviders } from "./providers";
import { AtlasNav } from "@/components/atlas/atlas-nav";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "七层能力图谱 · MedTrust",
  description: "医疗隐私计算七层解耦 — 能力注册表与合规治理法典",
};

export default function AtlasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(codexFontVars, "codex")}>
      <AtlasProviders>
        <AtlasNav />
        <main className="mx-auto max-w-[1180px] px-6 pb-24 pt-10">{children}</main>
      </AtlasProviders>
    </div>
  );
}
