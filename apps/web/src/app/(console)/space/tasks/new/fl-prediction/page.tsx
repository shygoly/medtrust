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
import {
  buildFlPredictionSpecFromContracts,
  CKD_FL_FEATURE_COLUMNS,
  flAggregationHint,
  type FlAggregationStrategy,
  type FlDemoPreset,
  type FlModelType,
} from "@/lib/fl-prediction-presets";

const meta = workloadMeta("fl_prediction");

export default function NewFlPredictionTaskPage() {
  const [title, setTitle] = useState("");
  const [contractIds, setContractIds] = useState<string[]>([]);
  const [preset, setPreset] = useState<FlDemoPreset>("pancreatitis_risk");
  const [modelType, setModelType] = useState<FlModelType>("logistic_regression");
  const [aggregation, setAggregation] = useState<FlAggregationStrategy>("fedavg");
  const [targetColumn, setTargetColumn] = useState("pancreatitis_event");
  const [rounds, setRounds] = useState(1);
  const [msg, setMsg] = useState("");
  const [taskId, setTaskId] = useState("");
  const [taskHref, setTaskHref] = useState("");

  const { data: contracts } = useQuery({
    queryKey: ["contracts"],
    queryFn: () => api.listContracts(),
  });

  const activeContracts = useMemo(() => {
    return ((contracts as any[]) ?? []).filter(
      (c) => (c.effectiveStatus ?? c.status) === "active",
    );
  }, [contracts]);

  const selectedContracts = useMemo(
    () => activeContracts.filter((c) => contractIds.includes(c.id)),
    [activeContracts, contractIds],
  );

  const previewContract = selectedContracts[0];

  const submit = async () => {
    setMsg("提交中…");
    try {
      const user = getUser();
      if (!user?.participantId) throw new Error("请重新登录");
      const spec = buildFlPredictionSpecFromContracts(selectedContracts, {
        modelType,
        aggregation,
        targetColumn: targetColumn.trim(),
        rounds,
        consumerParticipantId: user.participantId,
        preset,
      });

      // L4 只走 MDOP 通道（D-MDOP-7 / 5.2 web 收敛）：模板 rws.l4.fl-prediction（各院本地训练 → 平台 merge.fedavg）。
      // 迁移期平台侧对「未到切换日」的 key 仍放行（只记告警，见 mdop.controller 的 assertEntryKeyAllowed）；
      // 旧通道 API 未删（5.4 才删接线），回滚走服务端 ORCHESTRATION_FORCE_CHANNEL。
      const hospitals = selectedContracts
        .map((c) => ({ participantId: c.providerId, dataProductId: c.dataProductId }))
        .filter((h) => h.participantId && h.dataProductId);
      if (!hospitals.length) throw new Error("未能从合约解析出医院与数据产品");
      const now = new Date();
      const r = await api.submitMdopFlPrediction({
        purpose: spec.purpose,
        applicant: { org: user.participantId, project: title || "fl-prediction" },
        contracts: contractIds,
        hospitals,
        spec: spec as unknown as Record<string, unknown>,
        ...(spec.privacy?.minCohortSize ? { minCell: spec.privacy.minCohortSize } : {}),
        notBefore: now.toISOString(),
        notAfter: new Date(now.getTime() + 30 * 24 * 3600_000).toISOString(),
      });
      setTaskId(r.jobId);
      setTaskHref(`/space/mdop/jobs/${encodeURIComponent(r.jobId)}`);
      setMsg(`已提交 MDOP 作业 ${r.jobId}（可在 MDOP 作业页跟进）`);
    } catch (e: any) {
      setMsg(`失败: ${e?.message ?? "请求错误"}`);
    }
  };

  return (
    <div>
      <PageHeader
        kicker={`${meta.shortLabel} · 新建`}
        desc="与 RWS 共用合约准入与连接器出站拉取；各方本地训练后回传 partyResult，控制面合并为 FlRunResult。"
      />
      <div className="p-8">
        <Link href="/space/tasks/new" className="inline-flex items-center gap-1.5 text-sm mb-6" style={{ color: "var(--cs-dim)" }}>
          <ArrowLeft size={14} /> 切换任务类型
        </Link>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-6">
            <Panel className="p-6 space-y-5">
              <Field label="任务标题">
                <input
                  className="cs-input"
                  placeholder="如: CKD ESRD 风险 · 多中心 XGBoost"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <ContractMultiSelect
                contracts={activeContracts}
                selectedIds={contractIds}
                onChange={setContractIds}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="模型类型">
                  <select className="cs-input" value={modelType} onChange={(e) => setModelType(e.target.value as FlModelType)}>
                    <option value="xgboost">XGBoost（演示占位 RF）</option>
                    <option value="logistic_regression">Logistic Regression</option>
                    <option value="random_forest">Random Forest</option>
                  </select>
                </Field>
                <Field label="聚合协议">
                  <select
                    className="cs-input"
                    value={aggregation}
                    onChange={(e) => setAggregation(e.target.value as FlAggregationStrategy)}
                  >
                    <option value="secureboost">SecureBoost（MPC）</option>
                    <option value="fedavg">FedAvg</option>
                  </select>
                </Field>
              </div>
              <p className="text-[0.68rem] -mt-2" style={{ color: "var(--cs-faint)" }}>
                {flAggregationHint(aggregation)}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="标签列">
                  <input className="cs-input" value={targetColumn} onChange={(e) => setTargetColumn(e.target.value)} />
                </Field>
                <Field label="联邦轮次">
                  <input
                    className="cs-input"
                    type="number"
                    min={1}
                    max={50}
                    value={rounds}
                    onChange={(e) => setRounds(Number(e.target.value) || 1)}
                  />
                </Field>
              </div>
              <Field label="特征列（水平联邦 schema 须各方一致）">
                <div className="flex flex-wrap gap-2">
                  {CKD_FL_FEATURE_COLUMNS.map((col) => (
                    <span key={col.name} className="cs-chip cs-mono text-xs">
                      {col.name}:{col.dtype}
                    </span>
                  ))}
                </div>
              </Field>
            </Panel>
          </div>

          <ContractPolicyPreview
            contract={previewContract}
            hints={[
              "structured_ehr 本地训练（connector-ml :5030）",
              "仅 party 指标 + model_hash 出域",
            ]}
          >
            
            <Panel className="p-6 space-y-4">
              <div className="cs-label">演示预设</div>
              <select
                className="cs-input"
                value={preset}
                onChange={(e) => {
                  const v = e.target.value as FlDemoPreset;
                  setPreset(v);
                  if (v === "pancreatitis_risk") {
                    setModelType("logistic_regression");
                    setAggregation("fedavg");
                    setTargetColumn("pancreatitis_event");
                    setRounds(1);
                  } else {
                    setModelType("xgboost");
                    setAggregation("secureboost");
                    setTargetColumn("esrd_event");
                    setRounds(5);
                  }
                }}
              >
                <option value="pancreatitis_risk">糖尿病药 → 胰腺炎风险（FedAvg 逻辑回归 + 权重交付）</option>
                <option value="ckd_esrd">CKD / ESRD 风险（SecureBoost 演示）</option>
              </select>
            </Panel>

            <OrchestrationSubmitPanel
              disabled={contractIds.length < 2}
              onSubmit={submit}
              msg={msg}
              taskId={taskId}
              taskHref={taskHref || undefined}
            />
          </ContractPolicyPreview>
        </div>
      </div>
    </div>
  );
}
