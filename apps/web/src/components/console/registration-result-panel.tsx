"use client";

import { Panel } from "@/components/console/ui";
import {
  registrationEffectText,
  type RegistrationResultView,
} from "@/lib/registration-result-view";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

export function RegistrationResultPanel({
  view,
}: {
  view: RegistrationResultView;
}) {
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm" style={{ color: "var(--cs-dim)" }}>
          注册型外部对照：主要分析与诊断
        </h3>
        <span
          className="text-[0.7rem] px-2 py-1 rounded"
          style={{
            color: view.synthetic ? "var(--cs-amber)" : "var(--cs-green, #16a34a)",
            border: "1px solid currentColor",
          }}
        >
          {view.synthetic ? "SYNTHETIC · 仅用于方法学演练" : "REAL · 仍需方案与监管审阅"}
        </span>
      </div>

      {view.synthetic ? (
        <p
          className="text-[0.75rem] mb-3 rounded p-2"
          style={{
            color: "var(--cs-amber)",
            border: "1px solid var(--cs-amber)",
          }}
        >
          合成数据不得作为真实药品或器械的疗效、安全性或注册结论；结果只用于验证程序、偏倚控制与可复现性。
        </p>
      ) : null}

      <dl className="text-sm grid grid-cols-2 gap-y-1.5">
        <dt style={{ color: "var(--cs-dim)" }}>Estimand / Estimator</dt>
        <dd>
          {view.estimand} · {view.estimator}
        </dd>
        <dt style={{ color: "var(--cs-dim)" }}>队列（试验 / 对照池 / 入分析）</dt>
        <dd>
          {view.cohort.trialN} / {view.cohort.controlPoolN} /{" "}
          {view.cohort.analysisTrialN} + {view.cohort.analysisControlN}
        </dd>
        <dt style={{ color: "var(--cs-dim)" }}>主要分析</dt>
        <dd className="font-mono text-[0.8rem]">
          {registrationEffectText(view.effect)}
        </dd>
        {view.study ? (
          <>
            <dt style={{ color: "var(--cs-dim)" }}>方案冻结</dt>
            <dd className="font-mono text-[0.72rem]">
              profile {view.study.profileVersion} · time zero{" "}
              {view.study.timeZero} · SAP {view.study.estimandSapVersion}
            </dd>
          </>
        ) : null}
      </dl>

      {view.balance.length > 0 ? (
        <>
          <h4 className="text-[0.78rem] mt-4 mb-1" style={{ color: "var(--cs-dim)" }}>
            加权前后平衡（SMD）
          </h4>
          <table className="w-full text-[0.75rem]">
            <thead>
              <tr style={{ color: "var(--cs-dim)" }}>
                <th className="text-left font-normal py-1">协变量</th>
                <th className="text-right font-normal py-1">加权前</th>
                <th className="text-right font-normal py-1">加权后</th>
                <th className="text-right font-normal py-1">判定</th>
              </tr>
            </thead>
            <tbody>
              {view.balance.map((row) => (
                <tr
                  key={row.covariate}
                  style={{ borderTop: "1px solid var(--cs-line)" }}
                >
                  <td className="py-1 font-mono">{row.covariate}</td>
                  <td className="py-1 text-right">{num(row.smdBefore)}</td>
                  <td className="py-1 text-right">{num(row.smdAfter)}</td>
                  <td
                    className="py-1 text-right"
                    style={{
                      color:
                        row.smdAfter <= 0.1
                          ? "var(--cs-green, #16a34a)"
                          : "var(--cs-amber)",
                    }}
                  >
                    {row.smdAfter <= 0.1 ? "≤ 0.1" : "仍不平衡"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <div className="grid md:grid-cols-2 gap-3 mt-4 text-[0.75rem]">
        <div>
          <h4 className="mb-1" style={{ color: "var(--cs-dim)" }}>
            Overlap 与权重
          </h4>
          {view.overlap && view.weights ? (
            <ul className="space-y-1">
              <li>
                PS 范围 {num(view.overlap.minPropensity)} –{" "}
                {num(view.overlap.maxPropensity)}；截尾{" "}
                {view.overlap.trimmed}
              </li>
              <li>
                有效样本量 试验 {num(view.overlap.eesTrial)} / 对照{" "}
                {num(view.overlap.eesControl)}
              </li>
              <li>
                最大权重 {num(view.weights.maxWeight)}，P99{" "}
                {num(view.weights.p99Weight)}，截尾比例{" "}
                {pct(view.weights.truncatedFraction)}
              </li>
            </ul>
          ) : (
            <p style={{ color: "var(--cs-amber)" }}>未发布完整 overlap / 权重诊断。</p>
          )}
        </div>
        <div>
          <h4 className="mb-1" style={{ color: "var(--cs-dim)" }}>
            缺失与删失
          </h4>
          {view.missingness && view.censoring ? (
            <ul className="space-y-1">
              <li>
                缺失机制 {view.missingness.mode}；缺失率{" "}
                {pct(view.missingness.missingFraction)}；插补{" "}
                {view.missingness.imputedN}
              </li>
              <li>
                观察到结局 {view.censoring.observedN}；删失{" "}
                {view.censoring.censoredN}；竞争风险{" "}
                {view.censoring.competingRiskN}
              </li>
            </ul>
          ) : (
            <p style={{ color: "var(--cs-amber)" }}>
              未发布完整缺失 / 删失诊断。
            </p>
          )}
        </div>
      </div>

      {view.sensitivity.length > 0 ? (
        <>
          <h4 className="text-[0.78rem] mt-4 mb-1" style={{ color: "var(--cs-dim)" }}>
            敏感性分析
          </h4>
          <table className="w-full text-[0.75rem]">
            <thead>
              <tr style={{ color: "var(--cs-dim)" }}>
                <th className="text-left font-normal py-1">分析</th>
                <th className="text-right font-normal py-1">估计</th>
                <th className="text-right font-normal py-1">95% CI</th>
                <th className="text-left font-normal py-1 pl-3">方向</th>
              </tr>
            </thead>
            <tbody>
              {view.sensitivity.map((row) => (
                <tr key={row.id} style={{ borderTop: "1px solid var(--cs-line)" }}>
                  <td className="py-1 font-mono">{row.id}</td>
                  <td className="py-1 text-right">{num(row.estimate)}</td>
                  <td className="py-1 text-right">
                    {num(row.ciLow)} – {num(row.ciHigh)}
                  </td>
                  <td className="py-1 pl-3">{row.direction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {view.truthComparison ? (
        <p className="text-[0.75rem] mt-3">
          答案键对照：真实 RR {num(view.truthComparison.rrTrue)}；恢复{" "}
          {num(view.truthComparison.rrEstimated)}；绝对误差{" "}
          {num(view.truthComparison.absoluteError)}；{" "}
          <span
            style={{
              color: view.truthComparison.withinExpectedRange
                ? "var(--cs-green, #16a34a)"
                : "var(--cs-red)",
            }}
          >
            {view.truthComparison.withinExpectedRange
              ? "落在预声明范围"
              : "超出预声明范围"}
          </span>
        </p>
      ) : null}

      {view.problems.length > 0 ? (
        <div
          className="mt-4 rounded p-2 text-[0.75rem]"
          style={{ border: "1px solid var(--cs-amber)", color: "var(--cs-amber)" }}
        >
          <p className="mb-1">诊断缺口或不一致（不得据此宣称注册级结论）：</p>
          <ul className="list-disc pl-5 space-y-1">
            {view.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}
