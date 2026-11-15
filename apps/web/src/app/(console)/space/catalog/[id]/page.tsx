"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Panel } from "@/components/console/ui";
import { DataGrid, type GridColumn } from "@/components/console/data";
import { RequestContractButton } from "@/components/console/request-contract-button";
import { CdmCoverageSummary, cdmSourceLabel } from "@/components/console/cdm-coverage";
import { api } from "@/api/client";
import { useAuth } from "@/lib/auth";
import {
  catalogClassificationLabel,
  catalogDataSourceSummary,
  catalogFieldRows,
  catalogListingScopeLabel,
  catalogProviderName,
  catalogScaleLabel,
  catalogStatusLabel,
  formatCatalogTime,
} from "@/lib/catalog-display";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt style={{ color: "var(--cs-dim)" }}>{k}</dt>
      <dd className="min-w-0 break-words">{v ?? "—"}</dd>
    </>
  );
}

type FieldRow = { name: string; type: string; description: string };

const FIELD_COLUMNS: GridColumn<FieldRow>[] = [
  {
    header: "字段",
    className: "col-span-3 cs-mono text-xs",
    cell: (f) => f.name,
  },
  {
    header: "类型",
    className: "col-span-3 cs-mono text-xs",
    cell: (f) => f.type,
  },
  {
    header: "说明",
    className: "col-span-6 text-xs",
    cell: (f) => f.description,
  },
];

export default function CatalogDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const queryClient = useQueryClient();
  const { role, user, ready } = useAuth();
  const [archiving, setArchiving] = useState(false);
  const [msg, setMsg] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["catalog-product", id],
    queryFn: () => api.getCatalogProduct(id),
    enabled: Boolean(id),
    retry: false,
  });

  const isOwner =
    ready &&
    role === "provider" &&
    !!user?.participantId &&
    data?.providerId === user.participantId;
  const isConsumer = ready && role === "consumer";
  const cdmLabel = cdmSourceLabel(data?.fhirSchema);
  const source = data ? catalogDataSourceSummary(data) : null;
  const classification = data ? catalogClassificationLabel(data) : null;
  const roles = data?.productRoles?.filter((r) => Boolean(r?.trim())) ?? [];
  const participantBand = data?.provenance?.participantCountBand?.trim();
  const fields = data ? catalogFieldRows(data) : [];

  return (
    <div>
      <PageHeader
        kicker="CATALOG · 详情"
        title={data?.title || id || "数据产品"}
        desc="目录只展示元数据；原始数据留在提供方连接器。"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {isConsumer && data?.status === "active" ? (
              <RequestContractButton
                dataProductId={data.id}
                providerId={data.providerId}
              />
            ) : null}
            {isOwner && data?.status !== "archived" ? (
              <>
                <Link
                  href={`/space/catalog/${encodeURIComponent(id)}/edit`}
                  className="cs-btn"
                >
                  编辑
                </Link>
                <button
                  className="cs-btn"
                  style={{ borderColor: "var(--cs-red)", color: "var(--cs-red)" }}
                  disabled={archiving}
                  onClick={async () => {
                    if (!window.confirm("确认下架该产品？存量合约不受影响，但不可再新申请。")) {
                      return;
                    }
                    setArchiving(true);
                    setMsg("");
                    try {
                      await api.archiveCatalogProduct(id);
                      await queryClient.invalidateQueries({
                        queryKey: ["catalog-product", id],
                      });
                      await queryClient.invalidateQueries({ queryKey: ["catalog"] });
                      setMsg("已下架");
                    } catch (e: unknown) {
                      setMsg((e as Error)?.message || "下架失败");
                    } finally {
                      setArchiving(false);
                    }
                  }}
                >
                  {archiving ? "下架中…" : "下架"}
                </button>
              </>
            ) : null}
          </div>
        }
      />
      <div className="p-8 space-y-4 max-w-4xl">
        {isLoading ? (
          <p className="text-sm" style={{ color: "var(--cs-dim)" }}>
            装载中…
          </p>
        ) : error ? (
          <p className="text-sm" style={{ color: "var(--cs-red)" }}>
            读取失败：{(error as Error)?.message}
          </p>
        ) : !data ? null : (
          <>
            <Panel className="p-5">
              <h3 className="text-sm mb-3" style={{ color: "var(--cs-dim)" }}>
                产品
              </h3>
              <dl className="text-sm grid grid-cols-[8rem_1fr] gap-y-2 gap-x-4">
                <Row k="标题" v={data.title} />
                {/* 完整 id/urn 留在详情，供核对；列表只给短提示。 */}
                <Row k="ID" v={<span className="cs-mono text-xs">{data.id}</span>} />
                <Row
                  k="URN"
                  v={<span className="cs-mono text-xs">{data.urn ?? "—"}</span>}
                />
                <Row
                  k="提供方"
                  v={
                    <span title={data.providerId}>
                      {catalogProviderName(data)}
                      <span
                        className="cs-mono text-xs ml-2"
                        style={{ color: "var(--cs-faint)" }}
                      >
                        {data.providerId}
                      </span>
                    </span>
                  }
                />
                <Row k="类型" v={data.productType === "service" ? "数据服务" : "数据产品"} />
                <Row k="状态" v={catalogStatusLabel(data.status)} />
                <Row k="上架范围" v={catalogListingScopeLabel(data.listingScope)} />
                <Row k="分级" v={classification ?? "—"} />
                <Row k="确权" v={data.rightsConfirmed ? "已确权" : "未确权"} />
                <Row k="所属空间" v={<span className="cs-mono text-xs">{data.homeSpace ?? "—"}</span>} />
                <Row k="创建时间" v={formatCatalogTime(data.createdAt) ?? "—"} />
                <Row k="更新时间" v={formatCatalogTime(data.updatedAt) ?? "—"} />
              </dl>
              {msg ? (
                <p className="text-sm mt-3" style={{ color: "var(--cs-dim)" }}>
                  {msg}
                </p>
              ) : null}
            </Panel>

            <Panel className="p-5">
              <h3 className="text-sm mb-3" style={{ color: "var(--cs-dim)" }}>
                数据源与规模
              </h3>
              <dl className="text-sm grid grid-cols-[8rem_1fr] gap-y-2 gap-x-4">
                <Row k="数据源" v={source?.text ?? "未声明数据源"} />
                <Row k="规模" v={catalogScaleLabel(data)} />
                {/* 空的可选元数据不占行（spec「详情页空元数据不制造噪音」）。 */}
                {roles.length > 0 ? <Row k="角色标签" v={roles.join("、")} /> : null}
                {participantBand ? <Row k="参与方区间" v={participantBand} /> : null}
              </dl>
              {cdmLabel ? (
                <div className="mt-3">
                  <CdmCoverageSummary label={cdmLabel} coverage={data.coverage as never} />
                </div>
              ) : null}
            </Panel>

            {data.productType === "service" && data.serviceSpec ? (
              <Panel className="p-5">
                <h3 className="text-sm mb-3" style={{ color: "var(--cs-dim)" }}>
                  服务规格
                </h3>
                <dl className="text-sm grid grid-cols-[8rem_1fr] gap-y-2 gap-x-4">
                  <Row k="统计口径" v={data.serviceSpec.statistic} />
                  <Row k="最小样本" v={data.serviceSpec.minSample} />
                  <Row k="minCell" v={data.serviceSpec.gate?.minCell ?? "—"} />
                  <Row
                    k="允许用途"
                    v={(data.serviceSpec.allowedPurposes ?? []).join("、") || "—"}
                  />
                </dl>
              </Panel>
            ) : null}

            {data.listingScope === "regional" && data.listingConsent ? (
              <Panel className="p-5">
                <h3 className="text-sm mb-3" style={{ color: "var(--cs-dim)" }}>
                  公开授权留痕
                </h3>
                <dl className="text-sm grid grid-cols-[8rem_1fr] gap-y-2 gap-x-4">
                  <Row k="授权主体" v={data.listingConsent.grantedBy} />
                  <Row
                    k="时间"
                    v={formatCatalogTime(data.listingConsent.grantedAt) ?? data.listingConsent.grantedAt}
                  />
                  <Row k="依据" v={data.listingConsent.basis} />
                </dl>
              </Panel>
            ) : null}

            {data.productType !== "service" ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                  <span className="cs-label">字段契约</span>
                  <span className="cs-mono text-xs" style={{ color: "var(--cs-dim)" }}>
                    resourceType{" "}
                    {typeof data.fhirSchema?.resourceType === "string"
                      ? data.fhirSchema.resourceType
                      : "—"}
                    {typeof data.fhirSchema?.profile === "string"
                      ? ` · profile ${data.fhirSchema.profile}`
                      : ""}
                  </span>
                </div>
                {fields.length > 0 ? (
                  <DataGrid
                    columns={FIELD_COLUMNS}
                    rows={fields}
                    rowKey={(f, i) => `${f.name}-${i}`}
                    loading={false}
                    emptyText="未登记字段契约（fields）"
                  />
                ) : (
                  <Panel className="px-5 py-4">
                    <p className="text-sm" style={{ color: "var(--cs-amber)" }}>
                      未登记字段契约（fields）
                    </p>
                  </Panel>
                )}
              </div>
            ) : null}

            {data.fhirSchema ? (
              <details className="cs-panel p-5">
                <summary
                  className="text-sm cursor-pointer"
                  style={{ color: "var(--cs-dim)" }}
                >
                  高级：fhirSchema 原始 JSON
                </summary>
                <pre
                  className="cs-mono text-[0.68rem] overflow-x-auto whitespace-pre-wrap mt-3"
                  style={{ color: "var(--cs-dim)" }}
                >
                  {JSON.stringify(data.fhirSchema, null, 2)}
                </pre>
              </details>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
