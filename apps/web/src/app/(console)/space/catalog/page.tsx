"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/console/ui";
import { ResourceList } from "@/components/console/data";
import { PublishProductButton } from "@/components/console/publish-product-button";
import { RequestContractButton } from "@/components/console/request-contract-button";
import { RequestAccessButton } from "@/components/console/request-access-button";
import { CdmCoverageSummary, cdmSourceLabel } from "@/components/console/cdm-coverage";
import { api, type CatalogProduct } from "@/api/client";
import { useAuth } from "@/lib/auth";
import { buildProductAccessState } from "@/lib/data-access";
import {
  catalogClassificationLabel,
  catalogDataSourceSummary,
  catalogIdHint,
  catalogProviderName,
  catalogScaleLabel,
} from "@/lib/catalog-display";

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
          const source = catalogDataSourceSummary(p);
          const href = `/space/catalog/${encodeURIComponent(p.id)}`;
          const mine =
            isProvider &&
            !!user?.participantId &&
            p.providerId === user.participantId;
          const classification = catalogClassificationLabel(p);
          const idHint = catalogIdHint(p.id);
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
                {/* 提供方主文案 = 登记名；id 只作次要提示，UUID 形态不刷完整串。 */}
                <div
                  className="text-xs mt-1 truncate"
                  style={{ color: "var(--cs-dim)" }}
                  title={`${p.providerId} · ${p.id ?? p.urn ?? ""}`}
                >
                  {catalogProviderName(p)}
                  {idHint ? (
                    <span className="cs-mono" style={{ color: "var(--cs-faint)" }}>
                      {" · "}
                      {idHint}
                    </span>
                  ) : null}
                </div>
                {/* 数据源摘要：列表与详情同一 helper，ImagingStudy 不得报「未声明」。 */}
                <div
                  className="text-xs mt-0.5 truncate"
                  style={{ color: "var(--cs-faint)" }}
                  title={source.text}
                >
                  {source.text}
                </div>
                {cdmLabel && (
                  <CdmCoverageSummary label={cdmLabel} coverage={p.coverage as never} />
                )}
              </div>
              {classification && <span className="cs-chip">{classification}</span>}
              <span
                className="cs-mono text-xs tabular-nums"
                style={{ color: "var(--cs-dim)" }}
              >
                {catalogScaleLabel(p)}
              </span>
              {/* 默认视图只在架且已确权（服务端已过滤），不再挂恒真的「已确权」徽章。 */}
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
