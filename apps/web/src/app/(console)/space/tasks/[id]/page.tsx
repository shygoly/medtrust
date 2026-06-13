import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck, ShieldOff, Filter } from "lucide-react";
import { PageHeader, Panel, TaskStatusBadge, NodeStateBadge } from "@/components/console/ui";
import { tasks, attestations } from "@/lib/space-mock";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = tasks.find((t) => t.id === id);
  if (!task) notFound();

  const atts = attestations.filter((a) => a.taskId === task.id);

  return (
    <div>
      <PageHeader
        kicker={`RWS TASK · ${task.id}`}
        title={task.title}
        desc={`${task.initiator} 发起 · ${task.createdAt}`}
        action={<TaskStatusBadge status={task.status} />}
      />
      <div className="p-8">
        <Link href="/space/tasks" className="inline-flex items-center gap-1.5 text-sm mb-6" style={{ color: "var(--cs-dim)" }}>
          <ArrowLeft size={14} /> 返回任务列表
        </Link>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* left: definition + execution */}
          <div className="xl:col-span-2 space-y-6">
            <Panel className="p-6">
              <div className="cs-label mb-4">任务定义</div>
              <dl className="space-y-3 text-sm">
                <Row k="研究目的" v={task.purpose} />
                <Row k="队列定义" v={task.cohort} />
                <Row k="分析逻辑" v={task.analysis} />
              </dl>
            </Panel>

            <Panel ticks className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="cs-label">跨连接器执行 · 数据在各院本地 TEE 内运行</div>
              </div>
              <div className="space-y-4">
                {task.targets.map((n) => (
                  <div key={n.connectorId}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm">{n.org}</span>
                      <NodeStateBadge state={n.state} />
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--cs-bg-3)" }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${n.progress}%`,
                          background: n.state === "denied" ? "var(--cs-red)" : n.state === "returned" ? "var(--cs-green)" : "var(--cs-cyan)",
                        }}
                      />
                    </div>
                    {n.note && (
                      <div className="cs-mono text-[0.7rem] mt-1.5 flex items-center gap-1.5" style={{ color: n.state === "denied" ? "var(--cs-red)" : "var(--cs-dim)" }}>
                        {n.state === "denied" ? <ShieldOff size={11} /> : <Filter size={11} />}
                        {n.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Panel>

            {/* output gate result */}
            <Panel className="p-6" style={task.status === "blocked" ? { borderColor: "var(--cs-red)" } : undefined}>
              <div className="cs-label mb-4">输出闸门</div>
              {task.output ? (
                <div>
                  <div className="flex items-center gap-2 text-sm mb-3" style={{ color: "var(--cs-green)" }}>
                    <ShieldCheck size={16} /> 已放行 · {task.output.kind}
                  </div>
                  <p className="text-sm" style={{ color: "var(--cs-dim)" }}>{task.output.summary}</p>
                  <div className="cs-chip mt-3">小单元格抑制 · {task.output.rowsSuppressed} 处</div>
                </div>
              ) : task.status === "blocked" ? (
                <div className="flex items-center gap-2 text-sm" style={{ color: "var(--cs-red)" }}>
                  <ShieldOff size={16} /> 已拦截 · 输出含行级可识别数据,原始数据未离开连接器
                </div>
              ) : (
                <div className="text-sm" style={{ color: "var(--cs-faint)" }}>
                  任务执行中,尚无通过闸门的输出。仅聚合结果可放行,原始行级数据物理上无出口。
                </div>
              )}
            </Panel>
          </div>

          {/* right: policy + attestations */}
          <div className="space-y-6">
            <Panel className="p-6">
              <div className="cs-label mb-4">使用控制策略</div>
              <dl className="space-y-3 text-sm">
                <Row k="目的限定" v={task.policy.purpose} />
                <Row k="留存约束" v={task.policy.retention} />
                <Row k="输出约束" v={task.policy.output} />
                <Row k="有效期至" v={task.policy.validUntil} mono />
              </dl>
              <div className="cs-mono text-[0.68rem] mt-4 pt-4 border-t" style={{ color: "var(--cs-faint)", borderColor: "var(--cs-line-soft)" }}>
                策略由连接器策略执行点(PEP)在每次计算前强制校验
              </div>
            </Panel>

            <Panel className="p-6">
              <div className="cs-label mb-4">上链存证</div>
              {atts.length ? (
                <div className="space-y-4">
                  {atts.map((a) => (
                    <div key={a.id} className="text-sm">
                      <div className="flex items-center gap-2">
                        <span className="cs-dot cs-dot-on" />
                        <span className="cs-mono text-xs" style={{ color: "var(--cs-cyan)" }}>{a.txHash}</span>
                      </div>
                      <div className="cs-mono text-[0.68rem] mt-1 space-y-0.5" style={{ color: "var(--cs-faint)" }}>
                        <div>输入指纹 {a.inputFingerprint}</div>
                        <div>输出哈希 {a.outputHash}</div>
                        <div>#{a.block.toLocaleString()} · {a.at}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm" style={{ color: "var(--cs-faint)" }}>暂无存证记录</div>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="cs-label shrink-0 w-20 pt-0.5">{k}</dt>
      <dd className={`flex-1 ${mono ? "cs-mono text-xs" : ""}`} style={{ color: "var(--cs-text)" }}>
        {v}
      </dd>
    </div>
  );
}
