"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/console/ui";
import {
  CatalogProductForm,
  buildCatalogProductPayload,
  catalogProductToFormValues,
} from "@/components/console/catalog-product-form";
import { api, type CatalogProductUpdateInput } from "@/api/client";
import { useAuth } from "@/lib/auth";

export default function CatalogEditPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const router = useRouter();
  const { user, ready } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["catalog-product", id],
    queryFn: () => api.getCatalogProduct(id),
    enabled: Boolean(id),
    retry: false,
  });

  const initial = useMemo(
    () => (data ? catalogProductToFormValues(data) : null),
    [data],
  );

  const isOwner =
    ready &&
    !!user?.participantId &&
    data?.providerId === user.participantId;

  return (
    <div>
      <PageHeader
        kicker="CATALOG · 编辑"
        desc="修改目录元数据。改数据源声明会清掉与旧源不匹配的覆盖统计。"
      />
      <div className="p-8 max-w-4xl">
        {isLoading || !initial ? (
          <p className="text-sm" style={{ color: "var(--cs-dim)" }}>
            {loadError ? `读取失败：${(loadError as Error).message}` : "装载中…"}
          </p>
        ) : !isOwner ? (
          <p className="text-sm" style={{ color: "var(--cs-red)" }}>
            只能编辑本院发布的数据产品。
          </p>
        ) : (
          <CatalogProductForm
            key={id}
            initial={initial}
            mode="update"
            submitting={submitting}
            error={error}
            onCancel={() =>
              router.push(`/space/catalog/${encodeURIComponent(id)}`)
            }
            onSubmit={async (values) => {
              setSubmitting(true);
              setError("");
              try {
                const payload = buildCatalogProductPayload(
                  values,
                  "update",
                  (data.fhirSchema as Record<string, unknown> | null) ?? null,
                ) as CatalogProductUpdateInput;
                await api.updateCatalogProduct(id, payload);
                router.push(`/space/catalog/${encodeURIComponent(id)}`);
              } catch (e: unknown) {
                setError((e as Error)?.message || "保存失败");
                setSubmitting(false);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
