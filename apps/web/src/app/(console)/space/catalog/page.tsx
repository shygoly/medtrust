"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/console/ui";
import { ResourceList } from "@/components/console/data";
import { PublishProductButton } from "@/components/console/publish-product-button";
import { RequestContractButton } from "@/components/console/request-contract-button";
import { RequestAccessButton } from "@/components/console/request-access-button";
import {
  CdmCoverageSummary,
  cdmPersonScale,
  cdmSourceLabel,
} from "@/components/console/cdm-coverage";
import { api, type CatalogProduct } from "@/api/client";
import { useAuth } from "@/lib/auth";
import { buildProductAccessState } from "@/lib/data-access";
import { participantLabel } from "@/lib/federated-tasks";

export default function CatalogPage() {
  const { role, user, ready } = useAuth();
  const [type, setType] = useState<"data" | "service">("data");
  const { data, isLoading, error } = useQuery({
    queryKey: ["catalog", type],
    queryFn: () => api.listCatalogProducts(type),
  });

  const isConsumer = ready && role === "consumer";
  const isProvider = ready && role === "provider";
  const isService = type === "service";

  // 使用方：一次拿到「已授权 / 已申请」，目录行内直接给状态或申请入口。
  const accessState = useQuery({
    queryKey: ["access-state"],
    enabled: isConsumer,
    queryFn: async () => {
      const [grants, requests] = await Promise.all([
        api.listAccessGrants(),
        api.listDataAccessRequests(),
      ]);
      return buildProductAccessState(grants, requests);
    },
  });

  return (
    <div>
      <PageHeader
        kicker={isService ? "CATALOG · 数据服务目录" : "CATALOG · 数据产品目录"}
        title={isService ? "数据服务目录" : "数据产品目录"}
        desc="此处仅登记元数据（标题/分级/确权/规模/数据源声明），原始数据留在提供方连接器。使用方须先申请数字合约、经提供方签发后，再在编排任务中引用合约。"
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
        items={data as CatalogProduct[] | undefined}
        loading={isLoading}
        error={error}
        loadingText="装载目录…"
        errorText="无法连接 /catalog。"
        emptyText={isService ? "暂无数据服务。" : "暂无数据产品。"}
        rowKey={(p) => p.id ?? p.urn ?? ""}
        renderItem={(p) => {
          const cdmLabel = cdmSourceLabel(p.fhirSchema);
          const href = `/space/catalog/${encodeURIComponent(p.id)}`;
          const mine =
            isProvider &&
            !!user?.participantId &&
            p.providerId === user.participantId;
          return (
            <>
              <div className="flex-1 min-w-0">
                <Link
                  href={href}
                  className="text-sm font-medium truncate block hover:underline"
                >
                  {p.title}
                </Link>
                {(p.fhirSchema as { scenarioTitle?: string } | null)?.scenarioTitle && (
                  <div className="text-xs mt-0.5" style={{ color: "var(--cs-dim)" }}>
                    {(p.fhirSchema as { scenarioTitle?: string }).scenarioTitle}
                  </div>
                )}
                <div
                  className="text-xs mt-1 truncate"
                  style={{ color: "var(--cs-dim)" }}
                  title={p.providerId}
                >
                  {participantLabel(p.providerId)}
                  <span className="cs-mono" style={{ color: "var(--cs-faint)" }}>
                    {" · "}
                    {p.id ?? p.urn ?? ""}
                  </span>
                </div>
                {cdmLabel && (
                  <CdmCoverageSummary label={cdmLabel} coverage={p.coverage as never} />
                )}
              </div>
              {p.classification && <span className="cs-chip">{p.classification}</span>}
              <span
                className="cs-mono text-xs tabular-nums"
                style={{ color: "var(--cs-dim)" }}
              >
                {cdmLabel
                  ? cdmPersonScale(p.coverage as never)
                  : p.productType === "service"
                    ? `容量 ${p.serviceCapacity ?? 0}`
                    : `${(p.recordCount ?? 0).toLocaleString()} 行`}
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
              <Link href={href} className="cs-btn text-xs">
                详情
              </Link>
              {mine && p.status !== "archived" ? (
                <Link
                  href={`/space/catalog/${encodeURIComponent(p.id)}/edit`}
                  className="cs-btn cs-btn-ghost text-xs"
                >
                  编辑
                </Link>
              ) : null}
              {isConsumer && (
                <div className="flex items-center gap-2 shrink-0">
                  <RequestAccessButton
                    dataProductId={String(p.id)}
                    state={
                      accessState.data?.get(String(p.id))?.granted
                        ? "granted"
                        : accessState.data?.get(String(p.id))?.pending
                          ? "pending"
                          : "none"
                    }
                  />
                  <RequestContractButton
                    compact
                    dataProductId={p.id}
                    providerId={p.providerId}
                  />
                </div>
              )}
            </>
          );
        }}
      />
    </div>
  );
}
