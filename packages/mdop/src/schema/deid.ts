import type { FlowLabel } from "../label/lattice";

/**
 * 院内脱敏规格（领域中立）。
 *
 * 这是声明式规格，不承载可执行代码。连接器与 Python agent 各自严格解析，
 * 任何未知算子、越界参数或未覆盖的强制字段都 fail-closed。
 */

export const DEID_SPEC_VERSION = 1 as const;

export const DEID_OPERATORS = [
  "drop",
  "keep",
  "generalize",
  "hmac_pseudonym",
  "date_shift",
  "text_rules",
  "bucketize",
  "truncate",
  "suppress",
] as const;

export type DeidOperator = (typeof DEID_OPERATORS)[number];

export interface DeidTransform {
  field: string;
  op: DeidOperator;
  params?: Record<string, unknown>;
}

export interface DeidSpec {
  version: typeof DEID_SPEC_VERSION;
  id: string;
  scope: { product: string; level: FlowLabel };
  transforms: DeidTransform[];
  quasiIdentifierPolicy?: {
    k: number;
    suppressIfBelow: boolean;
    columns: string[];
  };
  /** 强制字段没有对应变换时，规格无效。 */
  denyIfTransformMissing: string[];
}

export class DeidSpecError extends Error {
  constructor(readonly code: "DEID_SPEC_INVALID" | "DEID_SPEC_UNSUPPORTED", message: string) {
    super(message);
    this.name = "DeidSpecError";
  }
}

const FLOW_LEVELS: FlowLabel[] = ["C0_internal", "C0", "C1", "C2", "C3"];
const MAX_DATE_SHIFT_DAYS = 30;
const MAX_PSEUDONYM_LENGTH = 64;

export function parseDeidSpec(input: unknown): DeidSpec {
  if (!isRecord(input)) invalid("规格必须是对象");
  if (input.version !== DEID_SPEC_VERSION)
    throw new DeidSpecError("DEID_SPEC_UNSUPPORTED", "只支持脱敏规格 version=1");
  const id = nonEmptyString(input.id, "id");
  if (!isRecord(input.scope)) invalid("scope 必须是对象");
  const product = nonEmptyString(input.scope.product, "scope.product");
  const level = input.scope.level;
  if (!FLOW_LEVELS.includes(level as FlowLabel)) invalid("scope.level 非法");

  if (!Array.isArray(input.transforms) || input.transforms.length === 0)
    invalid("transforms 不能为空");
  const transforms = input.transforms.map((item, index) => parseTransform(item, index));
  const fields = new Set<string>();
  for (const transform of transforms) {
    if (fields.has(transform.field)) invalid(`transforms 重复字段：${transform.field}`);
    fields.add(transform.field);
  }

  const denyIfTransformMissing = stringArray(
    input.denyIfTransformMissing,
    "denyIfTransformMissing",
  );
  for (const field of denyIfTransformMissing) {
    if (!fields.has(field)) invalid(`强制字段没有脱敏变换：${field}`);
  }

  let quasiIdentifierPolicy: DeidSpec["quasiIdentifierPolicy"];
  if (input.quasiIdentifierPolicy !== undefined) {
    if (!isRecord(input.quasiIdentifierPolicy)) invalid("quasiIdentifierPolicy 必须是对象");
    const k = input.quasiIdentifierPolicy.k;
    if (!Number.isInteger(k) || (k as number) < 5) invalid("quasiIdentifierPolicy.k 必须 ≥ 5");
    if (typeof input.quasiIdentifierPolicy.suppressIfBelow !== "boolean")
      invalid("quasiIdentifierPolicy.suppressIfBelow 必须是布尔值");
    quasiIdentifierPolicy = {
      k: k as number,
      suppressIfBelow: input.quasiIdentifierPolicy.suppressIfBelow as boolean,
      columns: stringArray(input.quasiIdentifierPolicy.columns, "quasiIdentifierPolicy.columns"),
    };
  }

  return {
    version: DEID_SPEC_VERSION,
    id,
    scope: { product, level: level as FlowLabel },
    transforms,
    ...(quasiIdentifierPolicy ? { quasiIdentifierPolicy } : {}),
    denyIfTransformMissing,
  };
}

function parseTransform(input: unknown, index: number): DeidTransform {
  if (!isRecord(input)) invalid(`transforms[${index}] 必须是对象`);
  const field = nonEmptyString(input.field, `transforms[${index}].field`);
  if (!DEID_OPERATORS.includes(input.op as DeidOperator))
    invalid(`transforms[${index}].op 非法`);
  const op = input.op as DeidOperator;
  const params = input.params === undefined ? undefined : object(input.params, `transforms[${index}].params`);
  validateParams(op, params, index);
  return { field, op, ...(params ? { params } : {}) };
}

function validateParams(op: DeidOperator, params: Record<string, unknown> | undefined, index: number): void {
  const path = `transforms[${index}].params`;
  if (op === "hmac_pseudonym") {
    const saltRef = params?.saltRef;
    const outLen = params?.outLen;
    if (typeof saltRef !== "string" || !saltRef.trim()) invalid(`${path}.saltRef 不能为空`);
    if (!Number.isInteger(outLen) || (outLen as number) < 1 || (outLen as number) > MAX_PSEUDONYM_LENGTH)
      invalid(`${path}.outLen 必须在 1–${MAX_PSEUDONYM_LENGTH} 之间`);
  }
  if (op === "date_shift") {
    const maxDays = params?.maxDays;
    if (!Number.isInteger(maxDays) || (maxDays as number) < 0 || (maxDays as number) > MAX_DATE_SHIFT_DAYS)
      invalid(`${path}.maxDays 必须在 0–${MAX_DATE_SHIFT_DAYS} 之间`);
    if (params?.perSubject !== undefined && typeof params.perSubject !== "boolean")
      invalid(`${path}.perSubject 必须是布尔值`);
  }
  if (op === "text_rules") {
    const rules = params?.rules;
    if (!Array.isArray(rules) || rules.length === 0 || rules.some((rule) => typeof rule !== "string" || !rule.trim()))
      invalid(`${path}.rules 不能为空`);
    if (params?.dictionaryRef !== undefined && typeof params.dictionaryRef !== "string")
      invalid(`${path}.dictionaryRef 必须是字符串`);
  }
  if (op === "truncate" || op === "bucketize") {
    if (!params || Object.keys(params).length === 0) invalid(`${path} 不能为空`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(`${path} 必须是对象`);
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(`${path} 不能为空`);
  return value.trim();
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim()))
    invalid(`${path} 必须是非空字符串数组`);
  return [...new Set((value as string[]).map((item) => item.trim()))];
}

function invalid(message: string): never {
  throw new DeidSpecError("DEID_SPEC_INVALID", message);
}
