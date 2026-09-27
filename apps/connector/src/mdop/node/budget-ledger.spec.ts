import { NodeQueryBudgetLedger } from './budget-ledger';

describe('NodeQueryBudgetLedger（预算账本与服务计算累积约束）', () => {
  let ledger: NodeQueryBudgetLedger;

  beforeEach(() => {
    ledger = new NodeQueryBudgetLedger();
  });

  it('原有单任务数据集预算 assertWithin 与 charge', () => {
    const key = { dataset: 'ds1', snapshot: 'snap1' };
    const policy = { limit: 10, unit: 'queries' as const };

    ledger.assertWithin(key, policy, 2);
    const usage = ledger.charge({
      key,
      policy,
      cost: 2,
      kind: 'query',
      applicant: 'pharma_1',
    });
    expect(usage.spent).toBe(2);
    expect(ledger.used(key)).toBe(2);

    expect(() => ledger.assertWithin(key, policy, 9)).toThrow('预算不足');
  });

  describe('服务计算服务预算策略', () => {
    const policy = {
      total_epsilon: 5.0,
      max_queries: 3,
      rate_limit_per_hour: 2,
      circuit_breaker_enabled: true,
    };

    it('正常多次调用累加 epsilon 与 queryCount', () => {
      ledger.chargeServiceBudget({
        contractId: 'ct_service_1',
        applicant: 'app_1',
        costEpsilon: 1.5,
        policy,
      });

      const res2 = ledger.chargeServiceBudget({
        contractId: 'ct_service_1',
        applicant: 'app_1',
        costEpsilon: 1.5,
        policy,
      });

      expect(res2.usedEpsilon).toBe(3.0);
      expect(res2.totalQueries).toBe(2);
    });

    it('超出总 epsilon 预算时抛出 E_BUDGET_EXCEEDED', () => {
      ledger.chargeServiceBudget({
        contractId: 'ct_service_eps',
        applicant: 'app_1',
        costEpsilon: 4.0,
        policy,
      });

      expect(() =>
        ledger.chargeServiceBudget({
          contractId: 'ct_service_eps',
          applicant: 'app_1',
          costEpsilon: 2.0, // 4.0 + 2.0 > 5.0
          policy,
        }),
      ).toThrow('差分隐私预算不足');
    });

    it('超出最大调用次数时抛出 E_BUDGET_EXCEEDED', () => {
      for (let i = 0; i < 3; i++) {
        ledger.chargeServiceBudget({
          contractId: 'ct_service_count',
          applicant: 'app_1',
          costEpsilon: 0.1,
          policy: { ...policy, rate_limit_per_hour: 100 }, // ignore rate limit here
        });
      }

      expect(() =>
        ledger.chargeServiceBudget({
          contractId: 'ct_service_count',
          applicant: 'app_1',
          costEpsilon: 0.1,
          policy: { ...policy, rate_limit_per_hour: 100 },
        }),
      ).toThrow('调用次数已达上限');
    });

    it('小时调用速率超限时触发熔断，后续即使频次降低也拒绝查询', () => {
      const now = new Date();
      ledger.chargeServiceBudget({
        contractId: 'ct_circuit',
        applicant: 'app_1',
        costEpsilon: 0.1,
        policy,
        now,
      });

      ledger.chargeServiceBudget({
        contractId: 'ct_circuit',
        applicant: 'app_1',
        costEpsilon: 0.1,
        policy,
        now,
      });

      // 第三次超出 rate_limit_per_hour: 2，且触发熔断
      expect(() =>
        ledger.chargeServiceBudget({
          contractId: 'ct_circuit',
          applicant: 'app_1',
          costEpsilon: 0.1,
          policy,
          now,
        }),
      ).toThrow('每小时调用速率超限');

      expect(ledger.isCircuitBreakerTripped('ct_circuit')).toBe(true);

      // 下一小时的调用，因熔断仍被拒绝
      const nextHour = new Date(now.getTime() + 7200 * 1000);
      expect(() =>
        ledger.chargeServiceBudget({
          contractId: 'ct_circuit',
          applicant: 'app_1',
          costEpsilon: 0.1,
          policy,
          now: nextHour,
        }),
      ).toThrow('已触发熔断');

      // 重置熔断后可恢复
      ledger.resetCircuitBreaker('ct_circuit');
      expect(ledger.isCircuitBreakerTripped('ct_circuit')).toBe(false);
    });
  });
});
