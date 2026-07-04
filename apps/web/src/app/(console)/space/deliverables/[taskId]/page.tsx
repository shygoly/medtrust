"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Download, ShieldCheck } from "lucide-react";
import { PageHeader, Panel } from "@/components/console/ui";
import { AsyncBoundary } from "@/components/console/data";
import { ConsumerModelBrief } from "@/components/console/consumer-model-brief";
import { useAuth } from "@/lib/auth";
import { api } from "@/api/client";
import {
  federatedConnectorsLabel,
  federatedStateColor,
  federatedStateLabel,
  participantLabel,
  type SecretFlowMergedResult,
} from "@/lib/federated-tasks";
import { artifactLabel } from "@/lib/consumer-model-brief";

function Row({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="cs-label shrink-0 w-28 pt-0.5">{k}</dt>
      <dd className={`flex-1 min-w-0 ${mono ? "cs-mono text-xs break-all" : ""}`}>{v}</dd>
    </div>
  );
}

function DeliverableDetailBody() {
  const params = useParams<{ taskId: string }>();
  const taskId = decodeURIComponent(params.taskId ?? "");

  const settlementQ = useQuery({
    queryKey: ["settlements", "consumer", taskId],
    queryFn: async () => {
      const all = (await api.getSettlements()) as any[];
      return all.find((s) => s.taskId === taskId);
    },
    enabled: !!taskId,
  });

  const statusQ = useQuery({
    queryKey: ["secretflow-task", taskId],
    queryFn: () => api.getSecretFlowTask(taskId),
    enabled: !!taskId,
    retry: false,
  });

  const resultQ = useQuery({
    queryKey: ["secretflow-result", taskId],
    queryFn: () => api.getSecretFlowResult(taskId) as Promise<SecretFlowMergedResult>,
    enabled: !!taskId && (statusQ.data?.state === "COMPLETED" || !statusQ.data),
    retry: false,
  });

  const downloadMut = useMutation({
    mutationFn: () => api.downloadLoraDeliverableFile(taskId),
  });

  const result = resultQ.data;
  const state = statusQ.data?.state ?? result?.state ?? "—";
  const loading = settlementQ.isLoading;
  const error = settlementQ.error;
  const loraHash =
    result?.loraDeltaHash ??
    (settlementQ.data?.taskRef?.startsWith("ATT:")
      ? `LORA:${String(settlementQ.data.taskRef).slice(4)}`
      : undefined);

  return (
    <div>
      <PageHeader
        kicker={`DELIVERABLE · ${taskId}`}
        title="模型交付详情"
        desc="数字合约授权下,您有权保存与审计的联邦训练安全制品。"
        action={
          state !== "—" ? (
            <span className="cs-chip" style={{ color: federatedStateColor(state), borderColor: federatedStateColor(state) }}>
              {federatedStateLabel(state)}
            </span>
          ) : undefined
        }
      />
      <div className="p-8 space-y-6">
        <Link href="/space/deliverables" className="inline-flex items-center gap-1.5 text-sm" style={{ color: "var(--cs-dim)" }}>
          <ArrowLeft size={14} /> 返回交付列表
        </Link>

        <AsyncBoundary
          loading={loading}
          error={error}
          empty={!settlementQ.data && !loading}
          emptyText="未找到与您账号关联的该任务交付记录。"
          errorText="无法加载交付记录。"
        >
          {loraHash && (
            <Panel className="p-6" style={{ borderColor: "var(--cs-cyan)" }}>
              <div className="flex items-start gap-3">
                <CheckCircle2 size={22} style={{ color: "var(--cs-green)", marginTop: 2 }} />
                <div className="flex-1 min-w-0">
                  <div className="cs-label mb-2">您的联邦 LoRA 交付指纹</div>
                  <div className="cs-mono text-2xl font-semibold break-all" style={{ color: "var(--cs-cyan)" }}>
                    {loraHash}
                  </div>
                  <p className="text-sm mt-3" style={{ color: "var(--cs-dim)" }}>
                    这是 Meditron-7B + LoRA 在{" "}
                    {federatedConnectorsLabel(result?.metrics?.federatedConnectors) || "多家医院"}{" "}
                    本地数据上联邦训练后,控制面合并得到的<strong>增量适配器指纹</strong>。可用于与链上存证、合约
                    taskRef 对账;加密 LoRA 包可通过下方按钮下载(SM2 信封;解密需在药企安全区进行)。
                  </p>
                </div>
              </div>
            </Panel>
          )}


          {(result?.deliverableAvailable || result?.encryptedDeltaRef) && (
            <Panel className="p-6">
              <div className="cs-label mb-3">加密 LoRA 增量包</div>
              <dl className="space-y-3 mb-4">
                <Row k="引用" v={result?.encryptedDeltaRef ?? "—"} mono />
                <Row k="算法" v="SM4-CBC + SM2 信封" />
                <Row k="校验" v="解密后 adapter 指纹应等于上方 loraDeltaHash" />
              </dl>
              <button
                type="button"
                className="cs-navlink justify-center gap-2"
                style={{ borderColor: "var(--cs-cyan)", color: "var(--cs-cyan)" }}
                disabled={downloadMut.isPending || !result?.deliverableAvailable}
                onClick={() => downloadMut.mutate()}
              >
                <Download size={16} />
                {downloadMut.isPending ? "下载中…" : "下载 .enc.json"}
              </button>
              {downloadMut.isError && (
                <p className="text-xs mt-3" style={{ color: "var(--cs-red)" }}>
                  下载失败: {(downloadMut.error as Error)?.message ?? "请确认已登录药企账号且任务已完成"}
                </p>
              )}
            </Panel>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6">
              <ConsumerModelBrief />

              {result?.metrics && (
                <Panel className="p-6">
                  <div className="cs-label mb-4">训练质量摘要(聚合指标)</div>
                  <dl className="space-y-3">
                    <Row k="参与医院" v={federatedConnectorsLabel(result.metrics.federatedConnectors)} />
                    <Row k="训练 Loss" v={result.metrics.trainLoss?.toFixed(4) ?? "—"} mono />
                    <Row k="完成轮次" v={result.roundsCompleted ?? statusQ.data?.currentEpoch ?? "—"} />
                    <Row
                      k="Loss 变化"
                      v={
                        result.metrics.lossReduction != null
                          ? `${result.metrics.lossReduction > 0 ? "↓" : "↑"} ${Math.abs(result.metrics.lossReduction).toFixed(2)}`
                          : "—"
                      }
                    />
                  </dl>
                  <p className="text-xs mt-4" style={{ color: "var(--cs-faint)" }}>
                    指标由各院本地训练结果平均/聚合而来,用于内部 go/no-go 评估,不构成临床诊断输出。
                  </p>
                </Panel>
              )}

              <Panel className="p-6">
                <div className="cs-label mb-4">建议使用流程</div>
                <ol className="space-y-3 text-sm list-decimal pl-5" style={{ color: "var(--cs-dim)" }}>
                  <li>核对本页 LoRA 哈希与「存证账本」/结算 taskRef 是否一致。</li>
                  <li>确认数字合约 purpose、留存与 output 策略仍有效(未 revoke)。</li>
                  <li>在药企安全区(TEE/沙箱)加载后续版本的 encrypted_delta_ref 时,用 hash 校验完整性。</li>
                  <li>将 aggregate_metrics 纳入模型治理文档,再决定是否进入 RWE 分析或注册路径。</li>
                </ol>
              </Panel>
            </div>

            <div className="space-y-6">
              <Panel className="p-6">
                <div className="cs-label mb-4">合约与费用</div>
                {settlementQ.data ? (
                  <dl className="space-y-3">
                    <Row k="应付总额" v={`${settlementQ.data.total} ${settlementQ.data.currency}`} mono />
                    <Row k="存证引用" v={settlementQ.data.taskRef ?? "—"} mono />
                    <Row k="结算时间" v={settlementQ.data.at ? new Date(settlementQ.data.at).toLocaleString() : "—"} />
                  </dl>
                ) : (
                  <p className="text-sm" style={{ color: "var(--cs-faint)" }}>暂无结算记录</p>
                )}
                <Link href="/space/contracts" className="cs-navlink mt-4 justify-center text-xs" style={{ borderColor: "var(--cs-line)" }}>
                  查看数字合约 →
                </Link>
              </Panel>

              {result?.contributions && (
                <Panel className="p-6">
                  <div className="cs-label mb-4">医院贡献(分账依据)</div>
                  <div className="space-y-3">
                    {result.contributions.map((c) => (
                      <div key={c.participantId} className="flex justify-between text-sm">
                        <span>{participantLabel(c.participantId)}</span>
                        <span className="cs-mono" style={{ color: "var(--cs-cyan)" }}>
                          {(c.share * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              <Panel className="p-6">
                <div className="cs-label mb-3 flex items-center gap-2">
                  <ShieldCheck size={14} style={{ color: "var(--cs-green)" }} />
                  合约放行制品
                </div>
                <ul className="space-y-2 text-sm" style={{ color: "var(--cs-dim)" }}>
                  {["lora_delta_hash", "aggregate_metrics", "attestation_report", "encrypted_delta_ref"].map((a) => (
                    <li key={a} className="flex items-center gap-2">
                      <span className="cs-dot cs-dot-on" />
                      {artifactLabel(a)}
                      {a === "lora_delta_hash" && loraHash && (
                        <span className="cs-chip text-[0.6rem]" style={{ color: "var(--cs-green)" }}>
                          已交付
                        </span>
                      )}
                      {a === "encrypted_delta_ref" && result?.deliverableAvailable && (
                        <span className="cs-chip text-[0.6rem]" style={{ color: "var(--cs-green)" }}>
                          可下载
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>

              {result?.attestation && (
                <Panel className="p-6">
                  <div className="cs-label mb-4">运行存证</div>
                  <dl className="space-y-3">
                    <Row k="报告哈希" v={result.attestation.reportHash ?? "—"} mono />
                    <Row k="运行时" v={result.attestation.runtime ?? "—"} mono />
                  </dl>
                  <Link href="/space/attestations" className="cs-navlink mt-4 justify-center text-xs" style={{ borderColor: "var(--cs-line)" }}>
                    存证账本 →
                  </Link>
                </Panel>
              )}
            </div>
          </div>
        </AsyncBoundary>
      </div>
    </div>
  );
}

export default function DeliverableDetailPage() {
  const { ready, role } = useAuth();
  if (!ready) return null;
  if (role !== "consumer") {
    return (
      <div className="p-8">
        <Panel className="p-6 text-sm" style={{ color: "var(--cs-dim)" }}>
          此页仅面向数据使用方。请使用{" "}
          <Link href="/space/federated" className="underline" style={{ color: "var(--cs-cyan)" }}>
            联邦密算
          </Link>{" "}
          查看技术详情。
        </Panel>
      </div>
    );
  }
  return <DeliverableDetailBody />;
}
