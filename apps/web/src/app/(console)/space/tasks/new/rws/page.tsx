"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Panel } from "@/components/console/ui";
import {
  ContractMultiSelect,
  ContractPolicyPreview,
  Field,
  OrchestrationSubmitPanel,
} from "@/components/console/orchestration";
import { api } from "@/api/client";
import { getUser } from "@/lib/auth";
import { workloadMeta } from "@/lib/orchestration-workloads";

const analysisTypes = [
  { value: "condition-prevalence", label: "慢病/服务谱分布" },
  { value: "cohort-count", label: "队列规模（年龄带）" },
  { value: "adverse-event-signal", label: "不良反应信号" },
] as const;

const meta = workloadMeta("rws");

export default function NewRwsTaskPage() {
  const [title, setTitle] = useState("");
  const [analysisType, setAnalysisType] = useState<string>("condition-prevalence");
  const [drug, setDrug] = useState("");
  const [contractIds, setContractIds] = useState<string[]>([]);
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

  const selected = activeContracts.find((c) => c.id === contractIds[0]);

  const submit = async () => {
    setMsg("提交中…");
    try {
      if (!contractIds.length) throw new Error("请选择生效数字合约");
      const purpose = selected?.purpose;
      if (!purpose) throw new Error("合约缺少目的字段");

      const r = await api.submitRwsTask({
        title: title || `RWS ${analysisType}`,
        purpose,
        analysis: {
          type: analysisType,
          ...(drug.trim() ? { drug: drug.trim() } : {}),
        },
        contractIds,
      });
      setTaskId(r.taskId);
      setMsg("已提交 ✓ 等待连接器执行");
    } catch (e: any) {
      setMsg(`失败: ${e?.message ?? "请求错误"}`);
    }
  };

  return (
    <div>
      <PageHeader
        kicker={`${meta.shortLabel} TASK · 新建`}
        title="发起 RWS 任务"
        desc="提交后控制面校验数字合约，各院连接器出站拉取任务，按目录 localDataPath 加载本地数据并执行。"
      />
      <div className="p-8">
        <Link href="/space/tasks/new" className="inline-flex items-center gap-1.5 text-sm mb-6" style={{ color: "var(--cs-dim)" }}>
          <ArrowLeft size={14} /> 切换任务类型
        </Link>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-6">
            <Panel className="p-6 space-y-5">
              <Field label="任务标题">
                <input className="cs-input" placeholder="如: 肾内科病历文本队列分析" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <ContractMultiSelect
                multiple={false}
                contracts={activeContracts}
                selectedIds={contractIds}
                onChange={setContractIds}
              />
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

          <ContractPolicyPreview contract={selected}>
            <OrchestrationSubmitPanel
              disabled={!contractIds.length}
              onSubmit={submit}
              msg={msg}
              taskId={taskId}
              taskHref={taskId ? `/space/tasks/${taskId}?workload=rws` : undefined}
            />
          </ContractPolicyPreview>
        </div>
      </div>
    </div>
  );
}
