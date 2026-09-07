"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { PageHeader, Panel } from "@/components/console/ui";
import { api } from "@/api/client";
import { submissionWarning } from "@/lib/l0-validation-labels";
import {
  PANCREATITIS_AGE_BANDS,
  scoreWeightBundle,
  type PatientInferForm,
} from "@/lib/fl-local-infer";

export default function FlLocalInferPage() {
  const params = useParams();
  const search = useSearchParams();
  const taskId = String(params.taskId ?? "");
  const contractId = search.get("contractId") ?? "";

  const [form, setForm] = useState<PatientInferForm>({
    ageBand: "50-59",
    sex: "male",
    exposed_insulin: true,
  });

  const { data: bundle, isLoading, error } = useQuery({
    queryKey: ["fl-weight-bundle", taskId],
    queryFn: () => api.getFlWeightBundle(taskId),
    enabled: !!taskId,
  });

  const probability = useMemo(() => {
    if (!bundle) return null;
    return scoreWeightBundle(bundle, form);
  }, [bundle, form]);

  const syntheticWarn = bundle?.trainedOnSynthetic
    ? submissionWarning("synthetic")
    : null;

  return (
    <div>
      <PageHeader
        kicker="INFER · 本地推理"
        title="患者胰腺炎风险（浏览器本地）"
        desc="权重包经合约授权下载后，在本机打分；患者特征不上送控制面或连接器。"
      />
      <div className="p-8 max-w-2xl space-y-6">
        <Link
          href={contractId ? "/space/contracts" : `/space/tasks/${taskId}?workload=fl_prediction`}
          className="inline-flex items-center gap-1.5 text-sm"
          style={{ color: "var(--cs-dim)" }}
        >
          <ArrowLeft size={14} />
          {contractId ? "返回合约列表" : "返回任务详情"}
        </Link>

        {isLoading && (
          <Panel className="p-6 text-sm" style={{ color: "var(--cs-faint)" }}>
            加载权重包…
          </Panel>
        )}
        {error && (
          <Panel className="p-6 text-sm" style={{ color: "var(--cs-red)" }}>
            {(error as Error).message}
          </Panel>
        )}

        {bundle && (
          <>
            {syntheticWarn && (
              <div
                className="p-3 text-[0.72rem] flex items-start gap-2"
                style={{
                  color: "var(--cs-amber)",
                  border: "1px solid var(--cs-amber)",
                }}
              >
                <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                <span>{syntheticWarn}</span>
              </div>
            )}

            <Panel className="p-6 space-y-4">
              <div className="cs-label">模型元数据</div>
              <dl className="space-y-2 text-sm">
                <div className="flex gap-3">
                  <dt className="cs-label w-24 shrink-0">任务</dt>
                  <dd className="cs-mono text-xs">{bundle.taskId}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="cs-label w-24 shrink-0">schema</dt>
                  <dd className="cs-mono text-xs">{bundle.featureSchemaVersion}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="cs-label w-24 shrink-0">modelHash</dt>
                  <dd className="cs-mono text-xs truncate">{bundle.modelHash}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="cs-label w-24 shrink-0">训练 N</dt>
                  <dd className="cs-mono text-xs">{bundle.sampleCount}</dd>
                </div>
              </dl>
            </Panel>

            <Panel className="p-6 space-y-5">
              <div className="cs-label">患者特征（仅本机）</div>
              <div>
                <label className="cs-label">年龄段</label>
                <select
                  className="cs-input mt-1"
                  value={form.ageBand}
                  onChange={(e) => setForm((f) => ({ ...f, ageBand: e.target.value }))}
                >
                  {PANCREATITIS_AGE_BANDS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="cs-label">性别</label>
                <select
                  className="cs-input mt-1"
                  value={form.sex}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      sex: e.target.value as "male" | "female",
                    }))
                  }
                >
                  <option value="male">男</option>
                  <option value="female">女</option>
                </select>
              </div>
              <div>
                <label className="cs-label">糖尿病用药</label>
                <select
                  className="cs-input mt-1"
                  value={form.exposed_insulin ? "insulin" : "metformin"}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      exposed_insulin: e.target.value === "insulin",
                    }))
                  }
                >
                  <option value="insulin">胰岛素（暴露臂）</option>
                  <option value="metformin">二甲双胍（对照臂）</option>
                </select>
              </div>
            </Panel>

            <Panel className="p-6">
              <div className="cs-label mb-2">预测风险</div>
              <div className="text-3xl cs-mono" style={{ color: "var(--cs-cyan)" }}>
                {probability !== null ? `${(probability * 100).toFixed(1)}%` : "—"}
              </div>
              <p className="text-xs mt-3" style={{ color: "var(--cs-faint)" }}>
                逻辑回归 P(急性胰腺炎)。演示模型，不得用于临床决策或监管申报。
              </p>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
