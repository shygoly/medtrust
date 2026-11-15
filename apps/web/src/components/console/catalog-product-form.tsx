"use client";

import { useMemo, useState } from "react";
import type {
  CatalogProduct,
  CatalogProductInput,
  CatalogProductUpdateInput,
} from "@/api/client";
import { Panel } from "@/components/console/ui";
import { getUser } from "@/lib/auth";

export type DataSourceKind = "file" | "omop-cdm" | "series-file";

export type SchemaFieldRow = {
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description: string;
};

export type CatalogProductFormValues = {
  title: string;
  productType: "data" | "service";
  classification: "一般" | "重要" | "敏感";
  rightsConfirmed: boolean;
  listingScope: "internal" | "regional";
  listingGrantedBy: string;
  listingBasis: string;
  /** 公开授权留痕的签名（可选；SM2 签名 hex 或线下签署件摘要，原文留院）。 */
  listingSignature: string;
  productRoles: string;
  participantCountBand: string;
  sourceKind: DataSourceKind;
  filePath: string;
  cdmLabel: string;
  seriesPath: string;
  seriesSchema: string;
  recordCount: number;
  resourceType: string;
  profile: string;
  fields: SchemaFieldRow[];
  serviceStatistic: string;
  serviceMinSample: number;
  serviceMinCell: number;
  servicePurposes: string;
  serviceCapacity: number;
};

const CLASSIFICATION_TAG: Record<
  CatalogProductFormValues["classification"],
  NonNullable<CatalogProduct["classificationTag"]>
> = {
  一般: { level: "1", categoryCode: "GENERAL", version: "NDI-TR-2025-06" },
  重要: { level: "2", categoryCode: "IMPORTANT", version: "NDI-TR-2025-06" },
  敏感: { level: "3", categoryCode: "SENSITIVE", version: "NDI-TR-2025-06" },
};

const FIELD_TYPES: SchemaFieldRow["type"][] = [
  "string",
  "number",
  "integer",
  "boolean",
  "array",
  "object",
];

const MANAGED_FHIR_KEYS = [
  "dataSource",
  "localDataPath",
  "dataPath",
  "resourceType",
  "profile",
  "fields",
] as const;

const emptyField = (): SchemaFieldRow => ({
  name: "",
  type: "string",
  description: "",
});

export function emptyCatalogProductForm(
  productType: "data" | "service" = "data",
): CatalogProductFormValues {
  return {
    title: "",
    productType,
    classification: "敏感",
    rightsConfirmed: true,
    listingScope: "internal",
    listingGrantedBy: "",
    listingBasis: "",
    listingSignature: "",
    productRoles: "",
    participantCountBand: "",
    sourceKind: "file",
    filePath: "",
    cdmLabel: "",
    seriesPath: "",
    seriesSchema: "",
    recordCount: 0,
    resourceType: "Bundle",
    profile: "",
    fields: [emptyField()],
    serviceStatistic: "",
    serviceMinSample: 5,
    serviceMinCell: 5,
    servicePurposes: "",
    serviceCapacity: 0,
  };
}

function parseFields(raw: unknown): SchemaFieldRow[] {
  if (!Array.isArray(raw) || raw.length === 0) return [emptyField()];
  return raw.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const type = FIELD_TYPES.includes(row.type as SchemaFieldRow["type"])
      ? (row.type as SchemaFieldRow["type"])
      : "string";
    return {
      name: typeof row.name === "string" ? row.name : "",
      type,
      description: typeof row.description === "string" ? row.description : "",
    };
  });
}

export function catalogProductToFormValues(
  product: CatalogProduct,
): CatalogProductFormValues {
  const base = emptyCatalogProductForm(
    product.productType === "service" ? "service" : "data",
  );
  const schema = (product.fhirSchema ?? {}) as Record<string, unknown>;
  const ds = schema.dataSource as
    | { type?: string; path?: string; label?: string; schema?: string }
    | undefined;
  const legacyPath =
    typeof schema.dataPath === "string"
      ? schema.dataPath
      : typeof schema.localDataPath === "string"
        ? schema.localDataPath
        : "";

  let sourceKind: DataSourceKind = "file";
  let filePath = "";
  let cdmLabel = "";
  let seriesPath = "";
  let seriesSchema = "";
  if (ds?.type === "omop-cdm") {
    sourceKind = "omop-cdm";
    cdmLabel = typeof ds.label === "string" ? ds.label : "";
  } else if (ds?.type === "series-file") {
    sourceKind = "series-file";
    seriesPath = typeof ds.path === "string" ? ds.path : "";
    seriesSchema = typeof ds.schema === "string" ? ds.schema : "";
  } else if (ds?.type === "file" && typeof ds.path === "string") {
    sourceKind = "file";
    filePath = ds.path;
  } else if (legacyPath) {
    sourceKind = "file";
    filePath = legacyPath;
  }

  const classification =
    product.classification === "一般" ||
    product.classification === "重要" ||
    product.classification === "敏感"
      ? product.classification
      : "敏感";

  return {
    ...base,
    title: product.title ?? "",
    productType: product.productType === "service" ? "service" : "data",
    classification,
    rightsConfirmed: Boolean(product.rightsConfirmed),
    listingScope: product.listingScope === "regional" ? "regional" : "internal",
    listingGrantedBy: product.listingConsent?.grantedBy ?? "",
    listingBasis: product.listingConsent?.basis ?? "",
    listingSignature: product.listingConsent?.signature ?? "",
    productRoles: (product.productRoles ?? []).join(", "),
    participantCountBand: product.provenance?.participantCountBand ?? "",
    sourceKind,
    filePath,
    cdmLabel,
    seriesPath,
    seriesSchema,
    recordCount: product.recordCount ?? 0,
    resourceType: typeof schema.resourceType === "string" ? schema.resourceType : "",
    profile: typeof schema.profile === "string" ? schema.profile : "",
    fields: parseFields(schema.fields),
    serviceStatistic: product.serviceSpec?.statistic ?? "",
    serviceMinSample: product.serviceSpec?.minSample ?? 5,
    serviceMinCell: product.serviceSpec?.gate?.minCell ?? 5,
    servicePurposes: (product.serviceSpec?.allowedPurposes ?? []).join(", "),
    serviceCapacity: product.serviceCapacity ?? 0,
  };
}

function splitCsv(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

function buildDataSource(values: CatalogProductFormValues): Record<string, unknown> | null {
  if (values.sourceKind === "omop-cdm") {
    const label = values.cdmLabel.trim();
    return label ? { type: "omop-cdm", label } : null;
  }
  if (values.sourceKind === "series-file") {
    const path = values.seriesPath.trim();
    const schema = values.seriesSchema.trim();
    return path && schema ? { type: "series-file", path, schema } : null;
  }
  const path = values.filePath.trim();
  return path ? { type: "file", path } : null;
}

function buildFieldsPayload(values: CatalogProductFormValues) {
  return values.fields
    .map((f) => ({
      name: f.name.trim(),
      type: f.type,
      ...(f.description.trim() ? { description: f.description.trim() } : {}),
    }))
    .filter((f) => f.name);
}

/** 组装 fhirSchema；update 时保留库内非托管键。 */
export function buildFhirSchema(
  values: CatalogProductFormValues,
  existing?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (values.productType === "service") return null;
  const dataSource = buildDataSource(values);
  const built: Record<string, unknown> = {
    fields: buildFieldsPayload(values),
  };
  if (dataSource) built.dataSource = dataSource;
  if (values.resourceType.trim()) built.resourceType = values.resourceType.trim();
  if (values.profile.trim()) built.profile = values.profile.trim();

  if (!existing) return built;
  const base: Record<string, unknown> = { ...existing };
  for (const key of MANAGED_FHIR_KEYS) delete base[key];
  const next = { ...base, ...built };
  if (next.dataSource != null) {
    delete next.dataPath;
    delete next.localDataPath;
  }
  return next;
}

export function buildCatalogProductPayload(
  values: CatalogProductFormValues,
  mode: "create" | "update",
  existingFhirSchema?: Record<string, unknown> | null,
): CatalogProductInput | CatalogProductUpdateInput {
  const classificationTag = CLASSIFICATION_TAG[values.classification];
  const productRoles = splitCsv(values.productRoles);
  const provenance = values.participantCountBand.trim()
    ? { participantCountBand: values.participantCountBand.trim() }
    : null;
  const listingConsent =
    values.listingScope === "regional"
      ? {
          grantedBy: values.listingGrantedBy.trim(),
          grantedAt: new Date().toISOString(),
          basis: values.listingBasis.trim(),
          ...(values.listingSignature.trim()
            ? { signature: values.listingSignature.trim() }
            : {}),
        }
      : null;

  const common = {
    title: values.title.trim(),
    productType: values.productType,
    classification: values.classification,
    classificationTag,
    rightsConfirmed: values.rightsConfirmed,
    listingScope: values.listingScope,
    listingConsent,
    productRoles: productRoles.length ? productRoles : undefined,
    provenance,
  };

  if (values.productType === "service") {
    const purposes = splitCsv(values.servicePurposes);
    const body = {
      ...common,
      recordCount: 0,
      fhirSchema: null,
      serviceSpec: {
        statistic: values.serviceStatistic.trim(),
        minSample: values.serviceMinSample,
        gate: { minCell: values.serviceMinCell },
        ...(purposes.length ? { allowedPurposes: purposes } : {}),
      },
      serviceCapacity: values.serviceCapacity,
    };
    if (mode === "create") {
      return {
        ...body,
        providerId: getUser()?.participantId ?? "",
      } satisfies CatalogProductInput;
    }
    return body;
  }

  const body = {
    ...common,
    recordCount: values.recordCount,
    fhirSchema: buildFhirSchema(
      values,
      mode === "update" ? existingFhirSchema : null,
    ),
    serviceSpec: null,
    serviceCapacity: null,
  };
  if (mode === "create") {
    return {
      ...body,
      providerId: getUser()?.participantId ?? "",
    } satisfies CatalogProductInput;
  }
  return body;
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="cs-label">{label}</span>
      {children}
      {hint ? (
        <span className="block text-[0.68rem]" style={{ color: "var(--cs-faint)" }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function CatalogProductForm({
  initial,
  mode,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  initial: CatalogProductFormValues;
  mode: "create" | "update";
  submitting?: boolean;
  error?: string;
  onSubmit: (values: CatalogProductFormValues) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<CatalogProductFormValues>(initial);
  const set = <K extends keyof CatalogProductFormValues>(
    key: K,
    value: CatalogProductFormValues[K],
  ) => setValues((prev) => ({ ...prev, [key]: value }));

  const setField = (index: number, patch: Partial<SchemaFieldRow>) => {
    setValues((prev) => ({
      ...prev,
      fields: prev.fields.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  };

  const canSubmit = useMemo(() => {
    if (!values.title.trim() || !values.rightsConfirmed || submitting) return false;
    if (values.listingScope === "regional") {
      if (!values.listingGrantedBy.trim() || !values.listingBasis.trim()) return false;
    }
    if (values.productType === "service") {
      return Boolean(values.serviceStatistic.trim() && values.serviceMinSample > 0);
    }
    const named = values.fields.filter((f) => f.name.trim());
    if (!named.length) return false;
    if (mode === "create") {
      if (values.sourceKind === "omop-cdm") return Boolean(values.cdmLabel.trim());
      if (values.sourceKind === "series-file") {
        return Boolean(values.seriesPath.trim() && values.seriesSchema.trim());
      }
      return Boolean(values.filePath.trim());
    }
    // update：允许存量无路径，但若选了某种源则对应字段须齐
    if (values.sourceKind === "omop-cdm") {
      return !values.cdmLabel.trim() || Boolean(values.cdmLabel.trim());
    }
    if (values.sourceKind === "series-file") {
      const any = values.seriesPath.trim() || values.seriesSchema.trim();
      if (!any) return true;
      return Boolean(values.seriesPath.trim() && values.seriesSchema.trim());
    }
    return true;
  }, [values, submitting, mode]);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        void onSubmit(values);
      }}
    >
      <Panel className="p-5 space-y-4">
        <h3 className="text-sm" style={{ color: "var(--cs-dim)" }}>
          基本信息
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="标题">
            <input
              className="cs-input w-full"
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="如：示范甲 AMR 药敏结果产品"
              required
            />
          </Field>
          <Field label="类型">
            <select
              className="cs-input w-full"
              value={values.productType}
              onChange={(e) =>
                set("productType", e.target.value as "data" | "service")
              }
            >
              <option value="data">数据产品</option>
              <option value="service">数据服务</option>
            </select>
          </Field>
          <Field label="分级" hint="自动写入 NDI-TR-2025-06 结构化标签">
            <select
              className="cs-input w-full"
              value={values.classification}
              onChange={(e) =>
                set(
                  "classification",
                  e.target.value as CatalogProductFormValues["classification"],
                )
              }
            >
              <option>敏感</option>
              <option>重要</option>
              <option>一般</option>
            </select>
          </Field>
          <Field label="确权">
            <label className="flex items-center gap-2 text-sm mt-2">
              <input
                type="checkbox"
                checked={values.rightsConfirmed}
                onChange={(e) => set("rightsConfirmed", e.target.checked)}
              />
              已完成数据确权，同意上架目录
            </label>
          </Field>
        </div>
      </Panel>

      <Panel className="p-5 space-y-4">
        <h3 className="text-sm" style={{ color: "var(--cs-dim)" }}>
          上架与披露
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="上架范围"
            hint="internal 仅本空间可见；regional 需填写公开授权留痕"
          >
            <select
              className="cs-input w-full"
              value={values.listingScope}
              onChange={(e) =>
                set("listingScope", e.target.value as "internal" | "regional")
              }
            >
              <option value="internal">本空间（internal）</option>
              <option value="regional">区域公开（regional）</option>
            </select>
          </Field>
          <Field label="场景角色标签" hint="可选，逗号分隔">
            <input
              className="cs-input w-full"
              value={values.productRoles}
              onChange={(e) => set("productRoles", e.target.value)}
            />
          </Field>
          <Field label="参与方数量区间" hint="可选，如 2–5">
            <input
              className="cs-input w-full"
              value={values.participantCountBand}
              onChange={(e) => set("participantCountBand", e.target.value)}
            />
          </Field>
        </div>
        {values.listingScope === "regional" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="公开授权主体">
              <input
                className="cs-input w-full"
                value={values.listingGrantedBy}
                onChange={(e) => set("listingGrantedBy", e.target.value)}
                required
              />
            </Field>
            <Field label="授权依据">
              <input
                className="cs-input w-full"
                value={values.listingBasis}
                onChange={(e) => set("listingBasis", e.target.value)}
                required
              />
            </Field>
            <Field
              label="授权签名（可选）"
              hint="SM2 签名 hex 或线下签署件摘要；原文与私钥留在本院，不上传"
            >
              <input
                className="cs-input w-full cs-mono text-xs"
                value={values.listingSignature}
                onChange={(e) => set("listingSignature", e.target.value)}
              />
            </Field>
          </div>
        ) : null}
      </Panel>

      {values.productType === "data" ? (
        <>
          <Panel className="p-5 space-y-4">
            <h3 className="text-sm" style={{ color: "var(--cs-dim)" }}>
              字段契约（fields）
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="resourceType" hint="可选，如 Bundle / ImagingStudy">
                <input
                  className="cs-input w-full cs-mono"
                  value={values.resourceType}
                  onChange={(e) => set("resourceType", e.target.value)}
                />
              </Field>
              <Field label="profile" hint="可选，如 urn:medtrust:renal-us-v1">
                <input
                  className="cs-input w-full cs-mono"
                  value={values.profile}
                  onChange={(e) => set("profile", e.target.value)}
                />
              </Field>
            </div>
            <div className="space-y-2">
              <div
                className="grid grid-cols-[1fr_7rem_1fr_auto] gap-2 text-xs"
                style={{ color: "var(--cs-dim)" }}
              >
                <span>name</span>
                <span>type</span>
                <span>description</span>
                <span />
              </div>
              {values.fields.map((row, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[1fr_7rem_1fr_auto] gap-2 items-center"
                >
                  <input
                    className="cs-input cs-mono text-xs"
                    placeholder="字段名"
                    value={row.name}
                    onChange={(e) => setField(index, { name: e.target.value })}
                  />
                  <select
                    className="cs-input text-xs"
                    value={row.type}
                    onChange={(e) =>
                      setField(index, {
                        type: e.target.value as SchemaFieldRow["type"],
                      })
                    }
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input
                    className="cs-input text-xs"
                    placeholder="说明"
                    value={row.description}
                    onChange={(e) =>
                      setField(index, { description: e.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="cs-btn cs-btn-ghost text-xs"
                    disabled={values.fields.length <= 1}
                    onClick={() =>
                      set(
                        "fields",
                        values.fields.filter((_, i) => i !== index),
                      )
                    }
                  >
                    删
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="cs-btn cs-btn-ghost text-xs"
                onClick={() => set("fields", [...values.fields, emptyField()])}
              >
                添加字段
              </button>
            </div>
          </Panel>

          <Panel className="p-5 space-y-4">
            <h3 className="text-sm" style={{ color: "var(--cs-dim)" }}>
              数据源声明（元数据；原始数据不出域）
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="数据源类型">
                <select
                  className="cs-input w-full"
                  value={values.sourceKind}
                  onChange={(e) =>
                    set("sourceKind", e.target.value as DataSourceKind)
                  }
                >
                  <option value="file">本地文件（file）</option>
                  <option value="omop-cdm">院内 CDM 库（omop-cdm）</option>
                  <option value="series-file">时序文件（series-file）</option>
                </select>
              </Field>
              <Field label="记录规模" hint="行 / 患者数说明">
                <input
                  type="number"
                  min={0}
                  className="cs-input w-full cs-mono"
                  value={values.recordCount}
                  onChange={(e) =>
                    set("recordCount", parseInt(e.target.value, 10) || 0)
                  }
                />
              </Field>
              {values.sourceKind === "file" ? (
                <Field
                  label="连接器本地路径"
                  hint={
                    mode === "create"
                      ? "发布必填"
                      : "可留空以保留存量「仅字段契约、无路径」产品"
                  }
                >
                  <input
                    className="cs-input w-full cs-mono text-xs"
                    value={values.filePath}
                    onChange={(e) => set("filePath", e.target.value)}
                    required={mode === "create"}
                  />
                </Field>
              ) : null}
              {values.sourceKind === "omop-cdm" ? (
                <Field label="CDM 数据源 label">
                  <input
                    className="cs-input w-full cs-mono"
                    value={values.cdmLabel}
                    onChange={(e) => set("cdmLabel", e.target.value)}
                    required={mode === "create"}
                  />
                </Field>
              ) : null}
              {values.sourceKind === "series-file" ? (
                <>
                  <Field label="时序文件路径">
                    <input
                      className="cs-input w-full cs-mono text-xs"
                      value={values.seriesPath}
                      onChange={(e) => set("seriesPath", e.target.value)}
                      required={mode === "create"}
                    />
                  </Field>
                  <Field label="schema" hint="形如 pack.name@1">
                    <input
                      className="cs-input w-full cs-mono"
                      value={values.seriesSchema}
                      onChange={(e) => set("seriesSchema", e.target.value)}
                      required={mode === "create"}
                    />
                  </Field>
                </>
              ) : null}
            </div>
          </Panel>
        </>
      ) : (
        <Panel className="p-5 space-y-4">
          <h3 className="text-sm" style={{ color: "var(--cs-dim)" }}>
            数据服务规格
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="统计口径 statistic">
              <input
                className="cs-input w-full"
                value={values.serviceStatistic}
                onChange={(e) => set("serviceStatistic", e.target.value)}
                required
              />
            </Field>
            <Field label="最小样本 minSample">
              <input
                type="number"
                min={1}
                className="cs-input w-full cs-mono"
                value={values.serviceMinSample}
                onChange={(e) =>
                  set("serviceMinSample", parseInt(e.target.value, 10) || 0)
                }
              />
            </Field>
            <Field label="出域闸门 minCell">
              <input
                type="number"
                min={1}
                className="cs-input w-full cs-mono"
                value={values.serviceMinCell}
                onChange={(e) =>
                  set("serviceMinCell", parseInt(e.target.value, 10) || 0)
                }
              />
            </Field>
            <Field label="服务容量">
              <input
                type="number"
                min={0}
                className="cs-input w-full cs-mono"
                value={values.serviceCapacity}
                onChange={(e) =>
                  set("serviceCapacity", parseInt(e.target.value, 10) || 0)
                }
              />
            </Field>
            <Field label="允许用途" hint="可选，逗号分隔">
              <input
                className="cs-input w-full"
                value={values.servicePurposes}
                onChange={(e) => set("servicePurposes", e.target.value)}
              />
            </Field>
          </div>
        </Panel>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button className="cs-btn" type="submit" disabled={!canSubmit}>
          {submitting ? "提交中…" : mode === "create" ? "确权并发布" : "保存修改"}
        </button>
        <button className="cs-btn cs-btn-ghost" type="button" onClick={onCancel}>
          取消
        </button>
        {error ? (
          <span className="text-sm" style={{ color: "var(--cs-red)" }}>
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
