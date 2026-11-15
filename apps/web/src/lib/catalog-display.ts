import { cdmPersonScale, type CdmCoverage } from "@/components/console/cdm-coverage";
import { participantLabel } from "@/lib/federated-tasks";

// catalog-browse-display —— 目录浏览的**单一呈现口径**。
//
// 列表（/space/catalog）与详情（/space/catalog/{id}）只消费这里的函数，禁止各写一套
// 「数据源摘要 / 分级拼串 / 规模口径」：两边口径一旦分叉，就会出现列表说「影像」、
// 详情说「未声明」这种自相矛盾的画面。
//
// 规则只读已登记元数据（fhirSchema / serviceSpec / coverage），绝不读行级数据。

/** 目录浏览所需的最小字段形状（与 `CatalogProduct` 结构兼容，便于单独单测）。 */
export interface CatalogBrowseProduct {
  id: string;
  urn?: string;
  homeSpace?: string;
  providerId: string;
  /** 控制面随列表/详情附带；缺失时回退演示名表再回退 id。 */
  providerDisplayName?: string;
  title?: string;
  productType?: "data" | "service";
  classification?: string;
  classificationTag?: {
    level?: string;
    categoryCode?: string;
    version?: string;
  } | null;
  status?: "active" | "archived" | "draft" | string | null;
  rightsConfirmed?: boolean;
  recordCount?: number | null;
  fhirSchema?: Record<string, unknown> | null;
  /** CDM 覆盖元数据（控制面原样透传；形状见 cdm-coverage 的 CdmCoverage）。 */
  coverage?: CdmCoverage | Record<string, unknown> | null;
  listingScope?: "internal" | "regional" | string | null;
  serviceSpec?: { statistic?: string } | null;
  serviceCapacity?: number | null;
  createdAt?: string;
  updatedAt?: string | null;
}

export type CatalogDataSourceKind =
  | "omop-cdm"
  | "fhir-resource"
  | "series-file"
  | "file"
  | "service"
  | "undeclared";

export interface CatalogDataSourceSummary {
  kind: CatalogDataSourceKind;
  /** 一句可读摘要；列表与详情同源。 */
  text: string;
}

const RESOURCE_HINTS: Record<string, string> = {
  ImagingStudy: "影像 · ImagingStudy",
  DocumentReference: "文档 · DocumentReference",
  Observation: "观察记录 · Observation",
  Patient: "主索引 · Patient",
};

const NIVEAU: Record<string, string> = {
  "1": "一级",
  "2": "二级",
  "3": "三级",
  "4": "四级",
};

const CATEGORY: Record<string, string> = {
  GENERAL: "一般数据",
  IMPORTANT: "重要数据",
  SENSITIVE: "敏感数据",
  MEDICAL: "医疗数据",
  // 后端把「影像」类自由文本归一成 IMAGING（catalog.service.normalizeClassification）。
  IMAGING: "影像数据",
};

/**
 * 数据源/类型摘要。判定顺序：数据服务 → CDM → 声明的 FHIR 资源 → 文件类 → 未声明。
 *
 * 关键约束（spec「目录浏览数据源摘要口径一致」）：只要有可识别声明，任一表面都不得报
 * 「未声明」；ImagingStudy 这类 FHIR 资源必须能和文件/CDM 区分开。
 */
export function catalogDataSourceSummary(
  product: CatalogBrowseProduct,
): CatalogDataSourceSummary {
  if (product.productType === "service") {
    const statistic = product.serviceSpec?.statistic?.trim();
    return {
      kind: "service",
      text: statistic ? `数据服务 · ${statistic}` : "数据服务",
    };
  }

  const schema = (product.fhirSchema ?? {}) as {
    dataSource?: {
      type?: unknown;
      path?: unknown;
      label?: unknown;
      schema?: unknown;
    } | null;
    dataPath?: unknown;
    localDataPath?: unknown;
    resourceType?: unknown;
  };
  const ds = schema.dataSource ?? undefined;

  if (ds?.type === "omop-cdm") {
    const label = typeof ds.label === "string" && ds.label ? ds.label : "未标注 label";
    return { kind: "omop-cdm", text: `OMOP CDM · ${label}` };
  }

  if (typeof schema.resourceType === "string" && schema.resourceType) {
    const hint = RESOURCE_HINTS[schema.resourceType];
    return {
      kind: "fhir-resource",
      text: hint ?? `FHIR 资源 · ${schema.resourceType}`,
    };
  }

  if (ds?.type === "series-file") {
    const path = typeof ds.path === "string" && ds.path ? ds.path : "未标注路径";
    const format = typeof ds.schema === "string" && ds.schema ? ` · ${ds.schema}` : "";
    return { kind: "series-file", text: `时序文件 · ${path}${format}` };
  }

  if (ds?.type === "file") {
    const path = typeof ds.path === "string" && ds.path ? ds.path : "未标注路径";
    return { kind: "file", text: `本地文件 · ${path}` };
  }

  const legacy =
    (typeof schema.dataPath === "string" && schema.dataPath) ||
    (typeof schema.localDataPath === "string" && schema.localDataPath) ||
    "";
  if (legacy) return { kind: "file", text: `本地路径 · ${legacy}` };

  return { kind: "undeclared", text: "未声明数据源" };
}

/** 分级：结构化标签优先（`二级 · 重要数据`），无标签回退自由文本，两者都无返回 null。 */
export function catalogClassificationLabel(
  product: CatalogBrowseProduct,
): string | null {
  const tag = product.classificationTag;
  if (tag && (tag.level || tag.categoryCode)) {
    const level = tag.level ? (NIVEAU[String(tag.level)] ?? `L${tag.level}`) : "";
    const category = tag.categoryCode ? (CATEGORY[tag.categoryCode] ?? tag.categoryCode) : "";
    const text = [level, category].filter(Boolean).join(" · ");
    if (text) return text;
  }
  const free = product.classification?.trim();
  return free ? free : null;
}

/**
 * 规模：服务看容量、CDM 有人数数量级时看人数、其它看行数。
 * 单位必须可区分 —— 行数不得标成「人」，服务不得拿 recordCount 冒充行数。
 */
export function catalogScaleLabel(product: CatalogBrowseProduct): string {
  if (product.productType === "service") {
    return `容量 ${product.serviceCapacity ?? 0}`;
  }
  if (product.coverage) {
    const persons = cdmPersonScale(product.coverage as CdmCoverage);
    if (persons !== "—") return persons;
  }
  return `${(product.recordCount ?? 0).toLocaleString()} 行`;
}

const STATUS_LABELS: Record<string, string> = {
  active: "在架",
  archived: "已下架",
  draft: "草稿（未上架）",
};

/** 产品状态可读标签；未知码原样返回，不假装认识。 */
export function catalogStatusLabel(status?: string | null): string {
  if (!status) return "—";
  return STATUS_LABELS[status] ?? status;
}

const SCOPE_LABELS: Record<string, string> = {
  internal: "本空间",
  regional: "跨空间（对外在架）",
};

/** 上架范围可读标签。 */
export function catalogListingScopeLabel(scope?: string | null): string {
  const value = scope ?? "internal";
  return SCOPE_LABELS[value] ?? value;
}

/**
 * 提供方显示名：控制面附带登记名 → 演示名表（仅兜底）→ `providerId`。
 * 绝不因为解析不到而隐藏行/页。
 */
export function catalogProviderName(
  product: CatalogBrowseProduct,
  resolveFallback?: (providerId: string) => string | undefined,
): string {
  const fromApi = product.providerDisplayName?.trim();
  if (fromApi) return fromApi;
  const fromFallback = resolveFallback?.(product.providerId)?.trim();
  if (fromFallback) return fromFallback;
  const demo = participantLabel(product.providerId);
  return demo || product.providerId;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 列表主列的次要标识：UUID 只留可读短 id（`#xxxxxxxx`），其余短 id 原样。
 * 完整 id/urn 由详情页负责核对。
 */
export function catalogIdHint(id: string | undefined | null): string | null {
  const value = id?.trim();
  if (!value) return null;
  if (UUID_RE.test(value)) return `#${value.slice(0, 8)}`;
  return value.length > 28 ? `${value.slice(0, 28)}…` : value;
}

/** DESIGN §6：日期显示为本地 `YYYY-MM-DD HH:mm`。 */
export function formatCatalogTime(
  iso: string | null | undefined,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 详情「字段契约」行（供 DataGrid 消费）。 */
export function catalogFieldRows(
  product: CatalogBrowseProduct,
): Array<{ name: string; type: string; description: string }> {
  const fields = (product.fhirSchema as { fields?: unknown } | null)?.fields;
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object")
    .map((f) => ({
      name: typeof f.name === "string" ? f.name : "—",
      type: typeof f.type === "string" ? f.type : "—",
      description: typeof f.description === "string" ? f.description : "—",
    }));
}
