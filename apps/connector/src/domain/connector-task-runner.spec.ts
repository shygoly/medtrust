import { AuditService } from './audit';
import { ConnectorTaskRunner } from './connector-task-runner';
import { Deidentifier } from './deidentifier';
import { LocalStore } from './local-store';
import { OutputGate } from './output-gate';
import { PolicyEnforcementPoint } from './policy-enforcement';
import { RetentionEnforcer } from './retention';
import { RwsExecutor } from './rws-executor';
import { TaskScratch } from './task-scratch';
import { ContractView } from './contract-view';
import { InternalRecord } from './types';

const contract = (): ContractView => ({
  id: 'c-l15',
  purpose: '药物警戒',
  retention: '阅后即焚',
  output: '仅聚合',
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  status: 'active',
});

function rec(over: Partial<InternalRecord>): InternalRecord {
  return {
    subjectKey: 'sk_test',
    ageBand: '40-49',
    conditions: [],
    medications: ['目标药'],
    adverseEvents: [],
    ...over,
  };
}

describe('ConnectorTaskRunner — L1.5 disproportionality', () => {
  it('allows L1.5 and applies output gate to 2×2 cells', () => {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    store.ingest([
      rec({ adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
      rec({ adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
      rec({ adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
      rec({ medications: ['对照药'], adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
      rec({ medications: ['对照药'] }),
    ]);

    const runner = new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      new RwsExecutor(store, new Deidentifier()),
      new OutputGate(audit, new Deidentifier()),
      new TaskScratch(),
      new RetentionEnforcer(new TaskScratch(), audit),
    );

    const out = runner.run(
      {
        taskId: 'rws-l15-1',
        purpose: '药物警戒',
        workloadType: 'rws',
        analysis: { type: 'disproportionality', level: 'L1.5', drug: '目标药' },
      },
      contract(),
    );

    expect(out.analysisType).toBe('disproportionality');
    const alt = out.buckets.find((b) => b.key === 'ALT升高')!;
    expect(alt.suppressed).toBe(true);
    expect(alt.count).toBe(0);
    expect(alt.b).toBe(0);
    expect(alt.c).toBe(0);
    expect(alt.d).toBe(0);
  });

  it('runs L2 comparative-effect through output gate', () => {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    store.ingest([
      rec({ ageBand: '40-49', adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
      rec({ ageBand: '40-49', adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
      rec({ ageBand: '40-49', adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
      rec({ ageBand: '40-49', adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
      rec({ ageBand: '40-49', adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
      rec({ ageBand: '40-49' }),
      rec({ medications: ['对照药'], adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
      rec({ medications: ['对照药'] }),
    ]);

    const runner = new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      new RwsExecutor(store, new Deidentifier()),
      new OutputGate(audit, new Deidentifier()),
      new TaskScratch(),
      new RetentionEnforcer(new TaskScratch(), audit),
    );

    const out = runner.run(
      {
        taskId: 'rws-l2-1',
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
      contract(),
    );

    expect(out.analysisType).toBe('comparative-effect');
    expect(out.effectEstimate?.beta).toBeDefined();
    expect(out.effectEstimate?.mantelHaenszel?.or).toBeGreaterThan(0);
    expect(JSON.stringify(out)).not.toContain('subjectKey');
  });

  it('rejects L2 with non-comparative analysis type', () => {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    const runner = new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      new RwsExecutor(store, new Deidentifier()),
      new OutputGate(audit, new Deidentifier()),
      new TaskScratch(),
      new RetentionEnforcer(new TaskScratch(), audit),
    );

    expect(() =>
      runner.run(
        {
          taskId: 'rws-l2',
          purpose: '药物警戒',
          workloadType: 'rws',
          analysis: { type: 'cohort-count', level: 'L2' },
        },
        contract(),
      ),
    ).toThrow('comparative-effect');
  });
});

describe('ConnectorTaskRunner — L3 causal', () => {
  const tte = {
    exposureArm: 'drug:目标药',
    comparatorArm: 'drug:对照药',
    timeZeroRule: 'index_date',
    inclusion: ['age>=18'],
    exclusion: [],
    outcome: { type: 'time_to_event' as const, event: 'renal_failure' },
  };

  it('runs L3 causal-psm through output gate', () => {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    store.ingest([
      rec({ followUpDays: 400, eventOccurred: true }),
      rec({ subjectKey: 'sk_2', followUpDays: 380, eventOccurred: true }),
      rec({ subjectKey: 'sk_3', followUpDays: 360, eventOccurred: false }),
      rec({ subjectKey: 'sk_4', followUpDays: 340, eventOccurred: false }),
      rec({ subjectKey: 'sk_5', followUpDays: 320, eventOccurred: true }),
      rec({ subjectKey: 'sk_6', medications: ['对照药'], followUpDays: 200, eventOccurred: false }),
      rec({ subjectKey: 'sk_7', medications: ['对照药'], followUpDays: 220, eventOccurred: false }),
    ]);

    const runner = new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      new RwsExecutor(store, new Deidentifier()),
      new OutputGate(audit, new Deidentifier()),
      new TaskScratch(),
      new RetentionEnforcer(new TaskScratch(), audit),
    );

    const out = runner.run(
      {
        taskId: 'rws-l3-1',
        purpose: '药物警戒',
        workloadType: 'rws',
        analysis: {
          type: 'causal-psm',
          level: 'L3',
          tte,
          allowedArtifacts: ['effect_estimate'],
        },
      },
      contract(),
    );

    expect(out.analysisType).toBe('causal-psm');
    expect(out.effectEstimate?.measure).toBe('ate');
    expect(JSON.stringify(out)).not.toContain('subjectKey');
  });

  it('rejects L3 with non-causal analysis type', () => {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    const runner = new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      new RwsExecutor(store, new Deidentifier()),
      new OutputGate(audit, new Deidentifier()),
      new TaskScratch(),
      new RetentionEnforcer(new TaskScratch(), audit),
    );

    expect(() =>
      runner.run(
        {
          taskId: 'rws-l3-bad',
          purpose: '药物警戒',
          workloadType: 'rws',
          analysis: { type: 'cohort-count', level: 'L3' },
        },
        contract(),
      ),
    ).toThrow('causal-psm');
  });
});
