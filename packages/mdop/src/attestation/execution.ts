import { MdopError, type MdopEdgeRef } from "../errors";
import type { AttestationPolicy } from "../label/lattice";
import type { AttestationExpectation } from "../schema/ticket";
import {
  compareTcb,
  verifyAttestationClaims,
  verifyAttestationForC2,
  type AttestationReport,
  type AttestationVerifier,
} from "./provider";

/**
 * 执行前的证明核对（协议 §7.5、决策 D-TEE-1 / D9）。
 *
 * 两类东西必须分清，否则「每次会话重新证明」与「凭证一次性冻结」会互相打架：
 *  - **凭证里的期望**（`AttestationExpectation`）：持有方签署的**代码身份与策略**——
 *    链型、度量、最低可信基。它在要约时冻结，整个作业期间不变。
 *  - **会话释放凭据**（`SessionWarrant`）：KMS 对**本次**证明的处置结果——quote 摘要、度量、
 *    TCB、有效期。每次会话重新证明，因此每次都不同。
 *
 * 执行前把两者对起来：实际证明必须满足期望（同链型、同度量、TCB 达标），且必须有一份
 * 绑定到「本作业 / 本凭证 / 本密钥」且未过期的释放凭据。任一不符即 fail-closed。
 */

export interface SessionWarrant {
  /** KMS 签名覆盖的释放凭据摘要（由 `release.ts` 的 `warrantDigest` 产生）。 */
  digest: string;
  /** 调用方核对 KMS 签名（公钥来自部署配置或合约）后的结果。 */
  signature_valid: boolean;
  job_id: string;
  credential_id: string;
  contract_id: string;
  key_id: string;
  quote_digest: string;
  measurement: string;
  tcb: string | null;
  expires_at: string;
}

export interface C2ExecutionCheck {
  /** 凭证里冻结的执行环境期望（来自 `TicketCore.attestation`）。 */
  expectation: AttestationExpectation;
  /** 本次会话、由节点证明代理产出的实际证明。 */
  report: AttestationReport;
  /** 契约允许的证明策略（链型 / 度量清单 / TCB 下限）。 */
  policy: AttestationPolicy;
  /**
   * 证明校验器（可选）。
   *
   * - **给了**：本端能自己验 quote（KMS、或持有厂商证明根的一方）→ 走完整校验。
   * - **没给**：本端拿不到厂商证明根（例如数据持有方一侧的连接器）→ 改为**只判证明声明**（级别/链型/有效期/
   *   度量/TCB），quote 的验签由**已签名的释放凭据**背书（`warrant.signature_valid` 必须为真，
   *   且凭据与本次证明同源）。这不是「跳过校验」，而是换了一条可验证的证据链：D13 定下的机制。
   */
  verifier?: AttestationVerifier;
  /** KMS 对本次会话的释放凭据。 */
  warrant: SessionWarrant;
  /** 本作业上下文，用于核对凭据归属。 */
  context: { job_id: string; credential_id: string; contract_id: string; key_id: string };
  now?: Date;
  where?: MdopEdgeRef;
}

export function verifyC2Execution(input: C2ExecutionCheck): void {
  const where = input.where ?? {};
  const now = input.now ?? new Date();

  // ① 实际证明本身要过策略（级别 / 链型 / 验签 / 有效期 / 度量清单 / TCB 下限）
  if (input.verifier) {
    verifyAttestationForC2({
      report: input.report,
      policy: input.policy,
      verifier: input.verifier,
      now,
      where,
    });
  } else {
    // 无厂商证明根：只判声明；quote 的真实性由下面的释放凭据（含签名）背书
    verifyAttestationClaims({ report: input.report, policy: input.policy, now, where });
    if (!input.warrant.signature_valid) {
      throw new MdopError(
        "E_ATTESTATION_FAILED",
        where,
        "本端无法校验 quote，且释放凭据未提供有效签名背书",
      );
    }
  }

  // ② 实际证明必须与凭证里冻结的期望一致：换了代码或换了链型即拒
  if (input.report.kind !== input.expectation.tee) {
    throw new MdopError("E_CAPABILITY_MISMATCH", where, "实际证明的链型与凭证里的期望不符");
  }
  if (input.report.measurement !== input.expectation.measurement) {
    throw new MdopError("E_MEASUREMENT_NOT_ALLOWED", where, "实际执行的代码度量与凭证里的期望不符");
  }
  if (input.expectation.min_tcb !== undefined) {
    if (!input.report.tcb) {
      throw new MdopError("E_TCB_TOO_OLD", where, "证明未给出可信基版本，无法满足凭证里的下限");
    }
    const cmp = compareTcb(input.report.tcb, input.expectation.min_tcb);
    if (cmp === null)
      throw new MdopError("E_TCB_TOO_OLD", where, "可信基版本与凭证里的下限不可比");
    if (cmp < 0) throw new MdopError("E_TCB_TOO_OLD", where, "可信基版本低于凭证里的下限");
  }

  // ③ 释放凭据：签名有效、绑定本作业、与本次证明同源、未过期
  const w = input.warrant;
  if (!w.signature_valid) {
    throw new MdopError("E_KEY_RELEASE_DENIED", where, "释放凭据签名无效");
  }
  const c = input.context;
  if (
    w.job_id !== c.job_id ||
    w.credential_id !== c.credential_id ||
    w.contract_id !== c.contract_id ||
    w.key_id !== c.key_id
  ) {
    throw new MdopError("E_KEY_RELEASE_DENIED", where, "释放凭据不属于本作业");
  }
  if (w.quote_digest !== input.report.quote_digest || w.measurement !== input.report.measurement) {
    throw new MdopError("E_ATTESTATION_FAILED", where, "释放凭据与本次证明不同源");
  }
  const expires = Date.parse(w.expires_at);
  if (!Number.isFinite(expires) || expires <= now.getTime()) {
    throw new MdopError("E_KEY_RELEASE_DENIED", where, "释放凭据已过期，须重新证明与释放");
  }
}
