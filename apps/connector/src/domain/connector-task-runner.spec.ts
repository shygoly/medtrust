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
import { AlgorithmValidationExecutor } from './algorithm-validation-executor';
import { LocalGoldStandardStore } from './local-gold-standard-store';
import { SoftwareSealedCompute } from './tee';

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
  it('allows L1.5 and applies output gate to 2×2 cells', async () => {
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

    const out = await runner.run(
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

  it('runs L2 comparative-effect through output gate', async () => {
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

    const out = await runner.run(
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

  it('rejects L2 with non-comparative analysis type', async () => {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    const runner = new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      new RwsExecutor(store, new Deidentifier()),
      new OutputGate(audit, new Deidentifier()),
      new TaskScratch(),
      new RetentionEnforcer(new TaskScratch(), audit),
    );

    await expect(
      runner.run(
        {
          taskId: 'rws-l2',
          purpose: '药物警戒',
          workloadType: 'rws',
          analysis: { type: 'cohort-count', level: 'L2' },
        },
        contract(),
      ),
    ).rejects.toThrow('comparative-effect');
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

  it('runs L3 causal-psm through output gate', async () => {
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

    const out = await runner.run(
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

  it('rejects L3 with non-causal analysis type', async () => {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    const runner = new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      new RwsExecutor(store, new Deidentifier()),
      new OutputGate(audit, new Deidentifier()),
      new TaskScratch(),
      new RetentionEnforcer(new TaskScratch(), audit),
    );

    await expect(
      runner.run(
        {
          taskId: 'rws-l3-bad',
          purpose: '药物警戒',
          workloadType: 'rws',
          analysis: { type: 'cohort-count', level: 'L3' },
        },
        contract(),
      ),
    ).rejects.toThrow('causal-psm');
  });
});

describe('ConnectorTaskRunner — L0 algorithm-validation', () => {
  const l0Contract = (): ContractView => ({
    id: 'c-l0',
    purpose: '算法验证',
    retention: '阅后即焚',
    output: '仅聚合',
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    status: 'active',
    providerId: 'hospital-a',
    allowedLevels: ['L0'],
    allowedArtifacts: ['validation_metrics'],
  });

  // Algorithm: "subject has E11.9 (DM2) as a discharge diagnosis".
  const dm2Algo = {
    id: 'dm2-dx',
    version: '1.0.0',
    expression: {
      kind: 'codeset' as const,
      codeset: {
        codeSystem: 'ICD-10',
        codeSystemVersion: '2023',
        codes: ['E11.9'],
        valueSource: 'discharge_dx' as const,
        diagnosisOrder: 'any' as const,
      },
    },
  };

  function l0Runner(audit: AuditService, store: LocalStore, gold: LocalGoldStandardStore) {
    return new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      new RwsExecutor(store, new Deidentifier()),
      new OutputGate(audit, new Deidentifier()),
      new TaskScratch(),
      new RetentionEnforcer(new TaskScratch(), audit),
      undefined,
      store,
      undefined,
      new AlgorithmValidationExecutor(store, new OutputGate(audit, new Deidentifier()), gold, new SoftwareSealedCompute()),
    );
  }

  it('runs the L0 closed loop: PEP → grammar → eval → compare → gate', async () => {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    // 10 subjects with E11.9 (algorithm positive), 10 without.
    const rows: InternalRecord[] = [];
    for (let i = 0; i < 10; i++) rows.push(rec({ subjectKey: `pos-${i}`, conditions: ['E11.9'] }));
    for (let i = 0; i < 10; i++) rows.push(rec({ subjectKey: `neg-${i}`, conditions: ['I10'] }));
    store.ingest(rows);

    const gold = new LocalGoldStandardStore();
    // Gold standard agrees with the algorithm → TP=10, TN=10, FP=0, FN=0.
    // But FP=0 and FN=0 are below the suppression threshold of 5, so the
    // result MUST be suppressed (all-or-nothing, D3).
    gold.ingestLabels('dm2', 'gs-v1', [
      ...Array.from({ length: 10 }, (_, i) => [`pos-${i}`, 'positive'] as [string, 'positive']),
      ...Array.from({ length: 10 }, (_, i) => [`neg-${i}`, 'negative'] as [string, 'negative']),
    ]);

    const runner = l0Runner(audit, store, gold);
    const out = await runner.run(
      {
        taskId: 'rws-l0-1',
        purpose: '算法验证',
        workloadType: 'rws',
        analysis: {
          type: 'algorithm-validation',
          level: 'L0',
          algorithm: dm2Algo,
          variableDefinitionId: 'dm2',
          goldStandardSetVersion: 'gs-v1',
          allowedArtifacts: ['validation_metrics'],
        },
      },
      l0Contract(),
    );

    expect(out.analysisType).toBe('algorithm-validation');
    expect(out.validationResult).toBeDefined();
    // Perfect accuracy → FP=0/FN=0 < threshold(5) → suppressed.
    expect(out.validationResult!.suppressed).toBe(true);
    expect(out.validationResult!.suppressionReason).toBe('insufficient_sample');
    expect(out.validationResult!.metrics).toBeUndefined();
    // The audit log records the suppression.
    expect(audit.all().some((e) => e.action === 'validation-suppressed')).toBe(true);
  });

  it('releases metrics when every confusion-matrix cell ≥ threshold', async () => {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    // Build a confusion matrix with all cells ≥ 5.
    //   TP=10 (algorithm pos, gold pos)
    //   FP=8  (algorithm pos, gold neg)
    //   FN=7  (algorithm neg, gold pos)
    //   TN=10 (algorithm neg, gold neg)
    const posCond = ['E11.9'];
    const negCond = ['I10'];
    const rows: InternalRecord[] = [];
    for (let i = 0; i < 10; i++) rows.push(rec({ subjectKey: `tp-${i}`, conditions: posCond }));
    for (let i = 0; i < 8; i++) rows.push(rec({ subjectKey: `fp-${i}`, conditions: posCond }));
    for (let i = 0; i < 7; i++) rows.push(rec({ subjectKey: `fn-${i}`, conditions: negCond }));
    for (let i = 0; i < 10; i++) rows.push(rec({ subjectKey: `tn-${i}`, conditions: negCond }));
    store.ingest(rows);

    const gold = new LocalGoldStandardStore();
    gold.ingestLabels('dm2', 'gs-v1', [
      ...Array.from({ length: 10 }, (_, i) => [`tp-${i}`, 'positive'] as [string, 'positive']),
      ...Array.from({ length: 8 }, (_, i) => [`fp-${i}`, 'negative'] as [string, 'negative']),
      ...Array.from({ length: 7 }, (_, i) => [`fn-${i}`, 'positive'] as [string, 'positive']),
      ...Array.from({ length: 10 }, (_, i) => [`tn-${i}`, 'negative'] as [string, 'negative']),
    ]);

    const runner = l0Runner(audit, store, gold);
    const out = await runner.run(
      {
        taskId: 'rws-l0-2',
        purpose: '算法验证',
        workloadType: 'rws',
        analysis: {
          type: 'algorithm-validation',
          level: 'L0',
          algorithm: dm2Algo,
          variableDefinitionId: 'dm2',
          goldStandardSetVersion: 'gs-v1',
        },
      },
      l0Contract(),
    );

    const vr = out.validationResult!;
    expect(vr.suppressed).toBe(false);
    expect(vr.metrics).toBeDefined();
    expect(vr.confusionMatrix).toEqual({ tp: 10, fp: 8, tn: 10, fn: 7 });
    expect(vr.metrics!.sensitivity.point).toBeCloseTo(10 / 17, 3);
    expect(vr.metrics!.specificity.point).toBeCloseTo(10 / 18, 3);
    // Attestation level is propagated from the TEE.
    expect(vr.attestationLevel).toBe('software');
  });

  it('fails when no gold standard is loaded for the variable (MUST NOT use algorithm output)', async () => {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    store.ingest([rec({ subjectKey: 's1', conditions: ['E11.9'] })]);
    const gold = new LocalGoldStandardStore(); // empty

    const runner = l0Runner(audit, store, gold);
    await expect(
      runner.run(
        {
          taskId: 'rws-l0-nogold',
          purpose: '算法验证',
          workloadType: 'rws',
          analysis: {
            type: 'algorithm-validation',
            level: 'L0',
            algorithm: dm2Algo,
            variableDefinitionId: 'dm2',
          },
        },
        l0Contract(),
      ),
    ).rejects.toThrow(/无金标准标注/);
  });

  it('rejects an algorithm definition that violates the closed grammar (CTL-10)', async () => {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    const gold = new LocalGoldStandardStore();
    gold.ingestLabels('dm2', 'v1', [['s1', 'positive']]);

    const runner = l0Runner(audit, store, gold);
    await expect(
      runner.run(
        {
          taskId: 'rws-l0-injection',
          purpose: '算法验证',
          workloadType: 'rws',
          analysis: {
            type: 'algorithm-validation',
            level: 'L0',
            algorithm: {
              id: 'evil',
              version: '1',
              // inline-script injection attempt
              expression: { kind: 'codeset', source: 'process.env.STEAL', codeset: {} },
            } as never,
            variableDefinitionId: 'dm2',
          },
        },
        l0Contract(),
      ),
    ).rejects.toThrow(/forbidden key "source"/);
  });

  it('L0 does NOT change existing L1.5–L4 behavior (regression guard)', async () => {
    // A plain L1.5 task must still work after L0 is wired in.
    const audit = new AuditService();
    const store = new LocalStore(audit);
    store.ingest([
      rec({ adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
      rec({ adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
      rec({ adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }] }),
      rec({ medications: ['对照药'] }),
      rec({ medications: ['对照药'] }),
    ]);
    // Pass an L0 executor in the optional slot — L1.5 must not call it.
    const runner = new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      new RwsExecutor(store, new Deidentifier()),
      new OutputGate(audit, new Deidentifier()),
      new TaskScratch(),
      new RetentionEnforcer(new TaskScratch(), audit),
      undefined,
      store,
      undefined,
      new AlgorithmValidationExecutor(store, new OutputGate(audit, new Deidentifier()), new LocalGoldStandardStore()),
    );

    const out = await runner.run(
      {
        taskId: 'rws-l15-after-l0',
        purpose: '药物警戒',
        workloadType: 'rws',
        analysis: { type: 'disproportionality', level: 'L1.5', drug: '目标药' },
      },
      {
        id: 'c',
        purpose: '药物警戒',
        retention: '阅后即焚',
        output: '仅聚合',
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        status: 'active',
      },
    );
    expect(out.analysisType).toBe('disproportionality');
    expect(out.validationResult).toBeUndefined();
  });
});
