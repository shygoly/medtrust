"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { PageHeader, Panel } from "@/components/console/ui";
import { api } from "@/api/client";
import { getUser } from "@/lib/auth";

const analysisTypes = [
  { value: "condition-prevalence", label: "慢病/服务谱分布" },
  { value: "cohort-count", label: "队列规模（年龄带）" },
  { value: "adverse-event-signal", label: "不良反应信号" },
] as const;

export default function NewTaskPage() {
  const [title, setTitle] = useState("");
  const [analysisType, setAnalysisType] = useState<string>("condition-prevalence");
  const [drug, setDrug] = useState("");
  const [contractId, setContractId] = useState("");
  const [msg, setMsg] = useState("");
  const [taskId, setTaskId] = useState("");

  const { data: contracts } = useQuery({
    queryKey: ["contracts"],
    queryFn: () => api.listContracts(),
  });

  const activeContracts = useMemo(() => {
    return ((contracts as any[]) ?? []).filter(
      (c) => (c.effectiveStatus ?? c.status) === "active",
    );
  }, [contracts]);

  const selected = activeContracts.find((c) => c.id === contractId);

  const submit = async () => {
    setMsg("提交中…");
    try {
      const user = getUser();
      if (!user?.participantId) throw new Error("请重新登录");
      if (!contractId) throw new Error("请选择生效数字合约");
      const purpose = selected?.purpose;
      if (!purpose) throw new Error("合约缺少目的字段");

      const r = await api.submitRwsTask({
        title: title || `RWS ${analysisType}`,
        purpose,
        analysis: {
          type: analysisType,
          ...(drug.trim() ? { drug: drug.trim() } : {}),
        },
        contractIds: [contractId],
      });
      setTaskId(r.taskId);
      setMsg(`已提交 ✓ 等待连接器执行`);
    } catch (e: any) {
      setMsg(`失败: ${e?.message ?? "请求错误"}`);
    }
  };

  return (
    <div>
      <PageHeader
        kicker="RWS TASK · 新建"
        title="发起 RWS 任务"
        desc="提交后控制面校验数字合约，各院连接器出站拉取任务，按目录 localDataPath 加载本地数据并执行。"
      />
      <div className="p-8">
        <Link href="/space/tasks" className="inline-flex items-center gap-1.5 text-sm mb-6" style={{ color: "var(--cs-dim)" }}>
          <ArrowLeft size={14} /> 返回任务列表
        </Link>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-6">
            <Panel className="p-6 space-y-5">
              <Field label="任务标题">
                <input className="cs-input" placeholder="如: 肾内科病历文本队列分析" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="生效数字合约">
                <select className="cs-input" value={contractId} onChange={(e) => setContractId(e.target.value)}>
                  <option value="">选择合约…</option>
                  {activeContracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.purpose} · {String(c.providerId)} · {String(c.id).slice(0, 8)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="分析类型">
                <select className="cs-input" value={analysisType} onChange={(e) => setAnalysisType(e.target.value)}>
                  {analysisTypes.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </Field>
              {(analysisType === "cohort-count" || analysisType === "adverse-event-signal") && (
                <Field label="用药过滤（可选）">
                  <input className="cs-input" placeholder="如 influenza" value={drug} onChange={(e) => setDrug(e.target.value)} />
                </Field>
              )}
            </Panel>
          </div>

          <Panel ticks className="p-6 sticky top-6">
            <div className="cs-label mb-4">策略预览</div>
            {selected ? (
              <dl className="space-y-3 text-sm">
                <Prev k="目的" v={selected.purpose} />
                <Prev k="留存" v={selected.retention} />
                <Prev k="输出" v={selected.output} />
                <Prev k="产品" v={String(selected.dataProductId).slice(0, 12)} mono />
              </dl>
            ) : (
              <p className="text-xs" style={{ color: "var(--cs-faint)" }}>选择合约后显示策略</p>
            )}
            <div className="mt-5 pt-5 border-t space-y-2 text-[0.72rem]" style={{ borderColor: "var(--cs-line-soft)", color: "var(--cs-green)" }}>
              <div className="flex items-center gap-1.5"><ShieldCheck size={13} /> 连接器 prefetch 目录 → localDataPath</div>
              <div className="flex items-center gap-1.5"><ShieldCheck size={13} /> 仅聚合结果回传控制面</div>
            </div>
            <button className="cs-btn w-full justify-center mt-5" disabled={!contractId} onClick={submit}>
              提交任务 · 校验授权
            </button>
            {msg && <div className="cs-mono text-[0.7rem] mt-3 text-center" style={{ color: "var(--cs-cyan)" }}>{msg}</div>}
            {taskId && (
              <Link href={`/space/tasks/${taskId}`} className="block text-center text-xs mt-2" style={{ color: "var(--cs-cyan)" }}>
                查看任务 {taskId.slice(0, 8)}…
              </Link>
            )}
          </Panel>
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
