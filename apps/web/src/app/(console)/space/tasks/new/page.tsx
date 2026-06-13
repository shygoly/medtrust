"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { PageHeader, Panel } from "@/components/console/ui";
import { connectors } from "@/lib/space-mock";

const providers = connectors.filter((c) => c.role === "provider");
const purposes = ["药物警戒 / 上市后安全性监测", "真实世界研究 / 疗效评估", "信号探查"];
const retentions = ["阅后即焚", "结果留存 90 天", "结果留存 1 年"];
const outputs = ["仅聚合 / 红旗信号", "仅聚合", "聚合 + 模型参数"];

export default function NewTaskPage() {
  const [title, setTitle] = useState("");
  const [cohort, setCohort] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [purpose, setPurpose] = useState(purposes[0]);
  const [retention, setRetention] = useState(retentions[0]);
  const [output, setOutput] = useState(outputs[0]);
  const [targets, setTargets] = useState<string[]>([providers[0].id]);
  const [submitted, setSubmitted] = useState(false);

  const validUntil = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 90);
    return d.toISOString().slice(0, 10);
  }, []);

  const toggle = (id: string) =>
    setTargets((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  return (
    <div>
      <PageHeader kicker="RWS TASK · 新建" title="发起 RWS 任务" desc="提交后,中心控制面将校验每个目标医院的使用控制策略,通过后下发到其本地连接器执行。" />
      <div className="p-8">
        <Link href="/space/tasks" className="inline-flex items-center gap-1.5 text-sm mb-6" style={{ color: "var(--cs-dim)" }}>
          <ArrowLeft size={14} /> 返回任务列表
        </Link>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* form */}
          <div className="xl:col-span-2 space-y-6">
            <Panel className="p-6 space-y-5">
              <Field label="任务标题">
                <input className="cs-input" placeholder="如:某药物 上市后不良反应信号检测" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="研究目的 (目的限定)">
                <select className="cs-input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                  {purposes.map((p) => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="队列定义">
                <textarea className="cs-textarea" rows={2} placeholder="入排标准、时间窗、人群范围" value={cohort} onChange={(e) => setCohort(e.target.value)} />
              </Field>
              <Field label="分析逻辑">
                <textarea className="cs-textarea" rows={2} placeholder="将在医院本地 TEE 内执行的统计/检测逻辑" value={analysis} onChange={(e) => setAnalysis(e.target.value)} />
              </Field>
            </Panel>

            <Panel className="p-6">
              <div className="cs-label mb-4">目标参与方 (数据提供方)</div>
              <div className="space-y-2">
                {providers.map((p) => {
                  const on = targets.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggle(p.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded text-left"
                      style={{ border: `1px solid ${on ? "var(--cs-cyan)" : "var(--cs-line)"}`, background: on ? "var(--cs-cyan-dim)" : "transparent" }}
                    >
                      <span className={`cs-dot ${on ? "cs-dot-run" : "cs-dot-off"}`} />
                      <span className="flex-1 text-sm">{p.org}</span>
                      <span className="cs-mono text-xs" style={{ color: "var(--cs-faint)" }}>{p.recordCount.toLocaleString()} 行 · 不出域</span>
                    </button>
                  );
                })}
              </div>
            </Panel>

            <div className="grid grid-cols-2 gap-4">
              <Field label="留存约束">
                <select className="cs-input" value={retention} onChange={(e) => setRetention(e.target.value)}>
                  {retentions.map((r) => <option key={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="输出约束">
                <select className="cs-input" value={output} onChange={(e) => setOutput(e.target.value)}>
                  {outputs.map((o) => <option key={o}>{o}</option>)}
                </select>
              </Field>
            </div>
          </div>

          {/* live usage-policy preview */}
          <div className="space-y-6">
            <Panel ticks className="p-6 sticky top-6">
              <div className="cs-label mb-4">使用控制策略 · 预览</div>
              <p className="text-xs mb-4" style={{ color: "var(--cs-faint)" }}>
                该策略将随任务下发到每个连接器,由策略执行点在每次计算前强制校验。
              </p>
              <dl className="space-y-3 text-sm">
                <Prev k="目的限定" v={purpose} />
                <Prev k="留存约束" v={retention} />
                <Prev k="输出约束" v={output} />
                <Prev k="有效期至" v={validUntil} mono />
                <Prev k="目标连接器" v={`${targets.length} 个`} />
              </dl>
              <div className="mt-5 pt-5 border-t space-y-2 text-[0.72rem]" style={{ borderColor: "var(--cs-line-soft)", color: "var(--cs-green)" }}>
                <div className="flex items-center gap-1.5"><ShieldCheck size={13} /> 原始数据不出院,仅聚合结果回传</div>
                <div className="flex items-center gap-1.5"><ShieldCheck size={13} /> 策略哈希将上链存证</div>
              </div>
              <button
                className="cs-btn w-full justify-center mt-5"
                disabled={!title || targets.length === 0}
                style={!title || targets.length === 0 ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
                onClick={() => setSubmitted(true)}
              >
                提交任务 · 校验授权
              </button>
              {submitted && (
                <div className="cs-mono text-[0.7rem] mt-3 text-center" style={{ color: "var(--cs-cyan)" }}>
                  (演示) 任务已提交,等待 {targets.length} 家医院授权校验
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="cs-label block mb-2">{label}</label>
      {children}
    </div>
  );
}

function Prev({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="cs-label shrink-0 w-20 pt-0.5">{k}</dt>
      <dd className={`flex-1 ${mono ? "cs-mono text-xs" : ""}`}>{v}</dd>
    </div>
  );
}
