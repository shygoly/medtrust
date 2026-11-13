"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/console/ui";
import {
  CatalogProductForm,
  buildCatalogProductPayload,
  emptyCatalogProductForm,
} from "@/components/console/catalog-product-form";
import { api, type CatalogProductInput } from "@/api/client";

export default function CatalogNewPage() {
  const router = useRouter();
  const search = useSearchParams();
  const defaultType =
    search.get("type") === "service" ? "service" : "data";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  return (
    <div>
      <PageHeader
        kicker="CATALOG · 发布"
        desc="登记目录元数据。原始数据留在本院连接器；数据源只声明路径或 CDM label。"
      />
      <div className="p-8 max-w-4xl">
        <CatalogProductForm
          initial={emptyCatalogProductForm(defaultType)}
          mode="create"
          submitting={submitting}
          error={error}
          onCancel={() => router.push("/space/catalog")}
          onSubmit={async (values) => {
            setSubmitting(true);
            setError("");
            try {
              const payload = buildCatalogProductPayload(
                values,
                "create",
              ) as CatalogProductInput;
              if (!payload.providerId) throw new Error("未识别参与方身份，请重新登录");
              const created = await api.createCatalogProduct(payload);
              router.push(`/space/catalog/${encodeURIComponent(created.id)}`);
            } catch (e: unknown) {
              setError((e as Error)?.message || "发布失败");
              setSubmitting(false);
            }
          }}
        />
      </div>
    </div>
  );
}
