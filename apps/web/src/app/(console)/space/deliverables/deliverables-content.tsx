"use client";

import Link from "next/link";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { PageHeader, Panel } from "@/components/console/ui";
import { DataGrid, type GridColumn } from "@/components/console/data";
import { ConsumerModelBrief } from "@/components/console/consumer-model-brief";
import { useAuth } from "@/lib/auth";
import { federatedConnectorsLabel, federatedStateColor, federatedStateLabel } from "@/lib/federated-tasks";
import { useConsumerDeliverables, type ConsumerDeliverable } from "@/hooks/use-consumer-deliverables";

const columns: GridColumn<ConsumerDeliverable>[] = [
  {
    header: "任务",
    className: "col-span-3",
    cell: (r) => (
      <Link href={`/space/deliverables/${encodeURIComponent(r.taskId)}`} className="cs-mono text-sm hover:underline">
        {r.taskId}
      </Link>
    ),
  },
  {
    header: "状态",
    className: "col-span-2",
    cell: (r) => {
      const state = r.state ?? (r.result ? "COMPLETED" : "—");
      if (state === "—") return <span style={{ color: "var(--cs-faint)" }}>—</span>;
      const color = federatedStateColor(state);
      return (
        <span className="cs-chip" style={{ color, borderColor: color }}>
          {federatedStateLabel(state)}
        </span>
      );
    },
  },
  {
    header: "联邦 LoRA 交付哈希",
    className: "col-span-3",
    cell: (r) => {
      const hash = r.result?.loraDeltaHash ?? (r.taskRef?.startsWith("ATT:") ? `LORA:${r.taskRef.slice(4)}` : r.taskRef);
      if (!hash) {
        return (
          <span className="text-xs" style={{ color: "var(--cs-faint)" }}>
            {r.resultPending ? "读取中…" : "训练完成后生成"}
          </span>
        );
      }
      return (
        <div className="min-w-0">
          <div className="cs-mono text-xs truncate" style={{ color: "var(--cs-cyan)" }}>
            {hash}
          </div>
          {r.result?.deliverableAvailable && (
            <div className="text-[0.65rem] mt-1" style={{ color: "var(--cs-green)" }}>
              加密包可下载
            </div>
          )}
        </div>
      );
    },
  },
  {
    header: "参与医院",
    className: "col-span-2",
    cell: (r) => (
      <span className="text-sm truncate" style={{ color: "var(--cs-dim)" }}>
        {federatedConnectorsLabel(r.result?.metrics?.federatedConnectors) || "—"}
      </span>
    ),
  },
  {
    header: "合约费用",
    className: "col-span-1 text-right",
    cell: (r) =>
      r.total != null ? (
        <span className="cs-mono text-xs tabular-nums" style={{ color: "var(--cs-cyan)" }}>
          {r.total} {r.currency ?? "CNY"}
        </span>
      ) : (
        "—"
      ),
  },
  {
    header: "",
    className: "col-span-1 text-right",
    cell: (r) => (
      <Link
        href={`/space/deliverables/${encodeURIComponent(r.taskId)}`}
        className="cs-btn cs-btn-ghost text-xs inline-flex items-center gap-1"
      >
        查看 <ArrowUpRight size={12} />
      </Link>
    ),
  },
];

export default function DeliverablesPage() {
  const { user, ready, role } = useAuth();
  const { rows, isLoading, error, refetch, isFetching } = useConsumerDeliverables();

  if (!ready) return null;

  if (role !== "consumer") {
    return (
      <div className="p-8">
        <Panel className="p-6 text-sm" style={{ color: "var(--cs-dim)" }}>
          此页仅面向数据使用方(consumer)。运营/监管方请使用{" "}
          <Link href="/space/federated" className="underline" style={{ color: "var(--cs-cyan)" }}>
            联邦密算
          </Link>{" "}
          查看全量任务。
        </Panel>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        kicker="DELIVERABLES · 模型交付物"
        title="联邦训练交付"
        desc="您作为使用方在数字合约下有权接收的安全制品:联邦合并 LoRA 指纹、训练指标与存证摘要。不含任何院端原始患者数据。"
        action={
          <button type="button" className="cs-btn cs-btn-ghost" disabled={isFetching} onClick={() => refetch()}>
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> 刷新
          </button>
        }
      />
      <div className="p-8 space-y-6">
        <ConsumerModelBrief compact />

        {rows.length === 0 && !isLoading && !error && (
          <Panel className="p-6 text-sm space-y-2" style={{ color: "var(--cs-dim)" }}>
            <p>暂无与您账号绑定的交付记录。</p>
            <p>
              CKD 联邦演示任务签约使用方为 <span className="cs-mono text-xs">pharma-hengrui</span>
              (恒瑞医药)。请使用登录页「恒瑞医药 · 使用方」账号查看演示交付物,或由医院在{" "}
              <Link href="/space/catalog" className="underline" style={{ color: "var(--cs-cyan)" }}>
                数据产品目录
              </Link>{" "}
              发起连接器训练后在此对账。
            </p>
            {user?.participantId && (
              <p className="cs-mono text-xs" style={{ color: "var(--cs-faint)" }}>
                当前 participantId: {user.participantId}
              </p>
            )}
          </Panel>
        )}

        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={(r) => r.taskId}
          loading={isLoading}
          error={error}
          loadingText="装载您的交付记录…"
          errorText="无法连接结算/任务接口。"
          emptyText=""
        />

        <Panel className="p-5 text-sm flex flex-wrap gap-4" style={{ color: "var(--cs-dim)" }}>
          <Link href="/space/contracts" className="underline" style={{ color: "var(--cs-cyan)" }}>
            数字合约 →
          </Link>
          <Link href="/space/settlements" className="underline" style={{ color: "var(--cs-cyan)" }}>
            费用与分账 →
          </Link>
          <Link href="/space/attestations" className="underline" style={{ color: "var(--cs-cyan)" }}>
            链上存证 →
          </Link>
        </Panel>
      </div>
    </div>
  );
}
