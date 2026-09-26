import { canonicalSm3 } from "../crypto/sm3";
import { MdopError, type MdopEdgeRef } from "../errors";
import type { AttestationPolicy } from "../label/lattice";
import {
  verifyAttestationForC2,
  type AttestationReport,
  type AttestationVerifier,
} from "./provider";

/**
 * 数据密钥释放判定（协议 §9.4、决策 D-TEE-1）。
 *
 * 这是 KMS 的**判据本身**，与具体 KMS 实现无关：做成纯函数是为了让「释放条件」只有一份定义——
 * 平台侧编排、节点侧客户端、以及后续任何 KMS 实现都调它，不各写一套。
 *
 * 逐项 fail-closed，任何一条不过即拒绝，**不回退到明文、旧密钥或跳过校验**：
 *   ① 硬件级证明可用（复用 `verifyAttestationForC2`：级别 / 链型 / 验签 / 有效期 / 度量 / TCB）
 *   ② 执行凭证有效
 *   ③ 合约未终止
 *   ④ `key_id` 属于本作业的片段
 */

export interface ReleaseContext {
  job_id: string;
  credential_id: string;
  contract_id: string;
  key_id: string;
  /** 该 `key_id` 登记所属的作业与合约（登记侧的事实，不是请求方声明的）。 */
  key_owner: { job_id: string; contract_id: string };
  /** 调用方已完成的凭证校验结果：签名完整且在有效期内。 */
  credential_valid: boolean;
  /** 合约是否仍然有效（未终止、在有效期内）。 */
  contract_active: boolean;
  now?: Date;
  where?: MdopEdgeRef;
}

export interface ReleaseInput extends ReleaseContext {
  report: AttestationReport;
  policy: AttestationPolicy;
  verifier: AttestationVerifier;
}

export interface ReleaseDecision {
  released: true;
  job_id: string;
  key_id: string;
  /** 释放凭据摘要：写进审计回执与作业凭证，供持有方离线复核（D13）。 */
  warrant_digest: string;
}

/** 摘要所需的最小输入：任何一端都能用它**重算**并核对一份释放凭据。 */
export type WarrantDigestInput = Pick<
  ReleaseInput,
  "job_id" | "credential_id" | "contract_id" | "key_id" | "report"
>;

export function evaluateKeyRelease(input: ReleaseInput): ReleaseDecision {
  const where = input.where ?? {};

  // ① 证明：级别、链型、验签、有效期、度量、TCB——细分错误码由该函数给出
  verifyAttestationForC2({
    report: input.report,
    policy: input.policy,
    verifier: input.verifier,
    now: input.now,
    where,
  });

  // ② 凭证有效
  if (!input.credential_valid) {
    throw new MdopError("E_TICKET_INVALID", where, "执行凭证无效或已过期，不释放密钥");
  }

  // ③ 合约未终止
  if (!input.contract_active) {
    throw new MdopError("E_KEY_RELEASE_DENIED", where, "合约已终止，不释放密钥");
  }

  // ④ 密钥归属：防止拿 A 作业的凭证取 B 作业的密钥
  if (
    input.key_owner.job_id !== input.job_id ||
    input.key_owner.contract_id !== input.contract_id
  ) {
    throw new MdopError("E_KEY_RELEASE_DENIED", where, "该密钥不属于本作业的片段");
  }

  return {
    released: true,
    job_id: input.job_id,
    key_id: input.key_id,
    warrant_digest: warrantDigest(input),
  };
}

/**
 * 释放凭据摘要：把「在什么证明下、为哪个作业、释放了哪把密钥」压成一个可离线核验的摘要，
 * 由 KMS 签名后随凭证下发——持有方据此**独立复核**，不必把信任交给平台（D13）。
 *
 * **必须带上逐会话变化的字段**（`ephemeral_public_key`、`issued_at`）：只摘要
 * 「作业 + 密钥 + 度量 + TCB + 有效期」时，同一段代码、同一秒内的两次会话会算出**同一个摘要**，
 * 于是两次会话在登记侧被当成同一次（第二次的凭据换不掉第一次的），
 * 「每次会话重新证明」这条规则就被摘要口径吃掉了。
 */
export function warrantDigest(input: WarrantDigestInput): string {
  return canonicalSm3({
    job_id: input.job_id,
    credential_id: input.credential_id,
    contract_id: input.contract_id,
    key_id: input.key_id,
    quote_digest: input.report.quote_digest,
    measurement: input.report.measurement,
    tcb: input.report.tcb,
    ephemeral_public_key: input.report.ephemeral_public_key ?? null,
    issued_at: input.report.issued_at,
    expires_at: input.report.expires_at,
  });
}
