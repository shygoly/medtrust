"use client";

import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/console/ui";
import { TaskBrowseHeader } from "@/components/console/task-browse-header";
import { MdopResultPanel, OpsDetails } from "@/components/console/mdop-result-panel";
import { api } from "@/api/client";
import { afterMdopSubmit } from "@/lib/mdop-submit";
import { releaseManifestView } from "@/lib/release-manifest-view";
import { witnessStatusView } from "@/lib/witness-status-view";
import { c3InterpretPayload } from "@/lib/c3-interpret-payload";
import { ResultInterpretationPanel } from "@/components/console/result-interpretation-panel";
import { registrationResultView } from "@/lib/registration-result-view";
import { RegistrationResultPanel } from "@/components/console/registration-result-panel";
import { mdopBadge, taskDisplayTitle, taskListHref } from "@/lib/task-list";
import { statusLabel } from "@/lib/task-status";
import {
  mdopResultEmptyHint,
  mdopResultView,
  nodeParticipantId,
} from "@/lib/mdop-result-view";
import { participantLabel } from "@/lib/federated-tasks";

/**
 * MDOP 作业详情（task-detail）：层 A 结论 → 层 B 进度 → 层 C 运维折叠。
 */
export default function MdopJobDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = decodeURIComponent(String(params?.id ?? ""));
  const queryClient = useQueryClient();
  const [compiling, setCompiling] = useState(false);
  const [compileMsg, setCompileMsg] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["mdop-job", jobId],
    queryFn: () => api.getMdopJob(jobId),
    enabled: Boolean(jobId),
    retry: false,
  });

  const manifestView = releaseManifestView(data?.result ?? null);
  const interpretPayload = c3InterpretPayload(data?.result ?? null);
  const registrationView = registrationResultView(data?.result ?? null);
  const witnessView = witnessStatusView(
    (data as { witnessStatus?: unknown } | undefined)?.witnessStatus,
  );
  const resultView = useMemo(() => mdopResultView(data?.result ?? null), [data?.result]);

  const job = data?.job as
    | {
        status?: string;
        purpose?: string;
        createdAt?: string;
        rejectReason?: string | null;
        planHash?: string | null;
        applicant?: { org?: string; project?: string };
        contracts?: string[];
        contractBundleId?: string | null;
        contractBundleVersion?: string | null;
        contractBindings?: Array<{
          contractId: string;
          participantId: string;
          dataProductId: string;
          role: string;
          stages: string[];
        }> | null;
      }
    | undefined;

  const badge = mdopBadge(job?.status, {
    rejectReason: job?.rejectReason,
    hasResult: data?.result != null,
  });
  const displayTitle = taskDisplayTitle({
    applicantProject: job?.applicant?.project,
    purpose: job?.purpose,
    fallbackId: jobId,
  });
  const contractSummaries = useMemo(() => {
    const ids = job?.contracts ?? [];
    return ids.map((id) => ({
      id,
      label: job?.purpose?.trim() || "数字合约",
    }));
  }, [job?.contracts, job?.purpose]);

  return (
    <TaskBrowseHeader
      channel="mdop"
      title={displayTitle}
      taskId={jobId || "作业"}
      initiatorId={job?.applicant?.org}
      createdAt={job?.createdAt}
      badge={badge}
      backHref={taskListHref({ channel: "mdop" })}
      backLabel="返回作业列表"
      contractSummaries={contractSummaries}
    >
      <div className="space-y-4">
        {isLoading ? (
          <Panel className="p-6 cs-label">加载中…</Panel>
        ) : error ? (
          <Panel className="p-6 text-sm" style={{ color: "var(--cs-red)" }}>
            读取失败：{(error as Error)?.message}
          </Panel>
        ) : !data ? null : (
          <>
            {/* —— 作业状态叙事（与页头四态一致） —— */}
            <Panel className="p-6">
              <div className="cs-label mb-3">作业状态</div>
              <dl className="text-sm grid grid-cols-2 gap-y-1.5">
                <dt style={{ color: "var(--cs-dim)" }}>状态</dt>
                <dd>
                  <span>{statusLabel[badge]}</span>
                  {job?.status ? (
                    <span className="cs-mono text-[0.65rem] ml-2" style={{ color: "var(--cs-faint)" }}>
                      {job.status}
                    </span>
                  ) : null}
                </dd>
                <dt style={{ color: "var(--cs-dim)" }}>用途</dt>
                <dd>{job?.purpose ?? "—"}</dd>
              </dl>
              {job?.status === "PURGED" ? (
                <p className="text-[0.75rem] mt-3" style={{ color: "var(--cs-dim)" }}>
                  中间制品已按策略销毁；下列为保留的合并交付物（若有）。原始状态 PURGED
                  不表示无结论或已取消。
                </p>
              ) : null}
              {job?.rejectReason ? (
                <p className="text-sm mt-3" style={{ color: "var(--cs-red)" }}>
                  失败原因：{job.rejectReason}
                </p>
              ) : null}
              {job?.status === "SUBMITTED" ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="cs-btn text-sm"
                    disabled={compiling}
                    onClick={async () => {
                      setCompiling(true);
                      setCompileMsg("");
                      try {
                        const compiled = await afterMdopSubmit(jobId);
                        setCompileMsg(
                          `已编译，状态 ${compiled.status}` +
                            (compiled.offeredNodes?.length
                              ? ` · 已要约 ${compiled.offeredNodes.length} 个节点`
                              : ""),
                        );
                        await queryClient.invalidateQueries({
                          queryKey: ["mdop-job", jobId],
                        });
                      } catch (e: unknown) {
                        setCompileMsg((e as Error)?.message || "编译失败");
                      } finally {
                        setCompiling(false);
                      }
                    }}
                  >
                    {compiling ? "编译中…" : "编译并发起要约"}
                  </button>
                  {compileMsg ? (
                    <span
                      className="text-sm"
                      style={{
                        color: compileMsg.includes("失败")
                          ? "var(--cs-red)"
                          : "var(--cs-dim)",
                      }}
                    >
                      {compileMsg}
                    </span>
                  ) : (
                    <span className="text-sm" style={{ color: "var(--cs-dim)" }}>
                      作业已提交但尚未编译；阶段表在编译后才会出现。
                    </span>
                  )}
                </div>
              ) : null}
            </Panel>

            {/* —— 层 A：结论 —— */}
            {data.result ? (
              <MdopResultPanel view={resultView} manifestView={manifestView}>
                {resultView.kind === "fl-prediction" ? (
                  <FlExtras result={data.result} />
                ) : null}
                {(data.result.warnings ?? []).length > 0 ? (
                  <ul className="text-[0.75rem] space-y-1" style={{ color: "var(--cs-amber)" }}>
                    {(data.result.warnings ?? []).map((w) => (
                      <li key={w.code}>
                        {w.code}：{w.detail}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </MdopResultPanel>
            ) : (
              <Panel className="p-6 text-sm" style={{ color: "var(--cs-dim)" }}>
                {mdopResultEmptyHint(job?.status)}
              </Panel>
            )}

            {registrationView ? <RegistrationResultPanel view={registrationView} /> : null}
            {interpretPayload ? <ResultInterpretationPanel payload={interpretPayload} /> : null}

            {/* —— 层 B：进度 —— */}
            <Panel className="p-6">
              <div className="cs-label mb-3">执行进度</div>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: "var(--cs-dim)" }}>
                    <th className="text-left py-1">阶段</th>
                    <th className="text-left py-1">节点</th>
                    <th className="text-left py-1">算子</th>
                    <th className="text-left py-1">状态</th>
                    <th className="text-left py-1">尝试</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stages.map((stage) => {
                    const nodeId = nodeParticipantId(stage.node);
                    return (
                      <tr key={stage.stageId} style={{ borderTop: "1px solid var(--cs-line-soft)" }}>
                        <td className="py-1.5">{stage.stageId}</td>
                        <td className="py-1.5" title={stage.node}>
                          {participantLabel(nodeId)}
                        </td>
                        <td className="py-1.5 cs-mono text-[0.72rem]">{stage.opRef}</td>
                        <td className="py-1.5">
                          {stage.status}
                          {stage.lastError ? (
                            <span className="block text-[0.7rem]" style={{ color: "var(--cs-red)" }}>
                              {stage.lastError}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-1.5">{stage.attempt}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>

            {/* —— 层 C：运维 / 审计（默认折叠） —— */}
            <Panel className="p-6">
              <OpsDetails title="运维与审计细节（plan_hash、片段、凭证、回执…）">
                <div>
                  <div className="cs-label mb-1">plan_hash</div>
                  <div className="cs-mono text-[0.72rem] break-all">
                    {job?.planHash ?? "—"}
                  </div>
                </div>

                {job?.contractBundleId ? (
                  <div>
                    <div className="cs-label mb-2">ContractBundle 与成员绑定</div>
                    <dl className="text-sm grid grid-cols-2 gap-y-1.5">
                      <dt style={{ color: "var(--cs-dim)" }}>bundle_id</dt>
                      <dd className="font-mono text-[0.72rem]">{job.contractBundleId}</dd>
                      <dt style={{ color: "var(--cs-dim)" }}>bundle_version</dt>
                      <dd className="font-mono text-[0.72rem]">
                        {job.contractBundleVersion ?? "—"}
                      </dd>
                    </dl>
                    <table className="w-full text-sm mt-3">
                      <thead>
                        <tr style={{ color: "var(--cs-dim)" }}>
                          <th className="text-left py-1">角色</th>
                          <th className="text-left py-1">提供方</th>
                          <th className="text-left py-1">数据产品</th>
                          <th className="text-left py-1">成员合约</th>
                          <th className="text-left py-1">阶段</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(job.contractBindings ?? []).map((binding) => (
                          <tr
                            key={`${binding.role}:${binding.contractId}`}
                            style={{ borderTop: "1px solid var(--cs-line-soft)" }}
                          >
                            <td className="py-1.5">{binding.role}</td>
                            <td className="py-1.5" title={binding.participantId}>
                              {participantLabel(binding.participantId)}
                            </td>
                            <td className="py-1.5 font-mono text-[0.68rem]">
                              {binding.dataProductId}
                            </td>
                            <td className="py-1.5 font-mono text-[0.68rem]">
                              {binding.contractId}
                            </td>
                            <td className="py-1.5 font-mono text-[0.68rem]">
                              {binding.stages.join(", ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <div>
                  <div className="cs-label mb-2">片段哈希</div>
                  <ul className="text-[0.75rem] font-mono space-y-1">
                    {data.fragments.map((f) => (
                      <li key={f.node} title={f.node}>
                        {participantLabel(nodeParticipantId(f.node))} → {f.fragmentHash}
                      </li>
                    ))}
                  </ul>
                </div>

                {data.ticket ? (
                  <div>
                    <div className="cs-label mb-2">执行凭证（{data.ticket.status}）</div>
                    <p className="text-[0.72rem] font-mono mb-2">{data.ticket.ticketId}</p>
                    {Object.keys(data.ticket.attestation).length === 0 ? (
                      <p className="text-[0.75rem]" style={{ color: "var(--cs-dim)" }}>
                        本作业不含 C2 阶段：未冻结执行环境期望。
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ color: "var(--cs-dim)" }}>
                            <th className="text-left py-1">节点</th>
                            <th className="text-left py-1">证明链型</th>
                            <th className="text-left py-1">代码度量</th>
                            <th className="text-left py-1">最低可信基</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(data.ticket.attestation).map(([node, exp]) => (
                            <tr key={node} style={{ borderTop: "1px solid var(--cs-line-soft)" }}>
                              <td className="py-1.5" title={node}>
                                {participantLabel(nodeParticipantId(node))}
                              </td>
                              <td className="py-1.5">{exp.tee}</td>
                              <td className="py-1.5 font-mono text-[0.68rem]">{exp.measurement}</td>
                              <td className="py-1.5">{exp.min_tcb ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ) : null}

                {witnessView.rows.length > 0 ||
                witnessView.nodesWithoutWitness.length > 0 ||
                witnessView.nodesWithoutVerification.length > 0 ? (
                  <div>
                    <div className="cs-label mb-2">会话证明与本院核验</div>
                    {witnessView.rows.length === 0 ? (
                      <p className="text-[0.75rem]" style={{ color: "var(--cs-dim)" }}>
                        还没有任何节点上报会话见证。
                      </p>
                    ) : (
                      <table className="text-[0.75rem] w-full">
                        <thead style={{ color: "var(--cs-dim)" }}>
                          <tr className="text-left">
                            <th className="py-1">节点</th>
                            <th>代码度量</th>
                            <th>TCB</th>
                            <th>核验结论</th>
                          </tr>
                        </thead>
                        <tbody>
                          {witnessView.rows.map((w) => (
                            <tr key={`${w.node}:${w.quoteDigest}`} className="align-top">
                              <td className="py-1" title={w.node}>
                                {participantLabel(nodeParticipantId(w.node))}
                              </td>
                              <td className="font-mono">{w.measurement.slice(0, 18)}…</td>
                              <td>{w.tcb ?? "—"}</td>
                              <td>
                                <span
                                  style={{
                                    color:
                                      w.verification.status === "verified"
                                        ? "var(--cs-green)"
                                        : w.verification.status === "rejected"
                                          ? "var(--cs-red)"
                                          : "var(--cs-amber)",
                                  }}
                                >
                                  {w.verification.label}
                                </span>
                                {w.verification.reason ? (
                                  <span className="block font-mono">{w.verification.reason}</span>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {witnessView.nodesWithoutWitness.length > 0 ? (
                      <p className="text-[0.7rem] mt-2" style={{ color: "var(--cs-amber)" }}>
                        尚未上报见证：
                        {witnessView.nodesWithoutWitness
                          .map((n) => participantLabel(nodeParticipantId(n)))
                          .join("、")}
                      </p>
                    ) : null}
                    {witnessView.nodesWithoutVerification.length > 0 ? (
                      <p className="text-[0.7rem] mt-1" style={{ color: "var(--cs-amber)" }}>
                        有见证但尚无本院核验：
                        {witnessView.nodesWithoutVerification
                          .map((n) => participantLabel(nodeParticipantId(n)))
                          .join("、")}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {(data.chains?.length ?? 0) > 0 || (data.anchors?.length ?? 0) > 0 ? (
                  <div>
                    <div className="cs-label mb-2">审计回执链与锚定</div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ color: "var(--cs-dim)" }}>
                          <th className="text-left py-1">节点</th>
                          <th className="text-left py-1">链连续性</th>
                          <th className="text-left py-1">回执条数</th>
                          <th className="text-left py-1">锚定</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.chains ?? []).map((chain) => {
                          const anchor = (data.anchors ?? []).find((a) => a.node === chain.node);
                          const status = anchor?.payload?.status as string | undefined;
                          return (
                            <tr key={chain.node} style={{ borderTop: "1px solid var(--cs-line-soft)" }}>
                              <td className="py-1.5" title={chain.node}>
                                {participantLabel(nodeParticipantId(chain.node))}
                              </td>
                              <td className="py-1.5">
                                {chain.length === 0
                                  ? "—"
                                  : chain.valid
                                    ? "连续 ✓"
                                    : `断链（${chain.brokenAt ?? "?"}）`}
                              </td>
                              <td className="py-1.5">{chain.length}</td>
                              <td className="py-1.5 text-[0.72rem]">
                                {status === "anchored"
                                  ? `已上链 ${String(anchor?.payload?.tx_id ?? "").slice(0, 12)}… block ${String(anchor?.payload?.block ?? "?")}`
                                  : status === "pending"
                                    ? "待上链（补偿队列）"
                                    : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </OpsDetails>
            </Panel>
          </>
        )}
      </div>
    </TaskBrowseHeader>
  );
}

/** 各方贡献表（聚合指标已由 MdopResultPanel 中文展示）。 */
function FlExtras({
  result,
}: {
  result: NonNullable<Awaited<ReturnType<typeof api.getMdopJob>>["result"]>;
}) {
  const parties = result.partyContributions ?? [];
  if (parties.length === 0) return null;
  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: "var(--cs-dim)" }}>
            <th className="text-left font-normal py-1">参与方</th>
            <th className="text-right font-normal py-1">样本数</th>
            <th className="text-right font-normal py-1">参与轮次</th>
            <th className="text-right font-normal py-1">本地 AUC（区分度）</th>
            <th className="text-left font-normal py-1 pl-3">本地模型指纹</th>
          </tr>
        </thead>
        <tbody>
          {parties.map((c) => (
            <tr key={c.participantId} style={{ borderTop: "1px solid var(--cs-line-soft)" }}>
              <td className="py-1" title={c.participantId}>
                {participantLabel(c.participantId)}
              </td>
              <td className="py-1 text-right">{c.sampleCount}</td>
              <td className="py-1 text-right">{c.roundsParticipated}</td>
              <td className="py-1 text-right">{c.localMetrics?.auc ?? "—"}</td>
              <td className="py-1 pl-3 font-mono text-[0.7rem]" style={{ color: "var(--cs-faint)" }}>
                {c.localModelHash ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[0.7rem]" style={{ color: "var(--cs-dim)" }}>
        {parties.some((c) => c.modelParams)
          ? "合约允许交付模型权重：这份结果含聚合后的权重包。"
          : "未交付权重：合约未允许 model_weights。"}
      </p>
    </>
  );
}
