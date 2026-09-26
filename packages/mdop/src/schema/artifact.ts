import { FLOW_LABELS, type FlowLabel } from "../label/lattice";
import { type Sm2Signature } from "../crypto/sm2";
import {
  SchemaError,
  asObject,
  checkKeys,
  reqArray,
  reqObject,
  reqString,
  reqTimestamp,
} from "./strict";

/**
 * 制品句柄与回执（协议 §9.1、§10.3 / 规格「制品句柄」「审计回执链」）。
 *
 * 句柄**不含数据**；只有 C3 句柄可以填 `stats`，其它等级的 `stats` MUST 为空。
 */

export interface ArtifactProducer {
  stage: string;
  op: string;
  op_digest: string;
}

export interface ArtifactHandle {
  handle: string;
  label: FlowLabel;
  schema: string;
  digest: string;
  producer: ArtifactProducer;
  ticket_id: string;
  expires_at: string;
  stats: Record<string, unknown> | null;
}

export function parseArtifactHandle(input: unknown): ArtifactHandle {
  const obj = asObject(input, "handle");
  checkKeys(obj, "handle", {
    required: [
      "handle",
      "label",
      "schema",
      "digest",
      "producer",
      "ticket_id",
      "expires_at",
      "stats",
    ],
  });
  const handle = reqString(obj, "handle", "handle");
  if (!handle.startsWith("art://")) throw new SchemaError("handle.handle", "句柄必须是 art:// 形式");
  const label = reqString(obj, "label", "handle");
  if (!(FLOW_LABELS as readonly string[]).includes(label))
    throw new SchemaError("handle.label", `流动等级非法：${label}`);
  const digest = reqString(obj, "digest", "handle");
  if (!/^sm3:[0-9a-f]{64}$/.test(digest))
    throw new SchemaError("handle.digest", "必须是 sm3:<64hex>");
  const producerPath = "handle.producer";
  const producer = reqObject(obj, "producer", "handle");
  checkKeys(producer, producerPath, { required: ["stage", "op", "op_digest"] });
  const stats = obj.stats === undefined ? null : obj.stats;
  if (stats !== null && (typeof stats !== "object" || Array.isArray(stats)))
    throw new SchemaError("handle.stats", "必须是对象或 null");
  const nonEmptyStats = stats !== null && Object.keys(stats as object).length > 0;
  if (nonEmptyStats && label !== "C3")
    throw new SchemaError("handle.stats", "只有 C3 句柄可以填写 stats");
  return {
    handle,
    label: label as FlowLabel,
    schema: reqString(obj, "schema", "handle"),
    digest,
    producer: {
      stage: reqString(producer, "stage", producerPath),
      op: reqString(producer, "op", producerPath),
      op_digest: reqString(producer, "op_digest", producerPath),
    },
    ticket_id: reqString(obj, "ticket_id", "handle"),
    expires_at: reqTimestamp(obj, "expires_at", "handle"),
    stats: stats === null ? null : (stats as Record<string, unknown>),
  };
}

export const AUDIT_EVENTS = [
  "FRAGMENT_ACCEPTED",
  "FRAGMENT_REJECTED",
  "STAGE_STARTED",
  "STAGE_SUCCEEDED",
  "STAGE_FAILED",
  "ARTIFACT_PURGED",
  /** 持有方核验了节点上报的**会话见证**（证明 + KMS 释放凭据）：通过。 */
  "WITNESS_VERIFIED",
  /** 同上的**拒绝**分支：留痕比静默丢弃重要（至少一次投递会重发）。 */
  "WITNESS_REJECTED",
  /**
   * 节点侧四类事件（任务 3.9）：解封 / 执行 / 出口 / 销毁。
   *
   * 用**同一套回执对象**（而不是另立一种）：平台已有的回执链接收、连续性校验与链头锚定
   * 都是按「节点 + 作业」这条链做的，节点直接发 `AuditReceipt` 就能被同一条通道核验与锚定，
   * 不额外造协议面（否则「同一件事两处实现」会立刻长出来）。
   */
  "UNSEALED",
  "EXECUTED",
  "EXITED",
  "PURGED",
] as const;
export type AuditEvent = (typeof AUDIT_EVENTS)[number];

export interface AuditReceipt {
  receipt_id: string;
  job_id: string;
  stage: string;
  event: AuditEvent;
  input_digests: string[];
  op_digest: string;
  output_digest: string | null;
  label: FlowLabel | null;
  prev_receipt_hash: string | null;
  signer: string;
  at: string;
  /**
   * 可选：本次事件的执行环境证明摘要（节点侧解封/执行两类必带）。
   * 有了它，「在什么代码下处理过这份数据」可以**只凭这条链**事后核验。
   */
  attestation?: { quote_digest: string; measurement: string; tcb: string | null };
  /** 可选：事件细节（句柄、目标、密钥摘要等）。**不放进载荷内容**，只放标识与摘要。 */
  detail?: Record<string, unknown>;
  sig: Sm2Signature;
}

export function parseAuditReceipt(input: unknown): AuditReceipt {
  const obj = asObject(input, "auditReceipt");
  checkKeys(obj, "auditReceipt", {
    required: [
      "receipt_id",
      "job_id",
      "stage",
      "event",
      "input_digests",
      "op_digest",
      "output_digest",
      "label",
      "prev_receipt_hash",
      "signer",
      "at",
      "sig",
    ],
    optional: ["attestation", "detail"],
  });
  const event = reqString(obj, "event", "auditReceipt");
  if (!(AUDIT_EVENTS as readonly string[]).includes(event))
    throw new SchemaError("auditReceipt.event", `未知事件 ${event}`);
  const label = obj.label;
  if (label !== null && (typeof label !== "string" || !(FLOW_LABELS as readonly string[]).includes(label)))
    throw new SchemaError("auditReceipt.label", "流动等级非法");
  const outputDigest = obj.output_digest;
  if (outputDigest !== null && (typeof outputDigest !== "string" || !/^sm3:[0-9a-f]{64}$/.test(outputDigest)))
    throw new SchemaError("auditReceipt.output_digest", "必须是 sm3:<64hex> 或 null");
  const prev = obj.prev_receipt_hash;
  if (prev !== null && (typeof prev !== "string" || !/^sm3:[0-9a-f]{64}$/.test(prev)))
    throw new SchemaError("auditReceipt.prev_receipt_hash", "必须是 sm3:<64hex> 或 null");
  const sig = reqObject(obj, "sig", "auditReceipt");
  checkKeys(sig, "auditReceipt.sig", { required: ["alg", "kid", "value"] });
  const attestation = obj.attestation;
  if (attestation !== undefined) {
    const att = asObject(attestation, "auditReceipt.attestation");
    checkKeys(att, "auditReceipt.attestation", { required: ["quote_digest", "measurement", "tcb"] });
  }
  const detail = obj.detail;
  if (detail !== undefined && (typeof detail !== "object" || detail === null || Array.isArray(detail)))
    throw new SchemaError("auditReceipt.detail", "必须是对象");

  return {
    receipt_id: reqString(obj, "receipt_id", "auditReceipt"),
    job_id: reqString(obj, "job_id", "auditReceipt"),
    stage: reqString(obj, "stage", "auditReceipt"),
    event: event as AuditEvent,
    input_digests: reqArray(obj, "input_digests", "auditReceipt").map((item, i) => {
      if (typeof item !== "string" || !/^sm3:[0-9a-f]{64}$/.test(item))
        throw new SchemaError(`auditReceipt.input_digests[${i}]`, "必须是 sm3:<64hex>");
      return item as string;
    }),
    op_digest: reqString(obj, "op_digest", "auditReceipt"),
    output_digest: (outputDigest as string | null) ?? null,
    label: (label as FlowLabel | null) ?? null,
    prev_receipt_hash: (prev as string | null) ?? null,
    signer: reqString(obj, "signer", "auditReceipt"),
    at: reqTimestamp(obj, "at", "auditReceipt"),
    ...(attestation !== undefined
      ? {
          attestation: {
            quote_digest: reqString(attestation as never, "quote_digest", "auditReceipt.attestation"),
            measurement: reqString(attestation as never, "measurement", "auditReceipt.attestation"),
            tcb: (asObject(attestation, "auditReceipt.attestation").tcb ?? null) as string | null,
          },
        }
      : {}),
    ...(detail !== undefined ? { detail: detail as Record<string, unknown> } : {}),
    sig: {
      alg: reqString(sig, "alg", "auditReceipt.sig"),
      kid: reqString(sig, "kid", "auditReceipt.sig"),
      value: reqString(sig, "value", "auditReceipt.sig"),
    },
  };
}

export const PURGE_REASONS = ["purge-order", "ttl"] as const;
export type PurgeReason = (typeof PURGE_REASONS)[number];

export interface PurgeReceipt {
  receipt_id: string;
  job_id: string;
  node: string;
  reason: PurgeReason;
  handles: string[];
  destroyed_at: string;
  idempotency_key: string;
  sig: Sm2Signature;
}

export function parsePurgeReceipt(input: unknown): PurgeReceipt {
  const obj = asObject(input, "purgeReceipt");
  checkKeys(obj, "purgeReceipt", {
    required: [
      "receipt_id",
      "job_id",
      "node",
      "reason",
      "handles",
      "destroyed_at",
      "idempotency_key",
      "sig",
    ],
  });
  const reason = reqString(obj, "reason", "purgeReceipt");
  if (!(PURGE_REASONS as readonly string[]).includes(reason))
    throw new SchemaError("purgeReceipt.reason", `未知销毁原因 ${reason}`);
  const sig = reqObject(obj, "sig", "purgeReceipt");
  checkKeys(sig, "purgeReceipt.sig", { required: ["alg", "kid", "value"] });
  return {
    receipt_id: reqString(obj, "receipt_id", "purgeReceipt"),
    job_id: reqString(obj, "job_id", "purgeReceipt"),
    node: reqString(obj, "node", "purgeReceipt"),
    reason: reason as PurgeReason,
    handles: reqArray(obj, "handles", "purgeReceipt").map((item, i) => {
      if (typeof item !== "string" || item.length === 0)
        throw new SchemaError(`purgeReceipt.handles[${i}]`, "必须是句柄字符串");
      return item as string;
    }),
    destroyed_at: reqTimestamp(obj, "destroyed_at", "purgeReceipt"),
    idempotency_key: reqString(obj, "idempotency_key", "purgeReceipt"),
    sig: {
      alg: reqString(sig, "alg", "purgeReceipt.sig"),
      kid: reqString(sig, "kid", "purgeReceipt.sig"),
      value: reqString(sig, "value", "purgeReceipt.sig"),
    },
  };
}

/** 回执链头的可选锚定记录（无伪造交易号：未锚即 `pending`）。 */
export interface AnchorRecord {
  node: string;
  chain_head: string;
  anchored_at?: string;
  tx_id?: string;
  status: "pending" | "anchored";
}

export function parseAnchorRecord(input: unknown): AnchorRecord {
  const obj = asObject(input, "anchorRecord");
  checkKeys(obj, "anchorRecord", {
    required: ["node", "chain_head", "status"],
    optional: ["anchored_at", "tx_id"],
  });
  const status = reqString(obj, "status", "anchorRecord");
  if (status !== "pending" && status !== "anchored")
    throw new SchemaError("anchorRecord.status", `未知状态 ${status}`);
  const chainHead = reqString(obj, "chain_head", "anchorRecord");
  if (!/^sm3:[0-9a-f]{64}$/.test(chainHead))
    throw new SchemaError("anchorRecord.chain_head", "必须是 sm3:<64hex>");
  if (status === "anchored" && typeof obj.tx_id !== "string")
    throw new SchemaError("anchorRecord.tx_id", "已锚定必须带交易号");
  return {
    node: reqString(obj, "node", "anchorRecord"),
    chain_head: chainHead,
    status: status as AnchorRecord["status"],
    ...(typeof obj.anchored_at === "string" ? { anchored_at: obj.anchored_at } : {}),
    ...(typeof obj.tx_id === "string" ? { tx_id: obj.tx_id } : {}),
  };
}
