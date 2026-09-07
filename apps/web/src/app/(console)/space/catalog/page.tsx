"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/console/ui";
import { ResourceList } from "@/components/console/data";
import { PublishProductButton } from "@/components/console/publish-product-button";
import { RequestContractButton } from "@/components/console/request-contract-button";
import { api } from "@/api/client";
import { useAuth } from "@/lib/auth";

export default function CatalogPage() {
  const { role, ready } = useAuth();
  const [type, setType] = useState<"data" | "service">("data");
  const { data, isLoading, error } = useQuery({
    queryKey: ["catalog", type],
    queryFn: () => api.getDataAssets(type),
  });

  const isConsumer = ready && role === "consumer";
  const isService = type === "service";

  return (
    <div>
      <PageHeader
        kicker={isService ? "CATALOG · 数据服务目录" : "CATALOG · 数据产品目录"}
        title={isService ? "数据服务目录" : "数据产品目录"}
        desc="此处仅登记元数据（标题/分级/确权/规模），原始数据留在各院连接器。使用方须先申请数字合约、经提供方签发后，再在编排任务中引用合约——不能在目录上直接训练。"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                className={`cs-btn text-sm ${type === "data" ? "" : "cs-btn-ghost"}`}
                onClick={() => setType("data")}
              >
                数据产品
              </button>
              <button
                className={`cs-btn text-sm ${type === "service" ? "" : "cs-btn-ghost"}`}
                onClick={() => setType("service")}
              >
                数据服务
              </button>
            </div>
            {isConsumer && (
              <Link href="/space/tasks/new" className="cs-btn cs-btn-ghost text-sm">
                去编排任务
              </Link>
            )}
            <PublishProductButton defaultType={type} />
          </div>
        }
      />
      <ResourceList
        items={data as any[] | undefined}
        loading={isLoading}
        error={error}
        loadingText="装载目录…"
        errorText="无法连接 /catalog。"
        emptyText={isService ? "暂无数据服务。" : "暂无数据产品。"}
        rowKey={(p: any) => p.id ?? p.urn}
        renderItem={(p: any) => (
          <>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{p.title ?? p.name}</div>
              <div className="cs-mono text-xs mt-1 truncate" style={{ color: "var(--cs-faint)" }}>
                {p.id ?? p.urn ?? p.providerId ?? ""}
              </div>
              {(p.fhirSchema as any)?.dataPath && (
                <div className="cs-mono text-[0.68rem] mt-0.5 truncate" style={{ color: "var(--cs-dim)" }}>
                  本地路径 {(p.fhirSchema as any).dataPath}
                  <span className="ml-2" style={{ color: "var(--cs-faint)" }}>
                    （不出域 · 仅连接器可见）
                  </span>
                </div>
              )}
            </div>
            {p.classification && <span className="cs-chip">{p.classification}</span>}
            <span className="cs-mono text-xs tabular-nums" style={{ color: "var(--cs-dim)" }}>
              {(p.recordCount ?? 0).toLocaleString()} 行
            </span>
            <span
              className="cs-chip"
              style={{
                borderColor: p.rightsConfirmed ? "var(--cs-green)" : "var(--cs-amber)",
                color: p.rightsConfirmed ? "var(--cs-green)" : "var(--cs-amber)",
              }}
            >
              {p.rightsConfirmed ? "已确权" : "未确权"}
            </span>
            {isConsumer && (
              <RequestContractButton
                compact
                dataProductId={p.id}
                providerId={p.providerId}
              />
            )}
          </>
        )}
      />
    </div>
  );
}
