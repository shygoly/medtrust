/**
 * 极简严格校验器。协议对象的硬要求是「缺少必填字段或出现未定义字段 MUST 被拒绝」
 * （规格「协议对象结构校验」），所以这里默认**拒绝未知字段**，不做「按缺省值补全」。
 *
 * 不引 ajv/zod：本包要被平台与连接器共同依赖，零第三方 schema 运行时更稳。
 */

export class SchemaError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`schema ${path}: ${message}`);
    this.name = "SchemaError";
    this.path = path;
  }
}

const bail = (path: string, message: string): never => {
  throw new SchemaError(path, message);
};

export function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return bail(path, "期望对象");
  return value as Record<string, unknown>;
}

export function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return bail(path, "期望数组");
  return value;
}

/** 未知字段即拒；缺必填字段即拒。 */
export function checkKeys(
  obj: Record<string, unknown>,
  path: string,
  spec: { required?: readonly string[]; optional?: readonly string[] },
): void {
  const required = spec.required ?? [];
  const allowed = new Set([...required, ...(spec.optional ?? [])]);
  for (const key of Object.keys(obj)) if (!allowed.has(key)) bail(path, `未定义字段 ${key}`);
  for (const key of required)
    if (!(key in obj) || obj[key] === undefined) bail(path, `缺少必填字段 ${key}`);
}

export function reqString(obj: Record<string, unknown>, key: string, path: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) bail(path, `字段 ${key} 必须是非空字符串`);
  return value as string;
}

/**
 * 允许空串的字符串字段。用于**语义上可以无值**的必填字段，例如信封的 `job_id`：
 * 合约协商、能力通告等消息不属于任何作业，此时 `job_id` 是空串而不是缺失。
 */
export function reqStringAllowEmpty(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const value = obj[key];
  if (typeof value !== "string") bail(path, `字段 ${key} 必须是字符串`);
  return value as string;
}

export function optString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") bail(path, `字段 ${key} 必须是字符串`);
  return value as string;
}

export function reqNumber(obj: Record<string, unknown>, key: string, path: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value))
    bail(path, `字段 ${key} 必须是有限数字`);
  return value as number;
}

export function optNumber(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): number | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    bail(path, `字段 ${key} 必须是有限数字`);
  return value as number;
}

export function reqBoolean(obj: Record<string, unknown>, key: string, path: string): boolean {
  const value = obj[key];
  if (typeof value !== "boolean") bail(path, `字段 ${key} 必须是布尔值`);
  return value as boolean;
}

export function optBoolean(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): boolean | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") bail(path, `字段 ${key} 必须是布尔值`);
  return value as boolean;
}

export function reqArray(obj: Record<string, unknown>, key: string, path: string): unknown[] {
  return asArray(obj[key], `${path}.${key}`);
}

export function optArray(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): unknown[] | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  return asArray(value, `${path}.${key}`);
}

export function reqObject(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): Record<string, unknown> {
  return asObject(obj[key], `${path}.${key}`);
}

export function optObject(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): Record<string, unknown> | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  return asObject(value, `${path}.${key}`);
}

/** 枚举取值校验。 */
export function reqEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly T[],
): T {
  const value = reqString(obj, key, path);
  if (!(allowed as readonly string[]).includes(value))
    bail(path, `字段 ${key} 取值非法：${value}（只许 ${allowed.join(" | ")}）`);
  return value as T;
}

/** `sm3:<64hex>` 摘要字段。 */
export function reqDigest(obj: Record<string, unknown>, key: string, path: string): string {
  const value = reqString(obj, key, path);
  if (!/^sm3:[0-9a-f]{64}$/.test(value)) bail(path, `字段 ${key} 必须是 sm3:<64hex>`);
  return value;
}

/** RFC3339 时间戳字段。 */
export function reqTimestamp(obj: Record<string, unknown>, key: string, path: string): string {
  const value = reqString(obj, key, path);
  if (Number.isNaN(Date.parse(value))) bail(path, `字段 ${key} 必须是 RFC3339 时间戳`);
  return value;
}

/** 结构化读取一个"字符串数组"字段。 */
export function reqStringArray(obj: Record<string, unknown>, key: string, path: string): string[] {
  return reqArray(obj, key, path).map((item, i) => {
    if (typeof item !== "string" || item.length === 0)
      bail(`${path}.${key}[${i}]`, "必须是非空字符串");
    return item as string;
  });
}

export function optStringArray(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): string[] | undefined {
  if (obj[key] === undefined || obj[key] === null) return undefined;
  return reqStringArray(obj, key, path);
}
