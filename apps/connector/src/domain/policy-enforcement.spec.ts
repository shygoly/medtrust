import { AuditService } from './audit';
import { PolicyEnforcementPoint, PolicyViolation } from './policy-enforcement';
import { ContractView } from './contract-view';

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
});
