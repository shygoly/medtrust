import "./atlas.css";
import { codexFontVars } from "./fonts";
import { cn } from "@/lib/utils";

// atlas sits inside the console (.cs) shell. This wrapper only re-maps shadcn
// tokens (.codex) + carries Plex font vars for portaled Dialog/Select; the
// console layout already provides the bg/grid atmosphere, so .codex is nested-safe.
export default function AtlasSectionLayout({ children }: { children: React.ReactNode }) {
  return <div className={cn(codexFontVars, "codex")}>{children}</div>;
}
