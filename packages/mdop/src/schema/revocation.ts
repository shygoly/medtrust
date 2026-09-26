import { type Sm2Signature } from "../crypto/sm2";
import { withoutSignature } from "../canonical/jcs";
import { signCanonicalObject, verifyCanonicalObject } from "../crypto/sm2";
import {
  SchemaError,
  asObject,
  checkKeys,
  reqArray,
  reqNumber,
  reqObject,
  reqString,
  reqTimestamp,
} from "./strict";

/**
 * 算子吊销名单（D-MDOP-5 / 规格「签名吊销名单同步」）。
 *
 * 由平台节点密钥签名，随长轮询下发；连接器验签、落盘、**只接受版本号更高的名单**。
 * 启动后在收到并验过一份有效名单之前，MUST 拒绝执行任何 wasm 算子。
 */

export interface OperatorRevocationList {
  version: number;
  issued_at: string;
  revoked_digests: string[];
  sig: Sm2Signature;
}

export function parseRevocationList(input: unknown): OperatorRevocationList {
  const obj = asObject(input, "revocationList");
  checkKeys(obj, "revocationList", {
    required: ["version", "issued_at", "revoked_digests", "sig"],
  });
  const version = reqNumber(obj, "version", "revocationList");
  if (!Number.isInteger(version) || version < 0)
    throw new SchemaError("revocationList.version", "必须是非负整数");
  const sig = reqObject(obj, "sig", "revocationList");
  checkKeys(sig, "revocationList.sig", { required: ["alg", "kid", "value"] });
  return {
    version,
    issued_at: reqTimestamp(obj, "issued_at", "revocationList"),
    revoked_digests: reqArray(obj, "revoked_digests", "revocationList").map((item, i) => {
      if (typeof item !== "string" || item.length === 0)
        throw new SchemaError(`revocationList.revoked_digests[${i}]`, "必须是算子摘要");
      return item as string;
    }),
    sig: {
      alg: reqString(sig, "alg", "revocationList.sig"),
      kid: reqString(sig, "kid", "revocationList.sig"),
      value: reqString(sig, "value", "revocationList.sig"),
    },
  };
}

/**
 * 版本单调：本地已存版本更高的名单 MUST 被拒（防回放，规格「版本回退」）。
 * 幂等：同版本同内容可重复应用；同版本不同内容一律拒。
 */
export function assertMonotonicVersion(
  incoming: OperatorRevocationList,
  local: { version: number; revoked_digests: string[] } | null,
): void {
  if (!local) return;
  if (incoming.version < local.version)
    throw new SchemaError("revocationList.version", "版本回退被拒");
  if (incoming.version === local.version) {
    const same =
      incoming.revoked_digests.slice().sort().join(",") ===
      local.revoked_digests.slice().sort().join(",");
    if (!same) throw new SchemaError("revocationList.version", "同版本内容不一致");
  }
}

/**
 * 吊销名单的签名内容 = 去掉 `sig` 的名单（**对象本身**，签名实现内部做 JCS + SM3，
 * 与信封、凭证、算子清单同一口径）。平台节点密钥签，连接器用部署固定的平台节点公钥验。
 */
export function revocationListSigningPayload(
  list: Omit<OperatorRevocationList, "sig">,
): Record<string, unknown> {
  return withoutSignature(list as unknown as Record<string, unknown>);
}

export function signRevocationList(
  list: Omit<OperatorRevocationList, "sig">,
  privateKey: string,
  publicKey: string,
): OperatorRevocationList {
  const sig = signCanonicalObject(revocationListSigningPayload(list), privateKey, { publicKey });
  return { ...list, sig };
}

/** 验签：失败一律 false（连接器据此拒收整份名单，继续用本地版本）。 */
export function verifyRevocationList(
  list: OperatorRevocationList,
  publicKey: string,
): boolean {
  const parsed = parseRevocationList(list);
  return verifyCanonicalObject(
    revocationListSigningPayload(parsed),
    parsed.sig,
    publicKey,
  );
}
