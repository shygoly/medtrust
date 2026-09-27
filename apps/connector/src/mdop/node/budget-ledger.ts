import { Injectable, Logger } from '@nestjs/common';
import { MdopError } from '@medtrust/mdop';

/**
 * 查询预算账本（任务 3.7、协议 §10.1 在 C2 场景下的落地）。
 *
 * 为什么它必须存在：C2 给了申请方「对一个可解密环境提问」的能力。没有预算与审计，
 * 申请方可以用大量各自合法的小统计量反推个体——**后果与直接出明细同级，而且看起来完全合规**。
 *
 * 计量口径：**「数据集 × 快照版本」**（快照换了＝新的一组预算，避免"换一批数据继续扫"）。
 * 账本以**持有方本地账本为准**——本类是实现该账本的一侧；任何一次查询（含亚组、切点重算）
 * 都要先 `assertWithin`，事后 `charge`。
 */

export interface BudgetKey {
  /** 数据集标识（本地数据产品的稳定标识）。 */
  dataset: string;
  /** 数据快照标识（文件字节 SM3 / 库快照 id）——换快照即换预算组。 */
  snapshot: string;
}

export interface BudgetPolicy {
  /** 同一组（数据集 × 快照）的预算上限。 */
  limit: number;
  /** 计量单位（ε / 查询次数 / 维度组合数）；账本按同一单位累计。 */
  unit: 'epsilon' | 'queries' | 'cells';
}

export interface BudgetUsage {
  key: BudgetKey;
  spent: number;
  limit: number;
  unit: BudgetPolicy['unit'];
}

export interface BudgetAuditEntry {
  at: string;
  key: BudgetKey;
  cost: number;
  kind: 'query' | 'subgroup' | 'recompute' | 'service-query';
  /** 申请方标识（用于差分查询检测与追责）。 */
  applicant: string;
}

export interface ServiceBudgetCheckInput {
  contractId: string;
  applicant: string;
  costEpsilon: number;
  policy: {
    total_epsilon: number;
    max_queries: number;
    rate_limit_per_hour?: number;
    circuit_breaker_enabled?: boolean;
  };
  now?: Date;
}

@Injectable()
export class NodeQueryBudgetLedger {
  private readonly logger = new Logger(NodeQueryBudgetLedger.name);
  private readonly spent = new Map<string, number>();
  private readonly audit: BudgetAuditEntry[] = [];
  private readonly serviceQueries = new Map<string, Array<{ at: number; epsilon: number; applicant: string }>>();
  private readonly circuitBreakers = new Set<string>();

  private static keyOf(key: BudgetKey): string {
    return `${key.dataset}@${key.snapshot}`;
  }

  /** 已消耗（缺省 0）。 */
  used(key: BudgetKey): number {
    return this.spent.get(NodeQueryBudgetLedger.keyOf(key)) ?? 0;
  }

  usage(key: BudgetKey, policy: BudgetPolicy): BudgetUsage {
    return { key, spent: this.used(key), limit: policy.limit, unit: policy.unit };
  }

  /** 查询前先判：超限即拒（fail-closed），并**不**扣减。 */
  assertWithin(key: BudgetKey, policy: BudgetPolicy, cost: number): void {
    if (!Number.isFinite(cost) || cost < 0)
      throw new MdopError('E_RUNTIME', {}, `预算开销非法：${cost}`);
    const after = this.used(key) + cost;
    if (after > policy.limit)
      throw new MdopError(
        'E_BUDGET_EXCEEDED',
        {},
        `预算不足：已用 ${this.used(key)} / 上限 ${policy.limit}（${policy.unit}）`,
      );
  }

  /**
   * 查询成功后扣减并记账。**亚组与切点重算同样计入**（`kind` 区分来源，便于事后审计）。
   * 记账失败不会让已经算出的结果"退回"——所以调用顺序必须是「先 assert → 再算 → 再 charge」。
   */
  charge(input: {
    key: BudgetKey;
    policy: BudgetPolicy;
    cost: number;
    kind: BudgetAuditEntry['kind'];
    applicant: string;
  }): BudgetUsage {
    this.assertWithin(input.key, input.policy, input.cost);
    const k = NodeQueryBudgetLedger.keyOf(input.key);
    this.spent.set(k, this.used(input.key) + input.cost);
    this.audit.push({
      at: new Date().toISOString(),
      key: input.key,
      cost: input.cost,
      kind: input.kind,
      applicant: input.applicant,
    });
    this.logger.log(
      `查询预算扣减 dataset=${input.key.dataset} snapshot=${input.key.snapshot.slice(0, 12)}… ` +
        `cost=${input.cost} kind=${input.kind} used=${this.used(input.key)}/${input.policy.limit}`,
    );
    return this.usage(input.key, input.policy);
  }

  /** 审计流水（控制台与回执用）。 */
  entries(): readonly BudgetAuditEntry[] {
    return this.audit;
  }

  /**
   * 差分查询检测（同口径的最小实现）：同一申请方在同一组上**重复或高度相似**的查询
   * 累计超过 `threshold` 次即返回 true，由调用方按合约处置（拒绝后续查询 / 上报告警）。
   */
  detectDifferential(input: {
    key: BudgetKey;
    applicant: string;
    threshold?: number;
  }): boolean {
    const threshold = input.threshold ?? 20;
    const n = this.audit.filter(
      (e) =>
        e.applicant === input.applicant &&
        e.key.dataset === input.key.dataset &&
        e.key.snapshot === input.key.snapshot,
    ).length;
    if (n >= threshold) {
      this.logger.warn(
        `差分查询告警：applicant=${input.applicant} dataset=${input.key.dataset} 已 ${n} 次（阈值 ${threshold}）`,
      );
      return true;
    }
    return false;
  }

  isCircuitBreakerTripped(contractId: string): boolean {
    return this.circuitBreakers.has(contractId);
  }

  tripCircuitBreaker(contractId: string, reason: string): void {
    this.circuitBreakers.add(contractId);
    this.logger.error(`服务计算合约 ${contractId} 触发熔断：${reason}`);
  }

  resetCircuitBreaker(contractId: string): void {
    this.circuitBreakers.delete(contractId);
  }

  /** 服务计算预算断言：熔断、总调用量、总 ε、时段限流四大关口 fail-closed 拦截。 */
  assertServiceBudgetWithin(input: ServiceBudgetCheckInput): void {
    if (this.isCircuitBreakerTripped(input.contractId)) {
      throw new MdopError('E_BUDGET_EXCEEDED', {}, `服务计算已触发熔断，拒绝查询（contract=${input.contractId}）`);
    }

    const history = this.serviceQueries.get(input.contractId) ?? [];
    if (history.length >= input.policy.max_queries) {
      throw new MdopError(
        'E_BUDGET_EXCEEDED',
        {},
        `服务计算调用次数已达上限：已调用 ${history.length} / 上限 ${input.policy.max_queries}`,
      );
    }

    const totalEpsilonSpent = history.reduce((acc, h) => acc + h.epsilon, 0);
    if (totalEpsilonSpent + input.costEpsilon > input.policy.total_epsilon) {
      throw new MdopError(
        'E_BUDGET_EXCEEDED',
        {},
        `服务计算差分隐私预算不足：已用 ${totalEpsilonSpent} + 本次 ${input.costEpsilon} > 上限 ${input.policy.total_epsilon}`,
      );
    }

    const nowMs = (input.now ?? new Date()).getTime();
    if (input.policy.rate_limit_per_hour !== undefined) {
      const oneHourAgo = nowMs - 3600 * 1000;
      const recentQueries = history.filter((h) => h.at >= oneHourAgo).length;
      if (recentQueries >= input.policy.rate_limit_per_hour) {
        if (input.policy.circuit_breaker_enabled) {
          this.tripCircuitBreaker(input.contractId, `小时速率超限触发熔断（${recentQueries} >= ${input.policy.rate_limit_per_hour}）`);
        }
        throw new MdopError(
          'E_BUDGET_EXCEEDED',
          {},
          `服务计算每小时调用速率超限（已调用 ${recentQueries} 次 / 限制 ${input.policy.rate_limit_per_hour} 次）`,
        );
      }
    }
  }

  /** 服务计算扣减账本。先断言再扣减。 */
  chargeServiceBudget(input: ServiceBudgetCheckInput): { usedEpsilon: number; totalQueries: number } {
    this.assertServiceBudgetWithin(input);

    const nowMs = (input.now ?? new Date()).getTime();
    let history = this.serviceQueries.get(input.contractId);
    if (!history) {
      history = [];
      this.serviceQueries.set(input.contractId, history);
    }

    history.push({
      at: nowMs,
      epsilon: input.costEpsilon,
      applicant: input.applicant,
    });

    const totalEpsilonSpent = history.reduce((acc, h) => acc + h.epsilon, 0);
    this.audit.push({
      at: new Date(nowMs).toISOString(),
      key: { dataset: input.contractId, snapshot: 'service-corpus' },
      cost: input.costEpsilon,
      kind: 'service-query',
      applicant: input.applicant,
    });

    this.logger.log(
      `服务计算预算扣减 contract=${input.contractId} costEps=${input.costEpsilon} totalEps=${totalEpsilonSpent} totalQueries=${history.length}`,
    );

    return {
      usedEpsilon: totalEpsilonSpent,
      totalQueries: history.length,
    };
  }
}
