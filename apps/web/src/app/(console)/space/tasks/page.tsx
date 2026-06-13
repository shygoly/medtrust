import Link from "next/link";
import { Plus, ShieldOff } from "lucide-react";
import { PageHeader, Panel, TaskStatusBadge } from "@/components/console/ui";
import { tasks } from "@/lib/space-mock";

export default function TasksPage() {
  return (
    <div>
      <PageHeader
        kicker="RWS TASKS · 真实世界研究任务"
        title="RWS 任务"
        desc="药企发起,中心校验合约与授权后下发到医院连接器,在本地 TEE 执行,仅回传聚合结果。"
        action={
          <Link href="/space/tasks/new" className="cs-btn">
            <Plus size={15} /> 发起 RWS 任务
          </Link>
        }
      />
      <div className="p-8 space-y-4">
        {tasks.map((t) => (
          <Link key={t.id} href={`/space/tasks/${t.id}`}>
            <Panel className="px-6 py-5 hover:border-[var(--cs-cyan)] transition-colors" style={{ transition: "border-color 0.15s" }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {t.status === "blocked" && <ShieldOff size={15} style={{ color: "var(--cs-red)" }} />}
                    <h3 className="text-base font-medium">{t.title}</h3>
                  </div>
                  <div className="cs-mono text-xs mt-1" style={{ color: "var(--cs-faint)" }}>
                    {t.id} · {t.initiator} · {t.createdAt}
                  </div>
                  <p className="text-sm mt-2 max-w-3xl" style={{ color: "var(--cs-dim)" }}>
                    {t.analysis}
                  </p>
                </div>
                <TaskStatusBadge status={t.status} />
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <span className="cs-chip">目的 · {t.policy.purpose}</span>
                <span className="cs-chip">留存 · {t.policy.retention}</span>
                <span className="cs-chip">输出 · {t.policy.output}</span>
                <span className="cs-chip" style={{ color: "var(--cs-dim)" }}>
                  {t.targets.length} 家医院
                </span>
              </div>
            </Panel>
          </Link>
        ))}
      </div>
    </div>
  );
}
