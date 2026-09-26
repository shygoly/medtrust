import type { MdopEdgeRef } from "../errors";
import type { AttestationPolicy } from "../label/lattice";
import { asObject, checkKeys, reqString, SchemaError } from "../schema/strict";
import type { AttestationExpectation } from "../schema/ticket";
import { verifyC2Execution } from "./execution";
import { parseKeyReleaseWarrant, verifyReleaseWarrant, type KeyReleaseWarrant } from "./kms";
import { parseAttestationReport, verifyAttestationClaims, type AttestationReport } from "./provider";

/**
 * **会话见证**：把「这次会话在什么代码下处理过、KMS 为什么释放了密钥」打包成一份
 * 可**离线独立核验**的对象（D13 方案②、任务 6.7）。
 *
 * 为什么需要它（本轮复核发现的缺环）：D13 定的是「持有方用 KMS 释放凭据独立校验证明，
 * 不采信平台的登记结论」，但凭据本体原先**只存在于节点会话内**——平台只落库摘要
 * （不可验签），持有方拿不到凭据，于是「独立校验」只剩口号。
 *
 * 载体（两条消息，走既有的控制面通道）：
 *   节点 → 平台：`AttestationReport`（本对象）
 *   平台 → 该作业各持有方：`AttestationWitness`（同一份对象，原样转发）
 * 平台能做的是「不给」，做不了的是「伪造」——验签用的是**部署配置里固定的 KMS 公钥**
 * （`verifySessionWitness` 的入参），因此转发通道不需要被信任。
 *
 * 校验一律 fail-closed，且**复用生产判据**（`verifyReleaseWarrant` + `verifyC2Execution`），
 * 不另写一套：换链、换 KMS 实现都不影响这里。
 */

export interface SessionWitness {
  job_id: string;
  credential_id: string;
  contract_id: string;
  key_id: string;
  /** 出证明的节点（参与方 URN）。 */
  node: string;
  report: AttestationReport;
  warrant: KeyReleaseWarrant;
}

/** 严格解析（未知字段即拒；报告与凭据各自按自己的严格口径再解一遍）。 */
export function parseSessionWitness(input: unknown): SessionWitness {
  const obj = asObject(input, "attestation.witness");
  checkKeys(obj, "attestation.witness", {
    required: ["job_id", "credential_id", "contract_id", "key_id", "node", "report", "warrant"],
  });
  const witness: SessionWitness = {
    job_id: reqString(obj, "job_id", "attestation.witness"),
    credential_id: reqString(obj, "credential_id", "attestation.witness"),
    contract_id: reqString(obj, "contract_id", "attestation.witness"),
    key_id: reqString(obj, "key_id", "attestation.witness"),
    node: reqString(obj, "node", "attestation.witness"),
    report: parseAttestationReport(obj.report),
    warrant: parseKeyReleaseWarrant(obj.warrant),
  };
  if (witness.report.node !== undefined && witness.report.node !== witness.node)
    throw new SchemaError(
      "attestation.witness.node",
      "证明里绑定的节点身份与见证声明的节点不一致",
    );
  return witness;
}

/**
 * 核验一份会话见证（**独立于平台**：只信部署配置里的 KMS 公钥与合约策略）。
 *
 * 逐项：严格解析 → KMS 签名/绑定/一次性公钥指纹/有效期 → 证明声明（级别/链型/有效期/度量/TCB）
 * →（给了期望就）与凭证里冻结的期望对拍。任一不过即抛错，**不回退**成「当作没看见」。
 * 通过后返回会话凭据（与节点侧同一形状），调用方据此留痕（如审计与回执）。
 */
export function verifySessionWitness(input: {
  witness: SessionWitness | unknown;
  /** KMS 公钥：**来自部署配置或合约**，MUST NOT 取自消息。 */
  kmsPublicKey: string;
  /** 生效的证明策略（合约 ∩ 注册中心白名单，由调用方用 `resolveMeasurementWhitelist` 算好）。 */
  policy: AttestationPolicy;
  /** 凭证里为**该节点**冻结的执行环境期望（有就一并核对）。 */
  expectation?: AttestationExpectation;
  now?: Date;
  where?: MdopEdgeRef;
}) {
  const where = input.where ?? {};
  const witness = parseSessionWitness(input.witness);
  const context = {
    job_id: witness.job_id,
    credential_id: witness.credential_id,
    contract_id: witness.contract_id,
    key_id: witness.key_id,
  };

  // ① KMS 释放凭据：签名、归属、摘要重算、封给本次证明的一次性公钥、未过期
  const session = verifyReleaseWarrant({
    warrant: witness.warrant,
    kmsPublicKey: input.kmsPublicKey,
    report: witness.report,
    context,
    ...(input.now ? { now: input.now } : {}),
    where,
  });

  // ② 证明声明（级别/链型/有效期/度量/TCB）——没有厂商根的调用方走这一步 + 凭据背书
  verifyAttestationClaims({
    report: witness.report,
    policy: input.policy,
    ...(input.now ? { now: input.now } : {}),
    where,
  });

  // ③ 有凭证里的期望就一并核对（同链型、同度量、TCB 达标、凭据同源未过期）
  if (input.expectation) {
    verifyC2Execution({
      expectation: input.expectation,
      report: witness.report,
      policy: input.policy,
      // 持有方/平台没有厂商证明根：quote 的真实性由**已签名的释放凭据**背书（D13）
      warrant: session,
      context,
      ...(input.now ? { now: input.now } : {}),
      where,
    });
  }

  return { witness, session };
}
