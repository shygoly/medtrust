"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Panel } from "@/components/console/ui";
import { api, type LoraVerifyReport } from "@/api/client";

type Props = {
  taskId: string;
  enabled?: boolean;
};

const STEP_DELAY_MS = 420;

function StepIcon({ status }: { status: "ok" | "fail" | "skip" | "pending" | "running" }) {
  if (status === "running") {
    return <Loader2 size={16} className="animate-spin" style={{ color: "var(--cs-cyan)" }} />;
  }
  if (status === "ok") {
    return <CheckCircle2 size={16} style={{ color: "var(--cs-green)" }} />;
  }
  if (status === "fail") {
    return <XCircle size={16} style={{ color: "var(--cs-red)" }} />;
  }
  return <Circle size={16} style={{ color: "var(--cs-faint)" }} />;
}

export function LoraDeliverableVerifyPanel({ taskId, enabled = true }: Props) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [report, setReport] = useState<LoraVerifyReport | null>(null);

  const verifyMut = useMutation({
    mutationFn: () => api.verifyDemoLoraDeliverable(taskId),
    onSuccess: (data) => {
      setReport(data);
      setVisibleCount(0);
    },
  });

  const steps = report?.steps ?? [];
  const animating = verifyMut.isSuccess && visibleCount < steps.length;

  useEffect(() => {
    if (!report?.steps.length) return;
    if (visibleCount >= report.steps.length) return;
    const t = window.setTimeout(() => setVisibleCount((n) => n + 1), STEP_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [report, visibleCount]);

  const runVerify = useCallback(() => {
    setReport(null);
    setVisibleCount(0);
    verifyMut.mutate();
  }, [verifyMut]);

  return (
    <Panel className="p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="cs-label mb-1 flex items-center gap-2">
            <ShieldCheck size={14} style={{ color: "var(--cs-cyan)" }} />
            药企侧解密验证 (Demo)
          </div>
          <p className="text-sm" style={{ color: "var(--cs-dim)" }}>
            使用 Demo SM2 私钥在控制面模拟药企安全区解密流程，逐步展示 SM2 开信封 → SM4 解密 → adapter 指纹对账。
          </p>
        </div>
        <button
          type="button"
          className="cs-navlink shrink-0 gap-2 text-xs"
          style={{ borderColor: "var(--cs-cyan)", color: "var(--cs-cyan)" }}
          disabled={!enabled || verifyMut.isPending}
          onClick={runVerify}
        >
          {verifyMut.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" /> 验证中…
            </>
          ) : (
            "运行 Demo 解密验证"
          )}
        </button>
      </div>

      {verifyMut.isError && (
        <p className="text-xs mb-3" style={{ color: "var(--cs-red)" }}>
          验证请求失败: {(verifyMut.error as Error)?.message ?? "请确认已登录药企账号"}
        </p>
      )}

      {(verifyMut.isPending || report) && (
        <div
          className="rounded border p-4 space-y-3 font-mono text-xs"
          style={{ borderColor: "var(--cs-line)", background: "rgba(0,0,0,0.2)" }}
        >
          {verifyMut.isPending && !report && (
            <div className="flex items-center gap-2" style={{ color: "var(--cs-dim)" }}>
              <Loader2 size={14} className="animate-spin" />
              拉取加密包并执行国密解密链…
            </div>
          )}

          {steps.slice(0, visibleCount).map((step, idx) => {
            const isLastVisible = idx === visibleCount - 1;
            const status =
              step.status === "skip"
                ? "skip"
                : step.status === "fail"
                  ? "fail"
                  : isLastVisible && animating
                    ? "running"
                    : step.status;

            return (
              <div key={step.id} className="flex items-start gap-3">
                <StepIcon status={status === "skip" ? "ok" : status} />
                <div className="min-w-0 flex-1">
                  <div style={{ color: step.status === "fail" ? "var(--cs-red)" : "var(--cs-text)" }}>
                    {step.label}
                  </div>
                  {step.detail && (
                    <div className="mt-0.5 break-all" style={{ color: "var(--cs-faint)" }}>
                      {step.detail}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {report && visibleCount >= steps.length && (
            <div
              className="mt-2 pt-3 border-t text-sm"
              style={{
                borderColor: "var(--cs-line)",
                color: report.ok ? "var(--cs-green)" : "var(--cs-red)",
              }}
            >
              {report.ok ? "✓ 验证通过 — adapter 与 loraDeltaHash 一致" : `✗ 验证失败${report.error ? `: ${report.error}` : ""}`}
            </div>
          )}
        </div>
      )}

      {report && visibleCount >= steps.length && (
        <dl className="mt-4 space-y-2 text-xs">
          {report.computedLoraHash && (
            <div className="flex gap-2">
              <dt style={{ color: "var(--cs-faint)" }}>computed</dt>
              <dd className="cs-mono break-all">{report.computedLoraHash}</dd>
            </div>
          )}
          {report.adapterTensorKeys?.length ? (
            <div className="flex gap-2">
              <dt style={{ color: "var(--cs-faint)" }}>tensors</dt>
              <dd className="cs-mono break-all">{report.adapterTensorKeys.join(", ")}</dd>
            </div>
          ) : null}
          {report.cliHint && (
            <div className="flex gap-2">
              <dt style={{ color: "var(--cs-faint)" }}>CLI</dt>
              <dd className="cs-mono break-all">{report.cliHint}</dd>
            </div>
          )}
        </dl>
      )}
    </Panel>
  );
}
