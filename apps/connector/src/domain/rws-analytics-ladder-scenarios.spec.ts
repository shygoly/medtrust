/**
 * OpenSpec rws-analytics-ladder 组7.1 — 连接器侧 scenario 覆盖.
 * 锚点: specs/rws-compute, specs/usage-control
 */
import { AuditService } from './audit';
import { ConnectorTaskRunner } from './connector-task-runner';
import { Deidentifier } from './deidentifier';
import { LocalStore } from './local-store';
import { OutputGate } from './output-gate';
import { PolicyEnforcementPoint, PolicyViolation } from './policy-enforcement';
import { RetentionEnforcer } from './retention';
import { createTestMdopExecutor } from '../test/mdop-local-executor';
import { TaskScratch } from './task-scratch';
import { ContractView } from './contract-view';
import { InternalRecord } from './types';
import { FlTaskRunner } from './fl-prediction/fl-task-runner';
import { ckdEsrdRiskFlPredictionSpec } from './fl-prediction/fl-prediction-task-spec';

const pvContract = (): ContractView => ({
  id: 'c-pv',
  purpose: '药物警戒',
  retention: '阅后即焚',
  output: '仅聚合',
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  status: 'active',
  allowedLevels: ['L1', 'L1.5', 'L2', 'L3'],
  allowedArtifacts: ['disproportionality', 'effect_estimate', 'hazard_ratio', 'km_curve'],
});

const pvOnlyContract = (): ContractView => ({
  ...pvContract(),
  allowedLevels: ['L1', 'L1.5'],
});

function runnerPair() {
  const audit = new AuditService();
  const store = new LocalStore(audit);
  const deid = new Deidentifier();
  const scratch = new TaskScratch();
  const r = new ConnectorTaskRunner(
    new PolicyEnforcementPoint(audit),
    createTestMdopExecutor({ id: 'spec-ladder-scenarios', store, localL15: true }),
    new OutputGate(audit, deid),
    scratch,
    new RetentionEnforcer(scratch, audit),
  );
  return { audit, store, r };
}

function rec(over: Partial<InternalRecord>): InternalRecord {
  return {
    subjectKey: 'sk',
    ageBand: '50-59',
    sex: 'F',
    conditions: [],
    medications: ['目标药'],
    adverseEvents: [],
    ...over,
  };
}

describe('rws-analytics-ladder scenarios (connector)', () => {
  describe('rws-compute: L1.5 失衡信号仅出列联表', () => {
    it('outputs 2×2 cells without subjectKey', async () => {
      const { store, r } = runnerPair();
      store.ingest([
        rec({ adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
        rec({ adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
        rec({ medications: ['对照药'] }),
      ]);
      const out = await r.run(
        {
          taskId: 'l15-1',
          purpose: '药物警戒',
          workloadType: 'rws',
          analysis: {
            type: 'disproportionality',
            level: 'L1.5',
            drug: '目标药',
            designType: 'cross-sectional',
            rationale: 'L1.5 失衡检测输出结构场景验证',
          },
        },
        pvContract(),
      );
      expect(out.analysisType).toBe('disproportionality');
      expect(out.buckets.some((b) => b.b !== undefined)).toBe(true);
      expect(JSON.stringify(out)).not.toContain('subjectKey');
    });
  });

  describe('rws-compute: L2 比较仅出效应量', () => {
    it('outputs stratified effect estimate without row-level data', async () => {
      const { store, r } = runnerPair();
      for (let i = 0; i < 8; i++) {
        store.ingest([
          rec({ ageBand: '40-49', adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
          rec({ ageBand: '40-49' }),
          rec({ medications: ['对照药'], adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
          rec({ medications: ['对照药'] }),
        ]);
      }
      const out = await r.run(
        {
          taskId: 'l2-1',
          purpose: '药物警戒',
          workloadType: 'rws',
          analysis: {
            type: 'comparative-effect',
            level: 'L2',
            drug: '目标药',
            outcome: 'ALT升高',
            allowedArtifacts: ['effect_estimate'],
          },
        },
        pvContract(),
      );
      expect(out.effectEstimate?.beta).toBeDefined();
      expect(JSON.stringify(out)).not.toContain('subjectKey');
    });
  });

  describe('rws-compute: L3 因果仅出站点效应量', () => {
    const tte = {
      exposureArm: 'drug:目标药',
      comparatorArm: 'drug:对照药',
      timeZeroRule: 'index_date',
      inclusion: ['age>=18'],
      exclusion: [],
      outcome: { type: 'time_to_event' as const, event: 'renal_failure' },
    };

    it('outputs ATE envelope from causal-psm', async () => {
      const { store, r } = runnerPair();
      for (let i = 0; i < 6; i++) {
        store.ingest([
          rec({ followUpDays: 400, eventOccurred: true }),
          rec({ medications: ['对照药'], followUpDays: 200, eventOccurred: false }),
        ]);
      }
      const out = await r.run(
        {
          taskId: 'l3-1',
          purpose: '药物警戒',
          workloadType: 'rws',
          analysis: { type: 'causal-psm', level: 'L3', tte, allowedArtifacts: ['effect_estimate'] },
        },
        pvContract(),
      );
      expect(out.analysisType).toBe('causal-psm');
      expect(out.effectEstimate?.measure).toBe('ate');
      expect(JSON.stringify(out)).not.toContain('subjectKey');
    });
  });

  describe('usage-control: 分析分级授权', () => {
    it('rejects L4 when contract allows only up to L1.5', async () => {
      const audit = new AuditService();
      const pep = new PolicyEnforcementPoint(audit);
      const spec = ckdEsrdRiskFlPredictionSpec();
      process.env.CONNECTOR_PARTICIPANT_ID = 'p-demohospa';
      const fl = new FlTaskRunner(pep);
      await expect(
        fl.run('fl-bad', spec.purpose, spec, {
          ...pvOnlyContract(),
          purpose: spec.purpose,
          dataProductId: 'dp-insulin-panc-demohospa',
        }),
      ).rejects.toThrow(PolicyViolation);
    });
  });
});
