import { BadRequestException } from "@nestjs/common";

/** 与演示种子 / 连接器 toView 对齐的字段类型闭集。 */
export const FIELD_TYPES = [
  "string",
  "number",
  "integer",
  "boolean",
  "array",
  "object",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export interface SchemaField {
  name: string;
  type?: FieldType;
  description?: string;
}

/** 表单与目录服务共同维护的 fhirSchema 键；其它键在 update 时保留。 */
export const MANAGED_FHIR_KEYS = [
  "dataSource",
  "localDataPath",
  "dataPath",
  "resourceType",
  "profile",
  "fields",
] as const;

export function assertFieldContract(
  fhirSchema: Record<string, unknown> | null | undefined,
  opts: { productType: "data" | "service"; requireFields: boolean },
): void {
  if (opts.productType === "service") {
    if (fhirSchema != null && Object.keys(fhirSchema).length > 0) {
      // 服务类允许 null；若误传非空 schema 不在此强制清空，由调用方决定。
    }
    return;
  }
  if (!opts.requireFields) return;
  if (!fhirSchema || typeof fhirSchema !== "object") {
    throw new BadRequestException(
      "数据产品必须提供 fhirSchema.fields（字段契约，至少 1 项）",
    );
  }
  const raw = fhirSchema.fields;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BadRequestException(
      "数据产品必须提供 fhirSchema.fields（字段契约，至少 1 项）",
    );
  }
  const names = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new BadRequestException(`fhirSchema.fields[${i}] 必须是对象`);
    }
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) {
      throw new BadRequestException(`fhirSchema.fields[${i}].name 不可为空`);
    }
    if (names.has(name)) {
      throw new BadRequestException(`fhirSchema.fields 字段名重复：${name}`);
    }
    names.add(name);
    if (row.type !== undefined) {
      if (typeof row.type !== "string" || !FIELD_TYPES.includes(row.type as FieldType)) {
        throw new BadRequestException(
          `fhirSchema.fields[${i}].type 须为 ${FIELD_TYPES.join("|")}`,
        );
      }
    }
    if (row.description !== undefined && typeof row.description !== "string") {
      throw new BadRequestException(
        `fhirSchema.fields[${i}].description 必须是字符串`,
      );
    }
  }
}

/**
 * 用本次提交的托管键覆盖，保留库内未知键。
 * 写出 dataSource 后去掉 legacy dataPath/localDataPath，避免与 CDM 冲突。
 */
export function mergeFhirSchema(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (incoming === null) return null;
  const base: Record<string, unknown> = { ...(existing ?? {}) };
  for (const key of MANAGED_FHIR_KEYS) {
    delete base[key];
  }
  const next: Record<string, unknown> = { ...base, ...incoming };
  if (next.dataSource != null) {
    delete next.dataPath;
    delete next.localDataPath;
  }
  return next;
}
