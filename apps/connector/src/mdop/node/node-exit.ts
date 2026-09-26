import { Injectable, Logger } from '@nestjs/common';
import { MdopError } from '@medtrust/mdop';

/**
 * 节点出口守卫（任务 3.8、协议 §4.2 R5 / §9.2）。
 *
 * 三条规则，按等级分：
 *  - **C3**：可以出节点，但目标必须在合约接收方名单里（与数据持有方一侧同口径）。
 *  - **C0**：**只能回原持有方**（R5 的字面规则），且本实现把它记为告警——正常链路不该出现；
 *    除原持有方以外的任何目标一律拒。
 *  - **C1 / C2**：一律不得离开本节点（C2 是入口形态，不是出口形态；C1 属协同协议，本期不开放）。
 *
 * 与数据持有方一侧的出口守卫**不共用一个类**：那边的判据里含「合约是否声明 C2」（因为它是**送**的一方），
 * 这边的判据是「出去的只能是 C3」（因为它是**收**的一方）。两份判据不同，强行合并会互相稀释。
 */

export interface NodeExitInput {
  label: string;
  target: string;
  /** 本节点执行过的 C2 信封的**原始持有方**（R5 用）。 */
  originHolders: readonly string[];
  /** 相关合约的接收方并集（C3 目标校验用）。 */
  contractRecipients: readonly string[];
}

export interface NodeExitDecision {
  allowed: boolean;
  reason?: string;
}

@Injectable()
export class NodeExitGuard {
  private readonly logger = new Logger(NodeExitGuard.name);
  private readonly violations: Array<{ at: string; label: string; target: string; reason: string }> = [];
  private readonly backflowWarnings: Array<{ at: string; target: string }> = [];

  decide(input: NodeExitInput): NodeExitDecision {
    if (input.label === 'C3') {
      if (!input.contractRecipients.includes(input.target)) {
        const reason = `C3 目标 ${input.target} 不在合约接收方名单里`;
        return this.reject(input, reason);
      }
      return { allowed: true };
    }

    if (input.label === 'C0') {
      // R5：节点内 C0 不得回流到**原持有方以外的**节点；回原持有方本身也记告警（正常链路不该发生）
      if (!input.originHolders.includes(input.target)) {
        const reason = `节点内 C0 不得回流到原持有方以外的节点（目标 ${input.target}）`;
        return this.reject(input, reason);
      }
      this.backflowWarnings.push({ at: new Date().toISOString(), target: input.target });
      this.logger.warn(`[节点出口] C0 回流到原持有方 ${input.target}（已留痕，正常链路不应出现）`);
      return { allowed: true };
    }

    return this.reject(input, `节点出口只放 C3：收到 ${input.label}`);
  }

  assertDeliverable(input: NodeExitInput): void {
    const decision = this.decide(input);
    if (!decision.allowed) throw new MdopError('E_LABEL_VIOLATION', {}, decision.reason);
  }

  violationsLog(): ReadonlyArray<{ at: string; label: string; target: string; reason: string }> {
    return this.violations;
  }

  backflowLog(): ReadonlyArray<{ at: string; target: string }> {
    return this.backflowWarnings;
  }

  private reject(input: NodeExitInput, reason: string): NodeExitDecision {
    this.violations.push({
      at: new Date().toISOString(),
      label: input.label,
      target: input.target,
      reason,
    });
    this.logger.warn(`[节点出口] 拒绝投递：${reason}`);
    return { allowed: false, reason };
  }
}
