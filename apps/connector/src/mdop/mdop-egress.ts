import { currentConnectorSpaceId } from "../space/space-context";
import { Injectable, Logger } from '@nestjs/common';
import {
  MdopError,
  participantUrn,
  verifyAttestationClaims,
  type AttestationPolicy,
  type AttestationReport,
  type FlowLabel,
} from '@medtrust/mdop';
import type { LocalMdopContract } from '@medtrust/database';

/**
 * C0 出节点守卫（任务 8.6 / 规格「C0 不出节点」）。
 *
 * 数据面出口只投递 **C3** 制品，且目标必须在**本地合约的接收方列表**里。
 * 这是编译期、复核之外的**第三道**拦截：任何把 C0/C1/C2 制品发往本节点之外的尝试，
 * 一律拒绝、抛错并记审计 —— 与编译与复核的结论无关。
 */

export interface EgressDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * C2 投递所需的证据（任务 6.1）。
 *
 * 连接器**没有厂商证明根**，验不了 quote；它依据的是**KMS 出具的、可离线核验的释放凭据**
 * （D13）：凭据由配置里的 KMS 公钥验签，与本次证明同源、未过期。因此这里的证据只有两项：
 * 合约的证明策略（来自**本地合约副本**）与本次会话的证明声明（来自节点）。
 */
export interface C2EgressEvidence {
  /**
   * 合约的证明策略**覆盖值**：缺省时从**本地合约副本的条款**里读（副本才是权威，
   * 调用方传它只用于测试或显式指定更严的策略）。
   */
  policy?: AttestationPolicy;
  report: AttestationReport;
  /** 生效度量白名单（注册中心 ∩ 合约），缺省表示只按合约与链型判。 */
  allowedMeasurements?: readonly string[];
  now?: Date;
}

@Injectable()
export class MdopEgressGuard {
  private readonly logger = new Logger(MdopEgressGuard.name);
  private readonly violations: Array<{ at: string; label: string; target: string; reason: string }> = [];

  /**
   * 判定一次出节点投递是否放行。**不抛错**，由调用方决定是拒绝还是记录；
   * 想要「拒绝即抛错」用 {@link assertDeliverable}。
   */
  decide(input: {
    label: FlowLabel | string;
    target: string;
    /** C3 只看接收方列表；C2 还要读本地副本条款里的证明策略（此时 `canonical` 必填）。 */
    contract: Pick<LocalMdopContract, 'recipients'> & Partial<Pick<LocalMdopContract, 'canonical'>>;
    /** C2 投递时必须提供：合约策略 + 本次证明声明（缺省即拒，fail-closed）。 */
    c2?: C2EgressEvidence;
  }): EgressDecision {
    if (input.label === 'C2') return this.decideC2(input);
    if (input.label !== 'C3') {
      const reason = `数据面只允许投递 C3 或 C2 制品（收到 ${input.label}）`;
      this.record(input.label, input.target, reason);
      return { allowed: false, reason };
    }
    const recipients = Array.isArray(input.contract.recipients) ? input.contract.recipients : [];
    if (!recipients.includes(input.target)) {
      const reason = `投递目标 ${input.target} 不在本地合约的接收方列表里`;
      this.record(input.label, input.target, reason);
      return { allowed: false, reason };
    }
    return { allowed: true };
  }

  /**
   * C2 投递判定（任务 6.1）：`C2` 只许投给「合约声明了证明策略、且目标节点证明**声明层面**合规」的节点。
   *
   * - 合约没声明 `attestation_policy` → 拒（该合约根本不允许 C2）；
   * - 没有本次证明声明 → 拒（不得凭「它说自己可信」放行）；
   * - 声明层面（级别/链型/有效期/度量/TCB）由协议核心的 `verifyAttestationClaims` 判——
   *   **quote 的验签不在这一步**：由 KMS 做、以签名凭据背书（D13），凭据校验在复核阶段完成。
   */
  private decideC2(input: {
    target: string;
    contract: Pick<LocalMdopContract, 'recipients'> & Partial<Pick<LocalMdopContract, 'canonical'>>;
    c2?: C2EgressEvidence;
  }): EgressDecision {
    // 合约是否允许 C2：从**本地副本的条款**读，不从平台消息读
    const terms = input.c2?.policy ?? this.localPolicy(input.contract);
    if (!terms) {
      const reason = '本地合约未声明证明策略，不允许投递 C2';
      this.record('C2', input.target, reason);
      return { allowed: false, reason };
    }
    if (!input.c2?.report) {
      const reason = 'C2 投递缺少本次证明声明（拒，不凭自述放行）';
      this.record('C2', input.target, reason);
      return { allowed: false, reason };
    }
    try {
      verifyAttestationClaims({
        report: input.c2.report,
        policy: {
          ...terms,
          allowed_measurements: input.c2.allowedMeasurements,
        },
        now: input.c2.now,
      });
    } catch (err) {
      const reason = `C2 目标证明不合规：${(err as Error).message}`;
      this.record('C2', input.target, reason);
      return { allowed: false, reason };
    }
    return { allowed: true };
  }

  /** 从本地合约副本的规范化条款里读证明策略（副本才是权威）。 */
  private localPolicy(
    contract: Partial<Pick<LocalMdopContract, 'canonical'>>,
  ): AttestationPolicy | undefined {
    if (!contract.canonical) return undefined;
    try {
      const terms = JSON.parse(contract.canonical) as { attestation_policy?: AttestationPolicy };
      return terms.attestation_policy;
    } catch {
      return undefined;
    }
  }

  assertDeliverable(input: {
    label: FlowLabel | string;
    target: string;
    contract: Pick<LocalMdopContract, 'recipients'> & Partial<Pick<LocalMdopContract, 'canonical'>>;
    c2?: C2EgressEvidence;
  }): void {
    const decision = this.decide(input);
    if (!decision.allowed) throw new MdopError('E_LABEL_VIOLATION', {}, decision.reason);
  }

  /** 违规留痕（审计导出用）。 */
  violationsLog(): ReadonlyArray<{ at: string; label: string; target: string; reason: string }> {
    return this.violations;
  }

  /** 平台节点的 URN（C3 投递给平台时用）。 */
  platformParty(space = currentConnectorSpaceId()): string {
    return participantUrn(space, 'platform');
  }

  private record(label: string, target: string, reason: string): void {
    this.violations.push({ at: new Date().toISOString(), label, target, reason });
    this.logger.warn(`[C0 守卫] 拒绝投递：${reason}`);
  }
}
