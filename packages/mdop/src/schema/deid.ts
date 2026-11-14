import type { FlowLabel } from "../label/lattice";

/**
 * 院内脱敏规格（领域中立）。
 *
 * 这是声明式规格，不承载可执行代码。连接器与 Python agent 各自严格解析，
 * 任何未知算子、越界参数或未覆盖的强制字段都 fail-closed。
 */

export const DEID_SPEC_VERSION = 1 as const;

/**
 * 脱敏规格的**签名载荷前缀**（P-CTL-6「专用算法签名密钥」= 注册中心用途密钥）。
 *
 * 平台签发（`apps/api`）与连接器验签（`apps/connector`）共用这一份口径：
 * 改前缀即改两边验签结果，因此只能在这里改。
 * 与 `medtrust.algorithm-module.v1:` 同构但**用途隔离**——模块签名不能顶替规格签名。
 */
export const DEID_SPEC_SIGNATURE_PAYLOAD_PREFIX = "medtrust.deid-spec.v1:";

export function deidSpecSignaturePayload(sm3: string): string {
  return `${DEID_SPEC_SIGNATURE_PAYLOAD_PREFIX}${sm3.toLowerCase()}`;
}

/**
 * 自由文本词表清单的**签名载荷前缀**（同 registry 用途密钥，用途隔离于规格与模块）。
 *
 * 词表**内容留在数据持有方**（与盐同向）：平台签的是「这份摘要就是我审查过的第 N 版」，
 * 不是把姓名表搬上平台。agent 只按 ref 读持有方本地文件并核对摘要。
 */
export const DEID_DICTIONARY_SIGNATURE_PAYLOAD_PREFIX = "medtrust.deid-dictionary.v1:";

export function deidDictionarySignaturePayload(sm3: string): string {
  return `${DEID_DICTIONARY_SIGNATURE_PAYLOAD_PREFIX}${sm3.toLowerCase()}`;
}

/** `dictionaryRef` = `<dictionaryId>:v<version>`（例：`deid:cn-names:v2`）。 */
export const DICTIONARY_REF_PATTERN = /^(.+):v(\d{1,6})$/;
const DICTIONARY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*(:[a-z0-9][a-z0-9._-]*)*$/;

export interface DeidDictionaryRef {
  ref: string;
  dictionaryId: string;
  version: number;
}

export function parseDeidDictionaryRef(input: unknown): DeidDictionaryRef {
  if (typeof input !== "string" || !input.trim())
    throw new DeidSpecError("DEID_SPEC_INVALID", "dictionaryRef 不能为空");
  const ref = input.trim();
  const match = DICTIONARY_REF_PATTERN.exec(ref);
  if (!match)
    throw new DeidSpecError(
      "DEID_SPEC_INVALID",
      `dictionaryRef 必须形如 <dictionaryId>:v<version>（收到 ${ref}）`,
    );
  const dictionaryId = match[1];
  const version = Number(match[2]);
  if (!DICTIONARY_ID_PATTERN.test(dictionaryId))
    throw new DeidSpecError("DEID_SPEC_INVALID", `dictionaryRef 的 id 非法：${dictionaryId}`);
  if (!Number.isInteger(version) || version < 1)
    throw new DeidSpecError("DEID_SPEC_INVALID", `dictionaryRef 的版本必须 ≥1（收到 ${match[2]}）`);
  return { ref, dictionaryId, version };
}

/** 平台签发的词表清单（只含摘要与版本，不含词表内容）。 */
export interface DeidDictionaryManifest {
  dictionaryId: string;
  version: number;
  /** 词表文件的 SM3（64 hex 小写）——持有方本地那份文件必须 hash 到它。 */
  sm3: string;
  byteSize: number;
  keyId: string;
  issuedAt: string;
  notAfter: string;
  signature: string;
  /** `medtrust.deid-dictionary.v1:<sm3>`。 */
  signaturePayload: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
export const MAX_DICTIONARY_BYTES = 32 * 1024 * 1024;

export function parseDeidDictionaryManifest(input: unknown): DeidDictionaryManifest {
  if (!isRecord(input)) invalid("词表清单必须是对象");
  const dictionaryId = nonEmptyString(input.dictionaryId, "dictionaryId");
  if (!DICTIONARY_ID_PATTERN.test(dictionaryId))
    invalid(`dictionaryId 非法：${dictionaryId}`);
  const version = input.version;
  if (!Number.isInteger(version) || (version as number) < 1)
    invalid("词表清单 version 必须是 ≥1 的整数");
  const sm3 = nonEmptyString(input.sm3, "sm3").toLowerCase();
  if (!HEX64.test(sm3)) invalid("词表清单 sm3 必须是 64 hex");
  const byteSize = input.byteSize;
  if (
    !Number.isInteger(byteSize) ||
    (byteSize as number) <= 0 ||
    (byteSize as number) > MAX_DICTIONARY_BYTES
  )
    invalid(`词表清单 byteSize 必须在 1–${MAX_DICTIONARY_BYTES} 之间`);
  const signature = nonEmptyString(input.signature, "signature");
  const keyId = nonEmptyString(input.keyId, "keyId");
  const issuedAt = nonEmptyString(input.issuedAt, "issuedAt");
  const notAfter = nonEmptyString(input.notAfter, "notAfter");
  if (!Number.isFinite(Date.parse(issuedAt)) || !Number.isFinite(Date.parse(notAfter)))
    invalid("词表清单 issuedAt/notAfter 必须是 ISO 时间");
  // 载荷口径**原样返回**，由调用方（连接器）比对并给出专门错误码：
  // 「形状坏」与「口径漂移」在审计里是两件事，不能混成一个 DEID_SPEC_INVALID。
  const canonicalPayload = deidDictionarySignaturePayload(sm3);
  if (input.signaturePayload !== undefined && typeof input.signaturePayload !== "string")
    invalid("signaturePayload 必须是字符串");
  const signaturePayload =
    typeof input.signaturePayload === "string" ? input.signaturePayload : canonicalPayload;
  return {
    dictionaryId,
    version: version as number,
    sm3,
    byteSize: byteSize as number,
    keyId,
    issuedAt,
    notAfter,
    signature,
    signaturePayload,
  };
}

export function dictionaryManifestRef(manifest: {
  dictionaryId: string;
  version: number;
}): string {
  return `${manifest.dictionaryId}:v${manifest.version}`;
}

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
    // `person_name` 靠词表，不靠正则：没有版本化词表就没法保证"同一个名字在哪一版被替换"，
    // 因此带 person_name 的规格必须给出可解析的 dictionaryRef。
    if (params?.dictionaryRef !== undefined) parseDeidDictionaryRef(params.dictionaryRef);
    if ((rules as string[]).includes("person_name") && params?.dictionaryRef === undefined)
      invalid(`${path}.dictionaryRef 必填：person_name 规则必须绑定版本化词表`);
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
