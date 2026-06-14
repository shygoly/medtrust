"use client";

import { useEffect, useState } from "react";
import { PageHeader, Panel } from "@/components/console/ui";
import { api } from "@/api/client";
import { useAuth, roleLabel } from "@/lib/auth";

export default function SettlementsPage() {
  const { role, ready } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    api
      .getSettlements()
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((e) => setErr(e?.message || "加载失败"));
  }, []);

  const desc =
    role === "provider"
      ? "你的数据产品在各任务中的收益(按贡献占比分账)。仅显示你自己的收益明细。"
      : role === "consumer"
        ? "你发起的任务产生的费用与各院分账。"
        : "全局结算台账。各任务使用方应付、提供方按贡献分账,摘要上链可追溯。";

  return (
    <div>
      <PageHeader
        kicker={`SETTLEMENTS · 结算${ready && role ? " · " + (roleLabel[role] ?? role) : ""}`}
        title="价值结算"
        desc={desc}
      />
      <div className="p-8">
        {err && (
          <Panel className="px-6 py-4 mb-4" style={{ borderColor: "var(--cs-red)" }}>
            <span style={{ color: "var(--cs-red)" }}>{err}</span>
          </Panel>
        )}

        {role === "provider" ? (
          <Panel ticks>
            <div className="grid grid-cols-12 px-6 py-3 cs-label border-b" style={{ borderColor: "var(--cs-line)" }}>
              <div className="col-span-4">任务</div>
              <div className="col-span-3">我的贡献</div>
              <div className="col-span-3 text-right">我的收益</div>
              <div className="col-span-2 text-right">时间</div>
            </div>
            {rows.map((r) => (
              <div key={r.id} className="cs-row grid grid-cols-12 px-6 py-4 items-center">
                <div className="col-span-4 cs-mono text-sm">{r.taskId}</div>
                <div className="col-span-3 cs-mono tabular-nums">{r.earning?.contribution} 条</div>
                <div className="col-span-3 text-right cs-mono tabular-nums" style={{ color: "var(--cs-green)" }}>
                  {r.earning?.amount} {r.currency}
                </div>
                <div className="col-span-2 text-right text-[0.72rem]" style={{ color: "var(--cs-faint)" }}>{r.at}</div>
              </div>
            ))}
          </Panel>
        ) : (
          <Panel ticks>
            <div className="grid grid-cols-12 px-6 py-3 cs-label border-b" style={{ borderColor: "var(--cs-line)" }}>
              <div className="col-span-3">任务</div>
              <div className="col-span-2">使用方</div>
              <div className="col-span-2 text-right">应付总额</div>
              <div className="col-span-4">提供方分账(按贡献)</div>
              <div className="col-span-1 text-right">时间</div>
            </div>
            {rows.map((r) => (
              <div key={r.id} className="cs-row grid grid-cols-12 px-6 py-4 items-center">
                <div className="col-span-3 cs-mono text-sm">
                  {r.taskId}
                  <div className="cs-mono text-[0.66rem]" style={{ color: "var(--cs-faint)" }}>{r.taskRef}</div>
                </div>
                <div className="col-span-2 text-sm">{r.consumer}</div>
                <div className="col-span-2 text-right cs-mono tabular-nums" style={{ color: "var(--cs-cyan)" }}>
                  {r.total} {r.currency}
                </div>
                <div className="col-span-4 text-[0.72rem]" style={{ color: "var(--cs-dim)" }}>
                  {(r.lines ?? []).map((l: any) => `${l.org} ${l.contribution}条→${l.amount}`).join(" · ")}
                </div>
                <div className="col-span-1 text-right text-[0.66rem]" style={{ color: "var(--cs-faint)" }}>{r.at?.slice(5)}</div>
              </div>
            ))}
          </Panel>
        )}

        {rows.length === 0 && !err && (
          <Panel className="px-6 py-8 text-center"><span className="cs-label">暂无结算记录</span></Panel>
        )}
      </div>
    </div>
  );
}
