"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Panel } from "@/components/console/ui";
import { api } from "@/api/client";
import { releaseManifestView } from "@/lib/release-manifest-view";
import { witnessStatusView } from "@/lib/witness-status-view";
import { c3InterpretPayload } from "@/lib/c3-interpret-payload";
import { ResultInterpretationPanel } from "@/components/console/result-interpretation-panel";

/**
 * MDOP 作业详情（mdop-kernel §9.6）：
 * 阶段状态（含重试次数与最后一次错误）、片段哈希、以及「结果」。
 * 结果载荷与旧通道同形（analysisType + cohortSize + buckets），可复用既有 L1.5 结果组件。
 */
export default function MdopJobDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = decodeURIComponent(String(params?.id ?? ""));
  const { data, isLoading, error } = useQuery({
    queryKey: ["mdop-job", jobId],
    queryFn: () => api.getMdopJob(jobId),
    enabled: Boolean(jobId),
    retry: false,
  });
  // 交付物里可能随带发布审查清单；解析放在 lib（有测试），这里只渲染三种状态
  const manifestView = releaseManifestView(data?.result ?? null);
  // 结果解读只带白名单内的聚合字段；不支持的分析类型为 null → 不显示入口
  const interpretPayload = c3InterpretPayload(data?.result ?? null);
  // 会话证明与本院核验结论（三态：通过 / 未通过 / **尚未核验**）
  const witnessView = witnessStatusView(
    (data as { witnessStatus?: unknown } | undefined)?.witnessStatus,
  );

  return (
    <div>
      <PageHeader
        kicker="MDOP · 作业详情"
        title={jobId || "作业"}
        desc="阶段状态机、片段哈希与执行凭证；终态后可见销毁与审计回执。"
      />
      <div className="p-8 space-y-4">
        <Link
          href="/space/tasks?channel=mdop"
          className="inline-flex items-center gap-1.5 text-sm"
          style={{ color: "var(--cs-dim)" }}
        >
          <ArrowLeft size={14} /> 返回作业列表
        </Link>

        {isLoading ? (
          <p className="text-sm" style={{ color: "var(--cs-dim)" }}>
            加载中…
          </p>
        ) : error ? (
          <p className="text-sm" style={{ color: "var(--cs-red)" }}>
            读取失败：{(error as Error)?.message}
          </p>
        ) : !data ? null : (
          <>
            <Panel>
          <h3 className="text-sm mb-2" style={{ color: "var(--cs-dim)" }}>作业</h3>
              <dl className="text-sm grid grid-cols-2 gap-y-1.5">
                <dt style={{ color: "var(--cs-dim)" }}>状态</dt>
                <dd>{data.job.status}</dd>
                <dt style={{ color: "var(--cs-dim)" }}>用途</dt>
                <dd>{data.job.purpose}</dd>
                <dt style={{ color: "var(--cs-dim)" }}>plan_hash</dt>
                <dd className="font-mono text-[0.72rem]">{data.job.planHash ?? "—"}</dd>
                {data.job.rejectReason ? (
                  <>
                    <dt style={{ color: "var(--cs-red)" }}>失败原因</dt>
                    <dd style={{ color: "var(--cs-red)" }}>{data.job.rejectReason}</dd>
                  </>
                ) : null}
              </dl>
            </Panel>

            <Panel>
          <h3 className="text-sm mb-2" style={{ color: "var(--cs-dim)" }}>阶段（各节点）</h3>
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
                  {data.stages.map((stage) => (
                    <tr key={stage.stageId} style={{ borderTop: "1px solid var(--cs-line)" }}>
                      <td className="py-1.5">{stage.stageId}</td>
                      <td className="py-1.5 text-[0.72rem]">{stage.node}</td>
                      <td className="py-1.5">{stage.opRef}</td>
                      <td className="py-1.5">{stage.status}</td>
                      <td className="py-1.5">{stage.attempt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <Panel>
          <h3 className="text-sm mb-2" style={{ color: "var(--cs-dim)" }}>片段哈希（各节点独立重算 plan_hash 的依据）</h3>
              <ul className="text-[0.75rem] font-mono space-y-1">
                {data.fragments.map((f) => (
                  <li key={f.node}>
                    {f.node} → {f.fragmentHash}
                  </li>
                ))}
              </ul>
            </Panel>

            {/*
              C2 作业最该被看见的一行（任务 7.2）：各院批准的到底是在**哪份代码**下执行。
              这份期望冻在凭证核心里、由各持有方签名；实际证明与 KMS 释放凭据在执行前核对。
            */}
            {data.ticket ? (
              <Panel>
                <h3 className="text-sm mb-2" style={{ color: "var(--cs-dim)" }}>
                  执行凭证（{data.ticket.status}）
                </h3>
                <p className="text-[0.72rem] font-mono mb-2">{data.ticket.ticketId}</p>
                {Object.keys(data.ticket.attestation).length === 0 ? (
                  <p className="text-[0.75rem]" style={{ color: "var(--cs-dim)" }}>
                    本作业不含 C2 阶段：未冻结执行环境期望（各院只需批准计划本身）。
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ color: "var(--cs-dim)" }}>
                        <th className="text-left py-1">可信空间节点</th>
                        <th className="text-left py-1">证明链型</th>
                        <th className="text-left py-1">代码度量</th>
                        <th className="text-left py-1">最低可信基</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(data.ticket.attestation).map(([node, exp]) => (
                        <tr key={node} style={{ borderTop: "1px solid var(--cs-line)" }}>
                          <td className="py-1.5 text-[0.72rem]">{node}</td>
                          <td className="py-1.5">{exp.tee}</td>
                          <td className="py-1.5 font-mono text-[0.68rem]">{exp.measurement}</td>
                          <td className="py-1.5">{exp.min_tcb ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="text-[0.7rem] mt-2" style={{ color: "var(--cs-dim)" }}>
                  说明：本表是**各院签署的执行环境期望**（冻在凭证核心里）。实际证明的验签由配置内的
                  KMS/证明服务完成，逐次会话产生释放凭据；连接器与节点各自本地核对，平台不参与密钥释放。
                </p>
              </Panel>
            ) : null}

            {/*
              会话证明与本院核验（任务 7.4）：节点上报的**会话见证**（证明 + KMS 释放凭据）
              与持有方自己的核验结论。三态必须分开——「尚未核验」不是「核验通过」。
            */}
            {witnessView.rows.length > 0 ||
            witnessView.nodesWithoutWitness.length > 0 ||
            witnessView.nodesWithoutVerification.length > 0 ? (
              <Panel>
                <h3 className="text-sm mb-2" style={{ color: "var(--cs-dim)" }}>
                  会话证明与本院核验
                </h3>
                {witnessView.rows.length === 0 ? (
                  <p className="text-[0.75rem]" style={{ color: "var(--cs-dim)" }}>
                    还没有任何节点上报会话见证（C2 通道：节点每次会话出一份，平台登记后转给持有方）。
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
                          <td className="py-1 font-mono">{w.node.split(":").pop()}</td>
                          <td className="font-mono">{w.measurement.slice(0, 18)}…</td>
                          <td>{w.tcb ?? "—"}</td>
                          <td>
                            <span
                              style={{
                                color:
                                  w.verification.status === "verified"
                                    ? "var(--cs-green, #16a34a)"
                                    : w.verification.status === "rejected"
                                      ? "var(--cs-red, #dc2626)"
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
                    这些参与节点**尚未上报**任何会话见证：{witnessView.nodesWithoutWitness.join("、")}
                  </p>
                ) : null}
                {witnessView.nodesWithoutVerification.length > 0 ? (
                  <p className="text-[0.7rem] mt-1" style={{ color: "var(--cs-amber)" }}>
                    这些节点有见证但**还没有本院的核验回执**：{witnessView.nodesWithoutVerification.join("、")}
                  </p>
                ) : null}
                <p className="text-[0.7rem] mt-2" style={{ color: "var(--cs-dim)" }}>
                  说明：核验由**持有方自己的连接器**完成（用部署配置里的 KMS 公钥验签，并与本院签下的
                  执行环境期望对拍），平台只转发见证、不下结论；这里显示的是持有方签名上报的核验回执。
                </p>
              </Panel>
            ) : null}

            {/*
              结果与发布审查（任务 7.3a/7.3b）：能展示的照实展示，缺的**明说缺什么**。
              C2 通道的 C3 载荷随带 `release_manifest`（汇总抑制数 / DP 声明 / 预算消耗），
              非 C2 通道或旧作业没有这份清单——**「没有清单」不等于「审查过」**，界面必须分开显示。
            */}
            {data.result ? (
              <Panel>
                <h3 className="text-sm mb-2" style={{ color: "var(--cs-dim)" }}>
                  合并结果（C3 交付物）与发布审查
                </h3>
                <dl className="text-sm grid grid-cols-2 gap-y-1.5">
                  <dt style={{ color: "var(--cs-dim)" }}>分析类型</dt>
                  <dd>{data.result.analysisType ?? "—"}</dd>
                  <dt style={{ color: "var(--cs-dim)" }}>队列规模</dt>
                  <dd>{data.result.cohortSize ?? "—"}</dd>
                  {data.result.analysisType === "vaccine-scri" && data.result.windows ? (
                    <>
                      <dt style={{ color: "var(--cs-dim)" }}>时间窗</dt>
                      <dd>
                        风险期 {windowLabel(data.result.windows.risk)} · 对照期{" "}
                        {windowLabel(data.result.windows.control)}
                      </dd>
                    </>
                  ) : null}
                  {data.result.analysisType !== "vaccine-scri" && data.result.buckets?.length ? (
                    <>
                      <dt style={{ color: "var(--cs-dim)" }}>分层表</dt>
                      <dd className="font-mono text-[0.7rem]">
                        {data.result.buckets.length} 行（四格表：a={String(
                          (data.result.buckets[0] as { count?: number }).count ?? "—",
                        )}
                        ，小单元格已按合约 minCell 抑制）
                      </dd>
                    </>
                  ) : null}
                  {data.result.modelHash ? (
                    <>
                      <dt style={{ color: "var(--cs-dim)" }}>跨院合并模型</dt>
                      <dd className="font-mono text-[0.7rem]">
                        {`${data.result.modelType ?? "fl"} · 轮次 ${data.result.roundsCompleted ?? "—"}/${data.result.totalRounds ?? "—"} · ${data.result.modelHash}`}
                      </dd>
                      <dt style={{ color: "var(--cs-dim)" }}>聚合指标（样本量加权）</dt>
                      <dd className="font-mono text-[0.7rem]">
                        {`auc=${data.result.aggregateMetrics?.auc ?? "—"}  f1=${data.result.aggregateMetrics?.f1 ?? "—"}  precision=${data.result.aggregateMetrics?.precision ?? "—"}  recall=${data.result.aggregateMetrics?.recall ?? "—"}  accuracy=${data.result.aggregateMetrics?.accuracy ?? "—"}`}
                      </dd>
                    </>
                  ) : null}
                </dl>
                {data.result.analysisType === "vaccine-scri" && data.result.strata?.length ? (
                  <table className="w-full text-sm mt-3">
                    <thead>
                      <tr style={{ color: "var(--cs-dim)" }}>
                        <th className="text-left font-normal py-1">分层</th>
                        <th className="text-right font-normal py-1">接种剂次</th>
                        <th className="text-right font-normal py-1">风险期事件</th>
                        <th className="text-right font-normal py-1">对照期事件</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.result.strata.map((s) => (
                        <tr key={String(s.key)} style={{ borderTop: "1px solid var(--cs-line)" }}>
                          <td className="py-1">{String(s.key)}</td>
                          {s.suppressed ? (
                            <td className="py-1 text-right" colSpan={3} style={{ color: "var(--cs-amber)" }}>
                              小单元格审查已抑制
                            </td>
                          ) : (
                            <>
                              <td className="py-1 text-right">{String(s.doses)}</td>
                              <td className="py-1 text-right">{String(s.riskEvents)}</td>
                              <td className="py-1 text-right">{String(s.controlEvents)}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
                 {(data.result.partyContributions ?? []).length > 0 ? (
                   <>
                     <table className="w-full text-sm mt-3">
                       <thead>
                         <tr style={{ color: "var(--cs-dim)" }}>
                           <th className="text-left font-normal py-1">参与方</th>
                           <th className="text-right font-normal py-1">样本数</th>
                           <th className="text-right font-normal py-1">轮次</th>
                           <th className="text-right font-normal py-1">AUC</th>
                           <th className="text-left font-normal py-1 pl-3">本地模型哈希</th>
                         </tr>
                       </thead>
                       <tbody>
                         {(data.result.partyContributions ?? []).map((c) => (
                           <tr key={c.participantId} style={{ borderTop: "1px solid var(--cs-line)" }}>
                             <td className="py-1 font-mono text-[0.7rem]">{c.participantId}</td>
                             <td className="py-1 text-right">{c.sampleCount}</td>
                             <td className="py-1 text-right">{c.roundsParticipated}</td>
                             <td className="py-1 text-right">{c.localMetrics?.auc ?? "—"}</td>
                             <td className="py-1 pl-3 font-mono text-[0.7rem]">{c.localModelHash ?? ""}</td>
                           </tr>
                         ))}
                       </tbody>
                     </table>
                     <p className="text-[0.7rem] mt-2" style={{ color: "var(--cs-dim)" }}>
                       {(data.result.partyContributions ?? []).some((c) => c.modelParams)
                         ? "合约允许 model_weights：这份 C3 含聚合后的权重包（是否可再用见合约与发布审查）。"
                         : "未交付权重：合约未允许 model_weights（聚合口径）；平台不会把未投递的内容补齐。"}
                     </p>
                   </>
                 ) : null}
                {(data.result.warnings ?? []).length > 0 ? (
                  <ul className="text-[0.75rem] mt-2 space-y-1" style={{ color: "var(--cs-amber)" }}>
                    {(data.result.warnings ?? []).map((w) => (
                      <li key={w.code}>
                        {w.code}：{w.detail}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {manifestView.status === "ok" ? (
                  <>
                    <dl className="text-sm grid grid-cols-2 gap-y-1.5 mt-3">
                      <dt style={{ color: "var(--cs-dim)" }}>发布审查（汇总）</dt>
                      <dd>
                        抑制 {manifestView.suppressedTotal} 格 · 阈值 minCell={manifestView.minCell}
                      </dd>
                      <dt style={{ color: "var(--cs-dim)" }}>差分隐私声明</dt>
                      <dd>{manifestView.dp}</dd>
                    </dl>
                    <ul className="text-[0.75rem] mt-2 space-y-1">
                      {manifestView.parties.map((p) => (
                        <li key={`${p.node}:${p.minCell}`} className="font-mono">
                          {p.node}：抑制 {p.suppressed} 格{p.secondarySuppression ? "（含二次抑制）" : ""} ·
                          {p.budget ? ` 预算 ${p.budget}` : " 预算未附带"} · {p.dp}
                        </li>
                      ))}
                    </ul>
                    <p className="text-[0.7rem] mt-2" style={{ color: "var(--cs-dim)" }}>
                      如实说明：这里是**汇总量**；逐格抑制明细留在节点本地审查记录与审计回执里，
                      不随 C3 出域（否则抑制细节本身也被发布）。清单时间 {manifestView.at}。
                    </p>
                  </>
                ) : manifestView.status === "invalid" ? (
                  <p className="text-[0.7rem] mt-2" style={{ color: "var(--cs-amber)" }}>
                    结果里带了发布审查清单，但**解析不过**：{manifestView.reason}。按设计不猜测其内容，
                    请以节点回执与离线核验工具为准。
                  </p>
                ) : (
                  <p className="text-[0.7rem] mt-2" style={{ color: "var(--cs-dim)" }}>
                    如实说明：本次交付**没有**随带发布审查清单，因此这里看不到抑制计数、DP 声明与查询预算消耗。
                    C2 通道的 C3 载荷会带这份清单（由可信空间节点在节点内生成、随结果一起出域，
                    对应 `tee-confidential-node` 的 §3.6 发布审查与 §3.7 预算账本）；
                    非 C2 通道与旧作业没有这份清单——**没有清单不等于审查过**。
                  </p>
                )}
              </Panel>
            ) : null}

            {interpretPayload ? (
              <ResultInterpretationPanel payload={interpretPayload} />
            ) : null}

            {/* 回执链与锚定：终态后核验「谁在什么时候做了什么、链有没有断」 */}
            {(data.chains?.length ?? 0) > 0 || (data.anchors?.length ?? 0) > 0 ? (
              <Panel>
                <h3 className="text-sm mb-2" style={{ color: "var(--cs-dim)" }}>
                  审计回执链与锚定
                </h3>
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
                        <tr key={chain.node} style={{ borderTop: "1px solid var(--cs-line)" }}>
                          <td className="py-1.5 text-[0.72rem]">{chain.node}</td>
                          <td className="py-1.5">
                            {chain.length === 0 ? "—" : chain.valid ? "连续 ✓" : `断链（${chain.brokenAt ?? "?"}）`}
                          </td>
                          <td className="py-1.5">{chain.length}</td>
                          <td className="py-1.5 text-[0.72rem]">
                            {status === "anchored"
                              ? `已上链 ${String(anchor?.payload?.tx_id ?? "").slice(0, 12)}… block ${String(anchor?.payload?.block ?? "?")}`
                              : status === "pending"
                                ? "待上链（补偿队列，非伪造交易号）"
                                : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Panel>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** 接种后天数窗口 → 文案（负数表示接种前）。 */
function windowLabel([a, b]: [number, number]): string {
  return a < 0 && b < 0 ? `接种前第 ${-a}–${-b} 天` : `接种后第 ${a}–${b} 天`;
}
