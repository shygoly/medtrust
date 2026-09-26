import {
  SM2_ALGORITHM,
  publicKeyKid,
  signCanonicalObject,
  verifyCanonicalObject,
  type Sm2Signature,
} from "../crypto/sm2";
import { MdopError } from "../errors";
import { TEE_KINDS, type TeeKind } from "./provider";
import {
  SchemaError,
  asObject,
  checkKeys,
  optString,
  reqDigest,
  reqObject,
  reqString,
  reqTimestamp,
} from "../schema/strict";

/**
 * **作业之前的证明背书**（部署侧接口，决策 D-TEE-6）。
 *
 * 要解决的问题很具体：编译期放置 C2 要求目标节点有**一份未过期的证明登记**，而登记不能来自
 * 节点自己的会话见证——见证来自一次**作业绑定**的 KMS 密钥释放，作业还没编译就不存在释放。
 * 于是需要一个**作业之前**就成立的证明来源。
 *
 * 本模块给出这一段的共享判据（平台与校验方两侧用同一份实现，避免各写一套）：
 * 校验方（部署白名单内的 KMS / 证明服务）对自己的证明摘要签名，平台用**部署配置里的 KMS 公钥**
 * 验签——平台**仍然不自己验 quote**（§5.1 的分工不变），它只是把「配置白名单内的校验方已验过」
 * 这件事记下来。签名覆盖 `{verifier, endorsement}` 整体，因此换节点、换度量、换有效期都要重签。
 *
 * 与**会话见证**（`attestation/witness.ts`）的分工：
 *  - 背书（本模块）：作业之前、以**节点**为单位、有效期由校验方按部署策略给（分钟～小时级）；
 *  - 见证（witness）：作业之中、以**一次会话的一次密钥释放**为单位，绑定 job/凭证/key_id。
 * 平台两者都收，登记表按 `{node}#{sessionKey ?? quoteDigest}` 分行保留历史。
 */

/** 被背书的证明摘要（作业之前的登记口径；**不含**任何会话或密钥材料）。 */
export interface AttestationEndorsement {
  /** 被背书的节点（参与方 URN）。 */
  node: string;
  /** 证明链型；软件实现**不得**出现在这里（它不是 C2 目标）。 */
  kind: TeeKind;
  /** 被执行代码的度量。 */
  measurement: string;
  /** 可信基版本（按链解释；跨链不可比）。 */
  tcb: string | null;
  /** 原生 quote 的摘要（`sm3:<64hex>`）。 */
  quoteDigest: string;
  /** 校验方完成校验的时刻。 */
  verifiedAt: string;
  /** 这份背书在本平台的**有效期**（由校验方按部署策略给；过期即不可用于放置 C2）。 */
  expiresAt: string;
  /** 可选说明（探针 id、机房等），**不参与任何判定**。 */
  note?: string;
}

/** 校验方推送体：`{verifier, endorsement}` 整体被签名。 */
export interface EndorsementPush {
  /** 校验方标识（必须与部署白名单里的某一项一致）。 */
  verifier: string;
  endorsement: AttestationEndorsement;
  signature: Sm2Signature;
}

/** 被签名/被验签的消息本体（两侧同源：改这里就同时改了两侧）。 */
export function endorsementMessage(input: {
  verifier: string;
  endorsement: AttestationEndorsement;
}): Record<string, unknown> {
  return {
    verifier: input.verifier,
    endorsement: {
      node: input.endorsement.node,
      kind: input.endorsement.kind,
      measurement: input.endorsement.measurement,
      tcb: input.endorsement.tcb,
      quoteDigest: input.endorsement.quoteDigest,
      verifiedAt: input.endorsement.verifiedAt,
      expiresAt: input.endorsement.expiresAt,
    },
  };
}

/** 校验方（KMS / 证明服务）侧：对背书签名。 */
export function signEndorsementPush(input: {
  verifier: string;
  endorsement: AttestationEndorsement;
  privateKey: string;
  publicKey: string;
}): EndorsementPush {
  const message = endorsementMessage(input);
  return {
    verifier: input.verifier,
    endorsement: input.endorsement,
    signature: signCanonicalObject(message, input.privateKey, { publicKey: input.publicKey }),
  };
}

/** 严格解析推送体（未定义字段一律拒——少一个字段就少一道判定）。 */
export function parseEndorsementPush(input: unknown): EndorsementPush {
  const obj = asObject(input, "endorsementPush");
  checkKeys(obj, "endorsementPush", { required: ["verifier", "endorsement", "signature"] });
  const endorsement = reqObject(obj, "endorsement", "endorsementPush");
  checkKeys(endorsement, "endorsementPush.endorsement", {
    required: ["node", "kind", "measurement", "tcb", "quoteDigest", "verifiedAt", "expiresAt"],
    optional: ["note"],
  });
  const kind = reqString(endorsement, "kind", "endorsementPush.endorsement");
  if (!(TEE_KINDS as readonly string[]).includes(kind))
    throw new SchemaError(
      "endorsementPush.endorsement.kind",
      `背书只接受硬件证明链型（${TEE_KINDS.join(" / ")}）：软件实现不得作为 C2 目标`,
    );
  const tcbRaw = endorsement.tcb;
  if (tcbRaw !== null && typeof tcbRaw !== "string")
    throw new SchemaError("endorsementPush.endorsement.tcb", "必须是字符串或 null");
  const note = optString(endorsement, "note", "endorsementPush.endorsement");
  const sig = reqObject(obj, "signature", "endorsementPush");
  checkKeys(sig, "endorsementPush.signature", { required: ["alg", "kid", "value"] });
  return {
    verifier: reqString(obj, "verifier", "endorsementPush"),
    endorsement: {
      node: reqString(endorsement, "node", "endorsementPush.endorsement"),
      kind: kind as TeeKind,
      measurement: reqString(endorsement, "measurement", "endorsementPush.endorsement"),
      tcb: tcbRaw as string | null,
      quoteDigest: reqDigest(endorsement, "quoteDigest", "endorsementPush.endorsement"),
      verifiedAt: reqTimestamp(endorsement, "verifiedAt", "endorsementPush.endorsement"),
      expiresAt: reqTimestamp(endorsement, "expiresAt", "endorsementPush.endorsement"),
      ...(note !== undefined ? { note } : {}),
    },
    signature: {
      alg: reqString(sig, "alg", "endorsementPush.signature"),
      kid: reqString(sig, "kid", "endorsementPush.signature"),
      value: reqString(sig, "value", "endorsementPush.signature"),
    },
  };
}

export interface EndorsementVerificationInput {
  push: unknown;
  /** 校验方公钥：**部署配置**里的那把（MUST NOT 取自推送体）。 */
  verifierPublicKey: string;
  /**
   * 允许的校验方标识清单（部署白名单）。给了就要求推送里的 `verifier` 在清单内——
   * 与签名一起构成「是**哪个**校验方背书的」这一事实。
   */
  trustedVerifiers?: readonly string[];
  /** 时钟容差（默认 60 秒）：只用于判 `verifiedAt` 不得来自未来。 */
  skewMs?: number;
  now?: Date;
}

/** 校验通过的背书：连同「是哪个校验方背书的」一起返回（两者都在签名覆盖范围内）。 */
export interface VerifiedEndorsement {
  verifier: string;
  endorsement: AttestationEndorsement;
}

/**
 * 校验一份背书推送。逐项失败都抛带错误码的 `MdopError`（错误码与既有登记口径一致）。
 * 校验通过返回**校验方 + 背书本体**，由调用方走既有登记判定（白名单、度量清单、有效期）。
 */
export function verifyEndorsementPush(
  input: EndorsementVerificationInput,
): VerifiedEndorsement {
  const now = input.now ?? new Date();
  if (!input.verifierPublicKey)
    throw new MdopError("E_ATTESTATION_FAILED", {}, "未配置校验方公钥：不得登记任何背书");

  const push = parseEndorsementPush(input.push);

  if (input.trustedVerifiers && !input.trustedVerifiers.includes(push.verifier))
    throw new MdopError(
      "E_ATTESTATION_FAILED",
      { node: push.endorsement.node },
      "校验方不在部署白名单内",
    );

  const { alg, kid } = push.signature;
  if (alg !== SM2_ALGORITHM || kid !== publicKeyKid(input.verifierPublicKey))
    throw new MdopError(
      "E_ATTESTATION_FAILED",
      { node: push.endorsement.node },
      "背书的算法或签名指纹与部署配置的校验方公钥不符",
    );
  if (
    !verifyCanonicalObject(
      endorsementMessage({ verifier: push.verifier, endorsement: push.endorsement }),
      push.signature,
      input.verifierPublicKey,
    )
  )
    throw new MdopError(
      "E_ATTESTATION_FAILED",
      { node: push.endorsement.node },
      "背书签名无效（被改过或不是该校验方签的）",
    );

  const verifiedAt = Date.parse(push.endorsement.verifiedAt);
  const expiresAt = Date.parse(push.endorsement.expiresAt);
  const skew = input.skewMs ?? 60_000;
  if (verifiedAt > now.getTime() + skew)
    throw new MdopError(
      "E_ATTESTATION_FAILED",
      { node: push.endorsement.node },
      "背书的校验时刻在未来（时钟或伪造）",
    );
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime())
    throw new MdopError("E_ATTESTATION_FAILED", { node: push.endorsement.node }, "背书已过期");
  if (expiresAt <= verifiedAt)
    throw new MdopError(
      "E_ATTESTATION_FAILED",
      { node: push.endorsement.node },
      "背书的有效期不晚于校验时刻",
    );
  return { verifier: push.verifier, endorsement: push.endorsement };
}
