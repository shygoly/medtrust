"use client";

import { Panel } from "@/components/console/ui";
import type { ReleaseManifestView } from "@/lib/release-manifest-view";
import type { MdopResultView } from "@/lib/mdop-result-view";
import {
  L15_METRIC_HELP,
  PAIRED_METRIC_HELP,
  SCRI_METRIC_HELP,
  nodeParticipantId,
} from "@/lib/mdop-result-view";
import { participantLabel } from "@/lib/federated-tasks";

/**
 * 层 A 结果骨架：结论摘要 → 指标表 → 发布审查 →（子节点：SCRI/FL/解读等）。
 */
export function MdopResultPanel({
  view,
  manifestView,
  children,
}: {
  view: MdopResultView;
  manifestView: ReleaseManifestView;
  children?: React.ReactNode;
}) {
  return (
    <Panel className="p-6 space-y-4">
      <div className="cs-label">合并结果（C3 交付物）</div>
      <div>
        <div className="text-base font-medium">{view.analysisLabel}</div>
        {view.analysisType && view.analysisLabel !== view.analysisType ? (
          <div className="cs-mono text-[0.65rem] mt-0.5" style={{ color: "var(--cs-faint)" }}>
            {view.analysisType}
          </div>
        ) : null}
        {view.summaryLine ? (
          <p className="text-sm mt-1" style={{ color: "var(--cs-dim)" }}>
            {view.summaryLine}
          </p>
        ) : null}
      </div>

      {view.kind === "disproportionality" && view.rows.length > 0 ? (
        <div className="space-y-2">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: "var(--cs-dim)" }}>
                <th className="text-left font-normal py-1" title={L15_METRIC_HELP.outcome}>
                  不良结局
                </th>
                <th className="text-right font-normal py-1" title={L15_METRIC_HELP.countA}>
                  暴露且出现结局（a）
                </th>
                <th className="text-right font-normal py-1" title={L15_METRIC_HELP.prr}>
                  比例报告比 PRR
                </th>
                <th className="text-right font-normal py-1" title={L15_METRIC_HELP.prr}>
                  PRR 95% 置信区间
                </th>
                <th className="text-right font-normal py-1" title={L15_METRIC_HELP.ror}>
                  报告比值比 ROR
                </th>
                <th className="text-right font-normal py-1" title={L15_METRIC_HELP.ror}>
                  ROR 95% 置信区间
                </th>
                <th className="text-right font-normal py-1" title={L15_METRIC_HELP.signal}>
                  安全信号
                </th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.key} style={{ borderTop: "1px solid var(--cs-line-soft)" }}>
                  <td className="py-1.5">
                    <div>{row.outcomeLabel}</div>
                    {row.outcomeLabel !== row.key ? (
                      <div className="cs-mono text-[0.65rem]" style={{ color: "var(--cs-faint)" }}>
                        {row.key}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-right cs-mono" title={L15_METRIC_HELP.countA}>
                    {row.count}
                  </td>
                  <td className="py-1.5 text-right cs-mono">{row.prr}</td>
                  <td className="py-1.5 text-right cs-mono text-[0.7rem]">{row.prrCi}</td>
                  <td className="py-1.5 text-right cs-mono">{row.ror}</td>
                  <td className="py-1.5 text-right cs-mono text-[0.7rem]">{row.rorCi}</td>
                  <td
                    className="py-1.5 text-right"
                    title={L15_METRIC_HELP.signal}
                    style={{
                      color:
                        row.signal === true
                          ? "var(--cs-amber)"
                          : row.signal === false
                            ? "var(--cs-dim)"
                            : "var(--cs-faint)",
                    }}
                  >
                    {row.signalLabel}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[0.7rem] leading-relaxed" style={{ color: "var(--cs-dim)" }}>
            读表提示：{L15_METRIC_HELP.outcome} {L15_METRIC_HELP.countA}{" "}
            PRR/ROR &gt; 1 表示相对更常一起出现。{L15_METRIC_HELP.signal}
          </p>
        </div>
      ) : null}

      {view.kind === "paired-cohort" && view.kvRows.length > 0 ? (
        <div className="space-y-2">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: "var(--cs-dim)" }}>
                <th className="text-left font-normal py-1">指标</th>
                <th className="text-right font-normal py-1">人数</th>
              </tr>
            </thead>
            <tbody>
              {view.kvRows.map((row) => (
                <tr key={row.label} style={{ borderTop: "1px solid var(--cs-line-soft)" }}>
                  <td className="py-1.5" title={row.help}>
                    {row.label}
                  </td>
                  <td className="py-1.5 text-right cs-mono">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[0.7rem] leading-relaxed" style={{ color: "var(--cs-dim)" }}>
            读表提示：{PAIRED_METRIC_HELP.direction}
          </p>
        </div>
      ) : null}

      {view.kind === "fl-prediction" && (view.flMetrics.length > 0 || view.modelHash) ? (
        <div className="space-y-2">
          {view.flMetrics.length > 0 ? (
            <dl className="text-sm grid grid-cols-2 gap-y-1.5">
              {view.flMetrics.map((m) => (
                <div key={m.label} className="contents">
                  <dt style={{ color: "var(--cs-dim)" }}>{m.label}</dt>
                  <dd className="cs-mono text-right">{m.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {view.modelHash ? (
            <p className="text-[0.7rem] cs-mono" style={{ color: "var(--cs-faint)" }} title="跨院合并模型指纹">
              模型指纹 {view.modelHash}
            </p>
          ) : null}
        </div>
      ) : null}

      {view.kind === "vaccine-scri" && view.scriStrata.length > 0 ? (
        <div className="space-y-2">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: "var(--cs-dim)" }}>
                <th className="text-left font-normal py-1">分层</th>
                <th className="text-right font-normal py-1">接种剂次</th>
                <th className="text-right font-normal py-1">风险期事件</th>
                <th className="text-right font-normal py-1">对照期事件</th>
                <th className="text-right font-normal py-1" title={SCRI_METRIC_HELP.ri}>
                  相对发生率 RI
                </th>
                <th className="text-right font-normal py-1" title={SCRI_METRIC_HELP.ri}>
                  RI 95% 置信区间
                </th>
              </tr>
            </thead>
            <tbody>
              {view.scriStrata.map((s) => (
                <tr key={s.key} style={{ borderTop: "1px solid var(--cs-line-soft)" }}>
                  <td className="py-1">
                    <div>{s.keyLabel}</div>
                    {s.keyLabel !== s.key ? (
                      <div className="cs-mono text-[0.65rem]" style={{ color: "var(--cs-faint)" }}>
                        {s.key}
                      </div>
                    ) : null}
                  </td>
                  {s.suppressed ? (
                    <td className="py-1 text-right" colSpan={5} style={{ color: "var(--cs-amber)" }}>
                      小单元格审查已抑制
                    </td>
                  ) : (
                    <>
                      <td className="py-1 text-right cs-mono">{s.doses}</td>
                      <td className="py-1 text-right cs-mono">{s.riskEvents}</td>
                      <td className="py-1 text-right cs-mono">{s.controlEvents}</td>
                      <td
                        className="py-1 text-right cs-mono"
                        title={s.ri === "不可估计" ? SCRI_METRIC_HELP.inestimable : SCRI_METRIC_HELP.ri}
                        style={{
                          color: s.ri === "不可估计" ? "var(--cs-amber)" : undefined,
                        }}
                      >
                        {s.ri}
                      </td>
                      <td className="py-1 text-right cs-mono text-[0.7rem]">{s.riCi}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[0.7rem] leading-relaxed" style={{ color: "var(--cs-dim)" }}>
            读表提示：{SCRI_METRIC_HELP.ri} {SCRI_METRIC_HELP.inestimable}
          </p>
        </div>
      ) : null}

      {children}

      <ReleaseManifestBlock view={manifestView} />
    </Panel>
  );
}

function ReleaseManifestBlock({ view }: { view: ReleaseManifestView }) {
  if (view.status === "ok") {
    return (
      <div className="pt-2" style={{ borderTop: "1px solid var(--cs-line-soft)" }}>
        <div className="cs-label mb-2">发布审查</div>
        <dl className="text-sm grid grid-cols-2 gap-y-1.5">
          <dt style={{ color: "var(--cs-dim)" }}>汇总</dt>
          <dd>
            抑制 {view.suppressedTotal} 格 · 阈值 minCell={view.minCell}
          </dd>
          <dt style={{ color: "var(--cs-dim)" }}>差分隐私声明</dt>
          <dd>{view.dp}</dd>
        </dl>
        <ul className="text-[0.75rem] mt-2 space-y-1">
          {view.parties.map((p) => (
            <li key={`${p.node}:${p.minCell}`} className="font-mono">
              {participantLabel(nodeParticipantId(p.node))}：抑制 {p.suppressed} 格
              {p.secondarySuppression ? "（含二次抑制）" : ""} ·
              {p.budget ? ` 预算 ${p.budget}` : " 预算未附带"} · {p.dp}
            </li>
          ))}
        </ul>
        <p className="text-[0.7rem] mt-2" style={{ color: "var(--cs-dim)" }}>
          如实说明：这里是汇总量；逐格抑制明细留在节点本地。清单时间 {view.at}。
        </p>
      </div>
    );
  }
  if (view.status === "invalid") {
    return (
      <p className="text-[0.7rem] pt-2" style={{ color: "var(--cs-amber)", borderTop: "1px solid var(--cs-line-soft)" }}>
        结果里带了发布审查清单，但解析不过：{view.reason}。按设计不猜测其内容。
      </p>
    );
  }
  return (
    <p className="text-[0.7rem] pt-2" style={{ color: "var(--cs-dim)", borderTop: "1px solid var(--cs-line-soft)" }}>
      如实说明：本次交付没有随带发布审查清单——没有清单不等于审查过。
    </p>
  );
}

/** 层 C 运维折叠块。 */
export function OpsDetails({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary
        className="cursor-pointer list-none cs-label py-2 flex items-center gap-2"
        style={{ color: "var(--cs-dim)" }}
      >
        <span className="cs-mono text-[0.65rem]" aria-hidden>
          ▸
        </span>
        {title}
      </summary>
      <div className="pt-2 pb-1 space-y-4">{children}</div>
    </details>
  );
}
