import { canonicalize, withoutSignature } from "./canonical/jcs";
import { sm3Hex } from "./crypto/sm3";
import {
  SM2_ALGORITHM,
  SM2_LEGACY_ALGORITHM,
  publicKeyKid,
  sm2Sign,
  sm2Verify,
} from "./crypto/sm2";
import { MdopError } from "./errors";
import {
  SchemaError,
  asObject,
  checkKeys,
  reqObject,
  reqString,
  reqStringAllowEmpty,
  reqTimestamp,
} from "./schema/strict";

/**
 * MDOP 统一信封（协议 §7.1 / 规格「MDOP 消息信封」）。
 *
 * 签名内容 = 去掉 `sig` 的信封经 JCS 规范化后的 SM3 摘要。
 * 接收方四步校验：签名 → 收件人 → 时间窗 ±5 分钟 → nonce 10 分钟内未见过。
 */

export const MDOP_PROTOCOL_VERSION = "0.2" as const;
export const ENVELOPE_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const NONCE_TTL_MS = 10 * 60 * 1000;

export const MDOP_MESSAGE_TYPES = [
  "CapabilityAdvertise",
  "CatalogPublish",
  "Heartbeat",
  "RevocationSync",
  "ContractOffer",
  "ContractAgree",
  /** 平台副署回执：把平台副署送回该院连接器，本地副本才生效（D-MDOP-4）。 */
  "ContractAgreeAck",
  "ContractTerminate",
  "JobSubmit",
  "JobCompiled",
  "PlanFragmentOffer",
  "PlanFragmentAccept",
  "PlanFragmentReject",
  "ExecutionTicketIssue",
  "StageDispatch",
  "StageStatus",
  "ArtifactReady",
  "ResultDeliver",
  "JobAbort",
  "PurgeOrder",
  "PurgeReceipt",
  "AuditReceipt",
  /** 节点 → 平台：本次会话的证明与 KMS 释放凭据（供持有方独立核验，D13）。 */
  "AttestationReport",
  /** 平台 → 持有方：把同一份见证转给该作业的持有方，让它们**自己验**（不采信平台的结论）。 */
  "AttestationWitness",
  /**
   * 平台 → 可信空间节点：把持有方签好的 **C2 数据信封**（密文 + 密钥封套）中继给目标节点。
   *
   * 平台在链路上**只转运不解密**：数据密钥封给节点本次会话的一次性公钥，平台没有那把私钥。
   */
  "C2EnvelopeRelay",
  /** 数据持有方 → 平台：提交待中继的 C2 数据信封（数据面；平台只转运不解密）。 */
  "C2EnvelopeSubmit",
] as const;

export type MdopMessageType = (typeof MDOP_MESSAGE_TYPES)[number];

export interface EnvelopeSignature {
  alg: string;
  kid: string;
  value: string;
}

export interface Envelope<TBody = Record<string, unknown>> {
  mdop: string;
  msg_id: string;
  msg_type: MdopMessageType;
  job_id: string;
  sender: string;
  receiver: string;
  timestamp: string;
  nonce: string;
  idempotency_key: string;
  body: TBody;
  sig: EnvelopeSignature;
}

export type UnsignedEnvelope<TBody = Record<string, unknown>> = Omit<Envelope<TBody>, "sig">;

/** URN 形式的参与方标识：`urn:tds:<space>:participant:<id>`（D-MDOP-1，与 D11 URN 体系一致）。 */
export function participantUrn(space: string, id: string): string {
  return `urn:tds:${space}:participant:${id}`;
}

/** 解析参与方 URN；不是 URN 形态时返回 undefined（调用方自行决定是否回退）。 */
export function parseParticipantUrn(
  urn: string,
): { space: string; id: string } | undefined {
  const match = /^urn:tds:([^:]+):participant:(.+)$/.exec(urn ?? "");
  return match ? { space: match[1], id: match[2] } : undefined;
}

export function parseEnvelope(input: unknown): UnsignedEnvelope {
  const obj = asObject(input, "envelope");
  checkKeys(obj, "envelope", {
    required: [
      "mdop",
      "msg_id",
      "msg_type",
      "job_id",
      "sender",
      "receiver",
      "timestamp",
      "nonce",
      "idempotency_key",
      "body",
      "sig",
    ],
  });
  const mdop = reqString(obj, "mdop", "envelope");
  if (!/^\d+\.\d+$/.test(mdop)) throw new SchemaError("envelope.mdop", "版本号形状非法");
  const msgType = reqString(obj, "msg_type", "envelope");
  if (!(MDOP_MESSAGE_TYPES as readonly string[]).includes(msgType))
    throw new SchemaError("envelope.msg_type", `未知消息类型 ${msgType}`);
  const sig = reqObject(obj, "sig", "envelope");
  checkKeys(sig, "envelope.sig", { required: ["alg", "kid", "value"] });
  return {
    mdop,
    msg_id: reqString(obj, "msg_id", "envelope"),
    msg_type: msgType as MdopMessageType,
    // 合约协商 / 能力通告等消息不属于任何作业 → 允许空串（但仍必须是字符串）
    job_id: reqStringAllowEmpty(obj, "job_id", "envelope"),
    sender: reqString(obj, "sender", "envelope"),
    receiver: reqString(obj, "receiver", "envelope"),
    timestamp: reqTimestamp(obj, "timestamp", "envelope"),
    nonce: reqString(obj, "nonce", "envelope"),
    idempotency_key: reqString(obj, "idempotency_key", "envelope"),
    body: reqObject(obj, "body", "envelope"),
  };
}

export function parseEnvelopeSignature(input: unknown): EnvelopeSignature {
  const obj = asObject(input, "envelope.sig");
  checkKeys(obj, "envelope.sig", { required: ["alg", "kid", "value"] });
  return {
    alg: reqString(obj, "alg", "envelope.sig"),
    kid: reqString(obj, "kid", "envelope.sig"),
    value: reqString(obj, "value", "envelope.sig"),
  };
}

/** 信封的签名内容：`SM3(JCS(去掉 sig 的信封))`，摘要字节作为 SM2 的消息。 */
export function envelopeSigningDigest(envelope: UnsignedEnvelope): Uint8Array {
  return Buffer.from(sm3Hex(canonicalize(withoutSignature(envelope as never))), "hex");
}

export function signEnvelope<TBody extends Record<string, unknown>>(
  unsigned: UnsignedEnvelope<TBody>,
  privateKey: string,
  options: { publicKey?: string; userId?: string } = {},
): Envelope<TBody> {
  const digest = envelopeSigningDigest(unsigned);
  const publicKey = options.publicKey;
  const kid = publicKey ? publicKeyKid(publicKey) : undefined;
  const value = sm2Sign(digest, privateKey, { publicKey, userId: options.userId });
  return {
    ...unsigned,
    sig: { alg: SM2_ALGORITHM, kid: kid ?? "", value },
  };
}

export interface NonceStore {
  /** 该 nonce 是否在保存窗口内出现过（含重启之前）。 */
  seen(nonce: string): boolean;
  /** 落盘保存 nonce，`expiresAt` 之后可清理。 */
  remember(nonce: string, expiresAt: Date): void;
}

export interface VerifyEnvelopeOptions {
  /** 本节点标识：收件人必须是它。 */
  self: string;
  /** 发送方的登记公钥（按 kid 选择由调用方负责，D-MDOP-3 三钥分离）。 */
  senderPublicKey: string;
  nonceStore: NonceStore;
  /** 注入时钟，便于测试；缺省 `new Date()`。 */
  now?: Date;
  /** 时间窗，缺省 ±5 分钟。 */
  clockSkewMs?: number;
  userId?: string;
  /**
   * 是否在校验通过时**立即落盘 nonce**（缺省 true）。
   *
   * 若消息校验通过但业务处理失败（例如临时错误），立即落盘会让重发永远被当成
   * `E_REPLAY` 而卡死。需要「先处理成功再记 nonce」的调用方传 false，
   * 并在处理成功后自行调用 `nonceStore.remember(...)`。
   */
  rememberNonce?: boolean;
}

/**
 * 接收方校验。任一失败抛 `MdopError`：签名/时间窗 `E_AUTH_INVALID`、nonce `E_REPLAY`，
 * 收件人不符同样 `E_AUTH_INVALID`（MUST NOT 执行消息内容）。
 */
export function verifyEnvelope<TBody extends Record<string, unknown>>(
  envelope: Envelope<TBody>,
  options: VerifyEnvelopeOptions,
): Envelope<TBody> {
  const unsigned = parseEnvelope(envelope);
  const sig = parseEnvelopeSignature(envelope.sig);

  if (sig.alg !== SM2_ALGORITHM) {
    // 旧格式（不做 Z_A、原始 r‖s）在线上链路一律拒——否则可被降级攻击。
    throw new MdopError("E_AUTH_INVALID", {}, `算法不是 ${SM2_ALGORITHM}`);
  }
  if (sig.kid !== publicKeyKid(options.senderPublicKey))
    throw new MdopError("E_AUTH_INVALID", {}, "kid 与登记公钥不符");

  const digest = envelopeSigningDigest(unsigned);
  if (!sm2Verify(digest, sig.value, options.senderPublicKey, { userId: options.userId }))
    throw new MdopError("E_AUTH_INVALID", {}, "信封签名无效");

  if (envelope.receiver !== options.self)
    throw new MdopError("E_AUTH_INVALID", {}, "收件人不是本节点");

  const now = options.now ?? new Date();
  const skew = options.clockSkewMs ?? ENVELOPE_CLOCK_SKEW_MS;
  const delta = Math.abs(now.getTime() - Date.parse(envelope.timestamp));
  if (Number.isNaN(delta) || delta > skew)
    throw new MdopError("E_AUTH_INVALID", {}, "时间偏差超出窗口");

  if (options.nonceStore.seen(envelope.nonce)) throw new MdopError("E_REPLAY");
  if (options.rememberNonce !== false)
    options.nonceStore.remember(envelope.nonce, new Date(now.getTime() + NONCE_TTL_MS));

  return envelope;
}

/** 只验签不改 nonce（给同一次校验里需要先看消息类型再落 nonce 的场景，如离线工具）。 */
export function verifyEnvelopeSignatureOnly(
  envelope: Envelope,
  options: { senderPublicKey: string; userId?: string },
): boolean {
  const unsigned = parseEnvelope(envelope);
  const digest = envelopeSigningDigest(unsigned);
  return sm2Verify(digest, envelope.sig.value, options.senderPublicKey, {
    userId: options.userId,
  });
}

export const LEGACY_ALGORITHM_MARKER = SM2_LEGACY_ALGORITHM;

/**
 * 控制面消息夹带制品内容即拒（规格「MDOP 消息经出站通道传输」）。
 * 判据是**结构化**的：body 里出现承载制品载荷的字段名。
 */
export const ARTIFACT_PAYLOAD_KEYS = [
  "payload",
  "rows",
  "records",
  "content",
  "ciphertext",
  "blob",
  "data",
] as const;

export function assertNoInlineArtifact(body: Record<string, unknown>, where = "control-plane"): void {
  const hit = findArtifactPayloadKey(body);
  if (hit) throw new MdopError("E_AUTH_INVALID", {}, `${where} 消息 body 夹带制品内容字段 ${hit}`);
}

function findArtifactPayloadKey(value: unknown, depth = 0): string | undefined {
  if (depth > 6 || typeof value !== "object" || value === null) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findArtifactPayloadKey(item, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((ARTIFACT_PAYLOAD_KEYS as readonly string[]).includes(key)) return key;
    const hit = findArtifactPayloadKey(child, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}
