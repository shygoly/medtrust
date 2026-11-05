import { AuditService } from './audit';
import { PolicyEnforcementPoint, PolicyViolation } from './policy-enforcement';
import { ContractView } from './contract-view';
import { decide } from './usage-control/engine';
import { policyFromContract, requestFromContract } from './usage-control/legacy';

const base: ContractView = {
  id: 'c1',
  purpose: '药物警戒',
  retention: '阅后即焚',
  output: '仅聚合',
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  status: 'active',
};
const task = { taskId: 'rws-1', purpose: '药物警戒' };

describe('PolicyEnforcementPoint — PEP 校验 (4.4)', () => {
  let audit: AuditService;
  let pep: PolicyEnforcementPoint;
  beforeEach(() => {
    audit = new AuditService();
    pep = new PolicyEnforcementPoint(audit);
  });

  it('passes an active, matching, unexpired contract', () => {
    expect(() => pep.check(task, base)).not.toThrow();
    expect(audit.all().some((e) => e.action === 'pep-pass')).toBe(true);
  });

  it('denies on purpose mismatch and audits it', () => {
    expect(() => pep.check({ taskId: 'rws-1', purpose: '科研' }, base)).toThrow(PolicyViolation);
    expect(audit.blocked()[0].detail).toContain('目的不符');
  });

  it('任务声明的数据产品必须恰为合约授权的那个:不符即拒并留痕', () => {
    const c = { ...base, dataProductId: 'dp-a' };
    expect(() => pep.check({ ...task, dataProductId: 'dp-a' }, c)).not.toThrow();
    expect(() => pep.check({ ...task, dataProductId: 'dp-b' }, c)).toThrow(PolicyViolation);
    expect(audit.blocked()[0].detail).toMatch(/数据产品不符:合约授权=dp-a,任务声明=dp-b/);
  });

  it('合约没指向数据产品时,任务不能自带一个', () => {
    expect(() => pep.check({ ...task, dataProductId: 'dp-a' }, base)).toThrow(/合约未指向数据产品/);
  });

  it('denies an expired contract', () => {
    const expired = { ...base, validUntil: new Date(Date.now() - 1000).toISOString() };
    expect(() => pep.check(task, expired)).toThrow(/已过期/);
  });

  it('denies a revoked contract', () => {
    expect(() => pep.check(task, { ...base, status: 'revoked' })).toThrow(/已撤销/);
  });

  it('denies when no contract is present', () => {
    expect(() => pep.check(task, undefined)).toThrow(/无生效数字合约/);
  });

  it('denies analysis level beyond contract allowedLevels (L4 on L1.5-only)', () => {
    const limited: ContractView = {
      ...base,
      allowedLevels: ['L1', 'L1.5'],
    };
    expect(() =>
      pep.check({ ...task, level: 'L4', artifacts: ['model_hash'] }, limited),
    ).toThrow(/分析层级越权/);
  });

  it('denies artifact outside contract allowedArtifacts', () => {
    const limited: ContractView = { ...base, allowedArtifacts: ['cohort_count'] };
    expect(() =>
      pep.check({ ...task, artifacts: ['model_hash'] }, limited),
    ).toThrow(/产物越权/);
  });

  it('backfills allow-list from aggregate_only output label and denies L4', () => {
    const aggregateOnly: ContractView = {
      ...base,
      output: '仅聚合统计',
    };
    expect(() =>
      pep.check({ ...task, level: 'L4', artifacts: ['model_hash'] }, aggregateOnly),
    ).toThrow(/分析层级越权|产物越权/);
  });

  it('allows validation_metrics under aggregate_and_model outputPolicy', () => {
    const open: ContractView = {
      ...base,
      output: '聚合 + 模型参数',
      outputPolicy: {
        preset: 'aggregate_and_model',
        allowedArtifacts: ['aggregate_stats', 'validation_metrics', 'model_params', 'model_update'],
        minCell: 10,
        dp: { mode: 'none' },
      },
    };
    expect(() =>
      pep.check(
        { ...task, level: 'L0', artifacts: ['validation_metrics'] },
        open,
      ),
    ).not.toThrow();
  });

  describe('ndi-usage-control-engine 接线（默认 legacy / v1 / shadow）', () => {
    const original = process.env.USAGE_CONTROL_ENGINE;
    afterEach(() => {
      if (original === undefined) delete process.env.USAGE_CONTROL_ENGINE;
      else process.env.USAGE_CONTROL_ENGINE = original;
    });

    const active: ContractView = {
      id: 'c-engine',
      purpose: '药物警戒',
      retention: '阅后即焚',
      output: '仅聚合',
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      status: 'active',
      providerId: 'h-1',
      dataProductId: 'dp-1',
    };
    const localTask = { taskId: 'rws-e', purpose: '药物警戒', dataProductId: 'dp-1' };

    it('缺省 legacy：行为与改造前一致（无 divergence 记录）', () => {
      delete process.env.USAGE_CONTROL_ENGINE;
      expect(() => pep.check(localTask, active)).not.toThrow();
      expect(audit.all().some((e) => e.action === 'usage-control-divergence')).toBe(false);
    });

    it('v1：正常合约照常放行（引擎与 legacy 同结论）', () => {
      process.env.USAGE_CONTROL_ENGINE = 'v1';
      expect(() => pep.check(localTask, active)).not.toThrow();
      expect(audit.all().some((e) => e.action === 'pep-pass')).toBe(true);
    });

    it('shadow：只记录分歧、不改变结论', () => {
      process.env.USAGE_CONTROL_ENGINE = 'shadow';
      expect(() => pep.check(localTask, active)).not.toThrow();
      expect(audit.all().some((e) => e.action === 'pep-pass')).toBe(true);
      expect(audit.all().some((e) => e.action === 'usage-control-divergence')).toBe(false);
    });

    it('未知取值按 legacy 处理（安全侧默认）', () => {
      process.env.USAGE_CONTROL_ENGINE = 'bogus';
      expect(() => pep.check(localTask, active)).not.toThrow();
      expect(audit.all().some((e) => e.action === 'usage-control-divergence')).toBe(false);
    });

    it('等价性：legacy 放行 ⇔ 引擎不拒绝（覆盖多种合约状态）', () => {
      const variants: Array<[string, ContractView | undefined]> = [
        ['active', active],
        ['draft', { ...active, status: 'draft' }],
        ['revoked', { ...active, status: 'revoked' }],
        ['expired', { ...active, validUntil: new Date(Date.now() - 1_000).toISOString() }],
        ['no-policy', { ...active, outputPolicy: undefined, output: '' }],
      ];
      for (const [label, contract] of variants) {
        const localAudit = new AuditService();
        const localPep = new PolicyEnforcementPoint(localAudit);
        let legacyAllowed = true;
        try {
          localPep.check(localTask, contract);
        } catch {
          legacyAllowed = false;
        }
        const evaluation = decide(
          policyFromContract(contract),
          requestFromContract(contract, { purpose: localTask.purpose }),
        );
        const engineDenied = evaluation.decision === 'DENY' || evaluation.decision === 'DEFAULT_DENY';
        expect({ label, legacyAllowed }).toEqual({ label, legacyAllowed: !engineDenied });
      }
    });
  });
});
