"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Panel } from "@/components/console/ui";
import { RequestContractButton } from "@/components/console/request-contract-button";
import {
  CdmCoverageSummary,
  cdmSourceLabel,
  type CdmCoverage,
} from "@/components/console/cdm-coverage";
import { api } from "@/api/client";
import { useAuth } from "@/lib/auth";
import { participantLabel } from "@/lib/federated-tasks";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt style={{ color: "var(--cs-dim)" }}>{k}</dt>
      <dd className="min-w-0 break-words">{v ?? "—"}</dd>
    </>
  );
}

function dataSourceText(fhirSchema: Record<string, unknown> | null | undefined) {
  const ds = fhirSchema?.dataSource as
    | { type?: string; path?: string; label?: string; schema?: string }
    | undefined;
  if (ds?.type === "omop-cdm") return `CDM · label ${ds.label ?? "—"}`;
  if (ds?.type === "series-file") {
    return `时序文件 · ${ds.path ?? "—"} · ${ds.schema ?? "—"}`;
  }
  if (ds?.type === "file") return `本地文件 · ${ds.path ?? "—"}`;
  const legacy =
    (typeof fhirSchema?.dataPath === "string" && fhirSchema.dataPath) ||
    (typeof fhirSchema?.localDataPath === "string" && fhirSchema.localDataPath);
  return legacy ? `本地路径 · ${legacy}` : "未声明";
}

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
                <Row k="ID" v={<span className="cs-mono text-xs">{data.id}</span>} />
                <Row k="URN" v={<span className="cs-mono text-xs">{data.urn ?? "—"}</span>} />
                <Row
                  k="提供方"
                  v={
                    <span title={data.providerId}>
                      {participantLabel(data.providerId)}
                    </span>
                  }
                />
                <Row k="类型" v={data.productType === "service" ? "数据服务" : "数据产品"} />
                <Row k="状态" v={data.status ?? "—"} />
                <Row k="分级" v={data.classification ?? "—"} />
                <Row
                  k="分级标签"
                  v={
                    data.classificationTag
                      ? `${data.classificationTag.level} / ${data.classificationTag.categoryCode} / ${data.classificationTag.version ?? "—"}`
                      : "—"
                  }
                />
                <Row k="确权" v={data.rightsConfirmed ? "已确权" : "未确权"} />
                <Row k="上架范围" v={data.listingScope ?? "internal"} />
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
                <Row k="数据源" v={dataSourceText(data.fhirSchema)} />
                <Row
                  k="规模"
                  v={
                    data.productType === "service"
                      ? `服务容量 ${data.serviceCapacity ?? 0}`
                      : `${(data.recordCount ?? 0).toLocaleString()} 行`
                  }
                />
                <Row
                  k="角色标签"
                  v={(data.productRoles ?? []).join(", ") || "—"}
                />
                <Row
                  k="参与方区间"
                  v={data.provenance?.participantCountBand ?? "—"}
                />
              </dl>
              {cdmLabel ? (
                <div className="mt-3">
                  <CdmCoverageSummary
                    label={cdmLabel}
                    coverage={data.coverage as CdmCoverage | null | undefined}
                  />
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
                    v={(data.serviceSpec.allowedPurposes ?? []).join(", ") || "—"}
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
                  <Row k="时间" v={data.listingConsent.grantedAt} />
                  <Row k="依据" v={data.listingConsent.basis} />
                </dl>
              </Panel>
            ) : null}

            {data.productType !== "service" ? (
              <Panel className="p-5">
                <h3 className="text-sm mb-3" style={{ color: "var(--cs-dim)" }}>
                  字段契约
                </h3>
                <dl className="text-sm grid grid-cols-[8rem_1fr] gap-y-2 gap-x-4 mb-4">
                  <Row
                    k="resourceType"
                    v={
                      typeof data.fhirSchema?.resourceType === "string"
                        ? data.fhirSchema.resourceType
                        : "—"
                    }
                  />
                  <Row
                    k="profile"
                    v={
                      typeof data.fhirSchema?.profile === "string"
                        ? data.fhirSchema.profile
                        : "—"
                    }
                  />
                </dl>
                {Array.isArray(data.fhirSchema?.fields) &&
                data.fhirSchema.fields.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ color: "var(--cs-dim)" }}>
                        <th className="text-left py-1">name</th>
                        <th className="text-left py-1">type</th>
                        <th className="text-left py-1">description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        data.fhirSchema.fields as Array<{
                          name?: string;
                          type?: string;
                          description?: string;
                        }>
                      ).map((f, i) => (
                        <tr
                          key={`${f.name ?? "f"}-${i}`}
                          style={{ borderTop: "1px solid var(--cs-line)" }}
                        >
                          <td className="py-1.5 cs-mono text-xs">{f.name ?? "—"}</td>
                          <td className="py-1.5 cs-mono text-xs">{f.type ?? "—"}</td>
                          <td className="py-1.5">{f.description ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm" style={{ color: "var(--cs-amber)" }}>
                    未登记字段契约（fields）
                  </p>
                )}
              </Panel>
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
