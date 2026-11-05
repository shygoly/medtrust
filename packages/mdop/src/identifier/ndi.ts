/**
 * NDI 标识映射（NDI-TR-2025-04「统一目录标识」）。
 *
 * **状态：draft-1**。04 正式文本（校验位算法、类型码取值、机构码口径）尚未取得，
 * 因此本模块只提供：① 明确的编码骨架；② 严格校验；③ 版本化入口（`NDI_ID_SCHEME_VERSION`）。
 * 取到正式文本后新增 `v1` 实现并在 `parse` 里按版本分派即可，调用方无需改动。
 *
 * 设计原则：
 * - **内部标识不变**：库里的 `urn:tds:…` 仍是主键与回溯依据；NDI 标识只用于对外报文。
 * - **fail-closed**：机构码缺失、版本未知、校验位不符，一律抛错，不猜默认值、不静默降级。
 * - **确定性**：同一内部对象 → 同一 NDI 标识（序号由 SM3 派生，不依赖调用顺序）。
 */

import { sm3Hex } from "../crypto/sm3";

export const NDI_ID_SCHEME_VERSION = "draft-1" as const;

/** 对象类型码（对应 04 中的资源/产品/连接器/节点等对象；正式文本到位后按表校正）。 */
export const NDI_OBJECT_TYPES = [
  "resource",
  "product",
  "service",
  "connector",
  "business-node",
  "region-node",
  "global-node",
] as const;

export type NdiObjectType = (typeof NDI_OBJECT_TYPES)[number];

const SCHEME_PREFIX = "ndi";
const SEPARATOR = ":";
const ORG_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{1,31}$/;
const SEQ_PATTERN = /^[0-9a-f]{12}$/;
const CHECK_LENGTH = 4;

/** 标识层错误：与 MDOP 协议错误码分开（这不是协议消息，是本地编码/配置错误）。 */
export class NdiIdentifierError extends Error {
  constructor(
    readonly code:
      | "NDI_ORG_CODE_MISSING"
      | "NDI_ORG_CODE_INVALID"
      | "NDI_TYPE_INVALID"
      | "NDI_SEQ_INVALID"
      | "NDI_ID_INVALID"
      | "NDI_SCHEME_UNSUPPORTED",
    message: string,
  ) {
    super(message);
    this.name = "NdiIdentifierError";
  }
}

function canonicalBody(input: {
  type: NdiObjectType;
  orgCode: string;
  seq: string;
}): string {
  return [SCHEME_PREFIX, NDI_ID_SCHEME_VERSION, input.type, input.orgCode, input.seq].join(
    SEPARATOR,
  );
}

function checkOf(body: string): string {
  return sm3Hex(body).slice(0, CHECK_LENGTH).toLowerCase();
}

/**
 * 把内部对象标识确定性地映射成序号。
 *
 * 用 SM3 而非自增：跨进程、跨重启、重复调用都得到同一结果，不需要持久化分配表。
 */
export function sequenceFor(internalId: string): string {
  if (!internalId || typeof internalId !== "string")
    throw new NdiIdentifierError("NDI_SEQ_INVALID", "内部标识不能为空");
  return sm3Hex(internalId).slice(0, 12).toLowerCase();
}

export interface NdiIdInput {
  type: NdiObjectType;
  orgCode: string;
  /** 内部对象标识（URN、uuid 等）；由它派生序号。 */
  internalId: string;
}

/** 生成 NDI 标识。缺失/非法输入一律抛错，不做兜底。 */
export function toNdiId(input: NdiIdInput): string {
  const orgCode = (input.orgCode ?? "").trim();
  if (!orgCode)
    throw new NdiIdentifierError(
      "NDI_ORG_CODE_MISSING",
      "未配置机构码（NDI_ORG_CODE）：不允许生成 NDI 标识",
    );
  if (!ORG_CODE_PATTERN.test(orgCode))
    throw new NdiIdentifierError(
      "NDI_ORG_CODE_INVALID",
      `机构码格式不合法：${orgCode}`,
    );
  if (!NDI_OBJECT_TYPES.includes(input.type))
    throw new NdiIdentifierError("NDI_TYPE_INVALID", `未知对象类型：${String(input.type)}`);
  const seq = sequenceFor(input.internalId);
  const body = canonicalBody({ type: input.type, orgCode, seq });
  return `${body}${SEPARATOR}${checkOf(body)}`;
}

export interface ParsedNdiId {
  scheme: typeof NDI_ID_SCHEME_VERSION;
  type: NdiObjectType;
  orgCode: string;
  seq: string;
  check: string;
}

export function isNdiId(value: unknown): value is string {
  try {
    parseNdiId(value);
    return true;
  } catch {
    return false;
  }
}

/** 严格解析：格式、类型码、机构码、校验位逐项校验；任一不符抛错。 */
export function parseNdiId(value: unknown): ParsedNdiId {
  if (typeof value !== "string" || value.length === 0)
    throw new NdiIdentifierError("NDI_ID_INVALID", "标识必须是非空字符串");
  const parts = value.split(SEPARATOR);
  if (parts.length !== 6)
    throw new NdiIdentifierError("NDI_ID_INVALID", `标识段数不符：${value}`);
  const [prefix, scheme, type, orgCode, seq, check] = parts;
  if (prefix !== SCHEME_PREFIX)
    throw new NdiIdentifierError("NDI_ID_INVALID", `前缀不是 ${SCHEME_PREFIX}：${value}`);
  if (scheme !== NDI_ID_SCHEME_VERSION)
    throw new NdiIdentifierError(
      "NDI_SCHEME_UNSUPPORTED",
      `不支持的标识版本：${scheme}（当前只支持 ${NDI_ID_SCHEME_VERSION}）`,
    );
  if (!NDI_OBJECT_TYPES.includes(type as NdiObjectType))
    throw new NdiIdentifierError("NDI_TYPE_INVALID", `未知对象类型：${type}`);
  if (!ORG_CODE_PATTERN.test(orgCode))
    throw new NdiIdentifierError("NDI_ORG_CODE_INVALID", `机构码格式不合法：${orgCode}`);
  if (!SEQ_PATTERN.test(seq))
    throw new NdiIdentifierError("NDI_SEQ_INVALID", `序号格式不合法：${seq}`);
  const body = canonicalBody({ type: type as NdiObjectType, orgCode, seq });
  const expected = checkOf(body);
  if (check !== expected)
    throw new NdiIdentifierError(
      "NDI_ID_INVALID",
      `校验位不符：期望 ${expected}，实际 ${check}`,
    );
  return { scheme: NDI_ID_SCHEME_VERSION, type: type as NdiObjectType, orgCode, seq, check };
}

export function assertNdiId(value: unknown): string {
  parseNdiId(value);
  return value as string;
}

/**
 * 从内部 URN 映射到 NDI 标识。
 *
 * 只做**显式**映射：调用方必须说明对象类型（`product` 还是 `service`），
 * 不从标题猜、不从数据推断。
 */
export function ndiIdFromInternal(input: {
  internalId: string;
  orgCode: string;
  type: NdiObjectType;
}): string {
  return toNdiId({
    type: input.type,
    orgCode: input.orgCode,
    internalId: input.internalId,
  });
}

/** 读取环境里的机构码；未配置返回空串（由调用方决定是否 fail-closed）。 */
export function ndiOrgCodeFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NDI_ORG_CODE ?? "").trim();
}

/** 方案版本自检：未知版本直接拒绝装配，避免带病运行。 */
export function assertSupportedScheme(env: NodeJS.ProcessEnv = process.env): void {
  const declared = (env.NDI_ID_SCHEME_VERSION ?? NDI_ID_SCHEME_VERSION).trim();
  if (declared !== NDI_ID_SCHEME_VERSION)
    throw new NdiIdentifierError(
      "NDI_SCHEME_UNSUPPORTED",
      `不支持的标识版本：${declared}（当前只支持 ${NDI_ID_SCHEME_VERSION}）`,
    );
}
