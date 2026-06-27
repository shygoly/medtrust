"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/console/ui";
import { ResourceList } from "@/components/console/data";
import { PublishProductButton } from "@/components/console/publish-product-button";
import { api } from "@/api/client";

export default function CatalogPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["catalog"],
    queryFn: () => api.getDataAssets(),
  });

  return (
    <div>
      <PageHeader
        kicker="CATALOG · 数据产品目录"
        title="数据产品目录"
        desc="原始数据留在各参与方连接器本地、不出域;此处仅登记数据产品的元数据(标题/分级/确权/规模)。"
        action={<PublishProductButton />}
      />
      <ResourceList
        items={data as any[] | undefined}
        loading={isLoading}
        error={error}
        loadingText="装载目录…"
        errorText="无法连接 /catalog。"
        emptyText="暂无数据产品。"
        rowKey={(p: any) => p.id ?? p.urn}
        renderItem={(p: any) => (
          <>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{p.title ?? p.name}</div>
              <div className="cs-mono text-xs mt-1 truncate" style={{ color: "var(--cs-faint)" }}>
                {p.urn ?? p.providerId ?? ""}
              </div>
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
          </>
        )}
      />
    </div>
  );
}
