import {
  decide,
  detectConflicts,
  parseUsagePolicy,
  runObligations,
  UsagePolicyError,
  type UsageObligation,
  type UsagePolicy,
} from './engine';
import { policyFromContract, requestFromContract } from './legacy';
import type { ContractView } from '../contract-view';

const policy = (over: Partial<UsagePolicy> = {}): UsagePolicy => ({
  version: 1,
  id: 'p-1',
  grants: [{ effect: 'allow', subject: 'h-1', object: 'dp-1', action: 'compute' }],
  ...over,
});

const request = {
  subject: 'h-1',
  object: 'dp-1',
  action: 'compute' as const,
  now: Date.parse('2026-11-05T00:00:00Z'),
};

describe('使用控制策略引擎（TC609-6-2025-15）', () => {
  describe('解析与冲突检测', () => {
    it('版本/字段非法一律拒绝（fail-closed）', () => {
      const bad: unknown[] = [
        null,
        [],
        { version: 2, id: 'x', grants: [] },
        { version: 1, id: '', grants: [{}] },
        { version: 1, id: 'x', grants: [] },
        { version: 1, id: 'x', grants: [{ effect: 'maybe', subject: 'a', object: 'b', action: 'compute' }] },
        { version: 1, id: 'x', grants: [{ effect: 'allow', subject: 'a', object: 'b', action: 'delete' }] },
        {
          version: 1,
          id: 'x',
          grants: [
            { effect: 'allow', subject: 'a', object: 'b', action: 'read', constraints: { maxUses: 0 } },
          ],
        },
        {
          version: 1,
          id: 'x',
          grants: [
            { effect: 'allow', subject: 'a', object: 'b', action: 'read', obligations: [{ kind: 'nope' }] },
          ],
        },
      ];
      for (const item of bad) {
        expect(() => parseUsagePolicy(item)).toThrow(UsagePolicyError);
      }
    });

    it('同一主体/客体/动作既 allow 又 deny → 冲突', () => {
      const conflicting = {
        version: 1,
        id: 'x',
        grants: [
          { effect: 'allow', subject: 'h-1', object: 'dp-1', action: 'compute' },
          { effect: 'deny', subject: 'h-1', object: 'dp-1', action: 'compute' },
        ],
      };
      expect(detectConflicts(conflicting as never)).toHaveLength(1);
      try {
        parseUsagePolicy(conflicting);
        throw new Error('should throw');
      } catch (err) {
        expect((err as UsagePolicyError).code).toBe('USAGE_POLICY_CONFLICT');
      }
    });

    it('合法策略可解析，约束被保留', () => {
      const parsed = parseUsagePolicy({
        version: 1,
        id: 'ok',
        grants: [
          {
            effect: 'allow',
            subject: 'h-1',
            object: 'dp-1',
            action: 'compute',
            constraints: { purposes: ['药物警戒'], maxUses: 3 },
            obligations: [{ kind: 'delete-after-use' }],
          },
        ],
      });
      expect(parsed.grants[0].constraints).toEqual({ purposes: ['药物警戒'], maxUses: 3 });
    });
  });

  describe('四态决策', () => {
    it('无匹配 → DEFAULT_DENY', () => {
      expect(decide(policy(), { ...request, object: 'dp-other' })).toMatchObject({
        decision: 'DEFAULT_DENY',
      });
    });

    it('命中 deny → DENY', () => {
      const p = parseUsagePolicy({
        version: 1,
        id: 'x',
        grants: [{ effect: 'deny', subject: 'h-1', object: 'dp-1', action: 'compute' }],
      });
      expect(decide(p, request)).toMatchObject({ decision: 'DENY', reason: '命中拒绝策略' });
    });

    it('目的/时间窗/maxUses/环境 约束不满足 → DENY', () => {
      const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
        [{ purposes: ['药物警戒'] }, { purpose: '科研' }],
        [{ notAfter: '2026-01-01T00:00:00Z' }, {}],
        [{ notBefore: '2027-01-01T00:00:00Z' }, {}],
        [{ maxUses: 2 }, { uses: 3 }],
        [{ environment: 'hardware' }, { environment: 'software' }],
      ];
      for (const [constraints, extra] of cases) {
        const p = policy({
          grants: [
            {
              effect: 'allow',
              subject: 'h-1',
              object: 'dp-1',
              action: 'compute',
              constraints: constraints as never,
            },
          ],
        });
        expect(decide(p, { ...request, ...(extra as object) }).decision).toBe('DENY');
      }
    });

    it('带义务 → ALLOW_WITH_OBLIGATIONS 并返回有序义务', () => {
      const p = policy({
        grants: [
          {
            effect: 'allow',
            subject: 'h-1',
            object: 'dp-1',
            action: 'compute',
            obligations: [{ kind: 'notify-provider' }, { kind: 'delete-after-use' }],
          },
        ],
      });
      const evaluation = decide(p, request);
      expect(evaluation.decision).toBe('ALLOW_WITH_OBLIGATIONS');
      expect(evaluation.obligations.map((o) => o.kind)).toEqual([
        'notify-provider',
        'delete-after-use',
      ]);
    });
  });

  describe('义务执行', () => {
    const obligations: UsageObligation[] = [
      { kind: 'notify-provider' },
      { kind: 'delete-after-use' },
    ];

    it('按声明顺序执行', async () => {
      const calls: string[] = [];
      const result = await runObligations(obligations, request, {
        'notify-provider': () => void calls.push('notify'),
        'delete-after-use': () => void calls.push('delete'),
      });
      expect(result).toEqual({ ok: true, executed: ['notify-provider', 'delete-after-use'] });
      expect(calls).toEqual(['notify', 'delete']);
    });

    it('任一失败即中断，并报告卡在哪一步', async () => {
      const result = await runObligations(obligations, request, {
        'notify-provider': () => {
          throw new Error('通知失败');
        },
        'delete-after-use': () => void 0,
      });
      expect(result).toMatchObject({
        ok: false,
        failedAt: 'notify-provider',
        executed: [],
        error: '通知失败',
      });
    });

    it('未注册处理器 → 失败（不静默跳过）', async () => {
      const result = await runObligations(obligations, request, {
        'notify-provider': () => void 0,
      });
      expect(result).toMatchObject({ ok: false, failedAt: 'delete-after-use' });
    });
  });

  describe('旧合约默认翻译（legacy 语义）', () => {
    const active: ContractView = {
      id: 'c-1',
      purpose: '药物警戒',
      retention: '阅后即焚',
      output: '仅聚合',
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      status: 'active',
      providerId: 'h-1',
      dataProductId: 'dp-1',
    };

    it('有效合约 → ALLOW（不是 DEFAULT_DENY）', () => {
      const evaluation = decide(
        policyFromContract(active),
        requestFromContract(active, { purpose: '药物警戒' }),
      );
      expect(evaluation.decision).toBe('ALLOW');
    });

    it('无合约/失效合约 → DENY（明确拒绝，而非"没规则"）', () => {
      for (const contract of [undefined, { ...active, status: 'revoked' as const }]) {
        const evaluation = decide(
          policyFromContract(contract),
          requestFromContract(contract, { purpose: '药物警戒' }),
        );
        expect(evaluation.decision).toBe('DENY');
      }
    });

    it('目的不符 → DENY', () => {
      const evaluation = decide(
        policyFromContract(active),
        requestFromContract(active, { purpose: '科研' }),
      );
      expect(evaluation.decision).toBe('DENY');
    });
  });
});
