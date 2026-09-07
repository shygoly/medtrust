import Link from "next/link";
import { Panel } from "@/components/console/ui";
import { ORCHESTRATION_CREATE_OPTIONS } from "@/lib/orchestration-workloads";

export function WorkloadKindPicker({ currentPath }: { currentPath?: string }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {ORCHESTRATION_CREATE_OPTIONS.map((w) => {
        const path = w.newPath.split("?")[0];
        const active = currentPath === path || currentPath === w.newPath;
        return (
          <Link key={w.newPath} href={w.newPath}>
            <Panel
              className={`p-5 h-full transition-colors hover:border-[var(--cs-cyan)] ${
                active ? "border-[var(--cs-cyan)]" : ""
              }`}
            >
              <div className="cs-label mb-1">{w.kicker}</div>
              <h3 className="text-base font-medium">{w.label}</h3>
              <p className="text-sm mt-2" style={{ color: "var(--cs-dim)" }}>
                {w.description}
              </p>
            </Panel>
          </Link>
        );
      })}
    </div>
  );
}
