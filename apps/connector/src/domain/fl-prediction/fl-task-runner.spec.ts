import { AuditService } from '../audit';
import { ConnectorTaskRunner } from '../connector-task-runner';
import { LocalStore } from '../local-store';
import { PolicyEnforcementPoint } from '../policy-enforcement';
import { ContractView } from '../contract-view';
import { ckdEsrdRiskFlPredictionSpec } from './fl-prediction-task-spec';
import { FlTaskRunner } from './fl-task-runner';
import { HttpFlAdapter } from './http-fl-adapter';

const activeContract = (): ContractView => ({
  id: 'contract-fl-1',
  purpose: '胰岛素暴露·胰腺炎信号演示研究',
  retention: '阅后即焚',
  // L4 FL 产出模型 + 聚合指标，须走 model 出口授权（aggregate_only 会拒 L4）。
  output: '聚合 + 模型参数',
  outputPolicy: {
    preset: 'aggregate_and_model',
    allowedArtifacts: ['aggregate_stats', 'validation_metrics', 'model_params', 'model_update'],
    minCell: 5,
    dp: { mode: 'none' },
  },
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  status: 'active',
  dataProductId: 'dp-insulin-panc-huashan',
});

describe('FlTaskRunner', () => {
  const originalParticipant = process.env.CONNECTOR_PARTICIPANT_ID;

  afterEach(() => {
    if (originalParticipant === undefined) {
      delete process.env.CONNECTOR_PARTICIPANT_ID;
    } else {
      process.env.CONNECTOR_PARTICIPANT_ID = originalParticipant;
    }
  });

  it('returns party-local FL result after PEP check', async () => {
    process.env.CONNECTOR_PARTICIPANT_ID = 'p-huashan';
    const audit = new AuditService();
    const runner = new FlTaskRunner(new PolicyEnforcementPoint(audit));
    const spec = ckdEsrdRiskFlPredictionSpec();

    const result = await runner.run('fl-task-1', spec.purpose, spec, activeContract());

    expect(result.workloadType).toBe('federated_learning');
    expect(result.taskId).toBe('fl-task-1');
    expect(result.participantId).toBe('p-huashan');
    expect(result.localModelHash).toMatch(/^LOCAL:/);
    expect(result.localMetrics.auc).toBeGreaterThan(0);
    expect(result.roundsCompleted).toBe(spec.rounds);
  });

  it('passes materialized CKD tabular rows to connector-ml', async () => {
    process.env.CONNECTOR_PARTICIPANT_ID = 'p-huashan';
    const audit = new AuditService();
    const store = new LocalStore(audit);
    store.ingest([
      {
        subjectKey: 'subj-a',
        ageBand: '50-59',
        conditions: ['Chronic kidney disease stage 3 (disorder)', 'Essential hypertension (disorder)'],
        medications: [],
        adverseEvents: [],
      },
      {
        subjectKey: 'subj-b',
        ageBand: '60-69',
        conditions: ['Chronic kidney disease stage 5 (disorder)'],
        medications: [],
        adverseEvents: [],
      },
    ]);

    const fetchImpl = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/v1/fl/environment')) {
        return {
          ok: true,
          json: async () => ({ ready: true, runtime: 'connector-ml', details: 'test' }),
        };
      }
      const body = JSON.parse(String(init?.body));
      expect(body.tabularRows.length).toBeGreaterThanOrEqual(2);
      expect(body.tabularRows[0]).toHaveProperty('egfr');
      expect(body.tabularRows[0]).toHaveProperty('esrd_event');
      return {
        ok: true,
        json: async () => ({
          taskId: body.prepared.taskId,
          participantId: body.prepared.participantId,
          roundsCompleted: 5,
          sampleCount: body.tabularRows.length,
          localModelHash: 'LOCAL:sklearn-train',
          localMetrics: { auc: 0.79, f1: 0.71 },
        }),
      };
    });

    const adapter = new HttpFlAdapter({ baseUrl: 'http://127.0.0.1:5030', fetchImpl });
    const runner = new FlTaskRunner(new PolicyEnforcementPoint(audit), adapter, undefined, store);
    const spec = ckdEsrdRiskFlPredictionSpec();

    const result = await runner.run('fl-task-http', spec.purpose, spec, activeContract());
    expect(fetchImpl).toHaveBeenCalled();
    expect(result.dpApplied).toBe(true);
    expect(result.localMetrics.auc).toBeGreaterThan(0);
    expect(result.localMetrics.auc).toBeLessThanOrEqual(1);
    expect(result.sampleCount).toBe(2);
  });

  it('rejects invalid flPredictionSpec', async () => {
    process.env.CONNECTOR_PARTICIPANT_ID = 'p-huashan';
    const audit = new AuditService();
    const runner = new FlTaskRunner(new PolicyEnforcementPoint(audit));

    await expect(
      runner.run('fl-task-2', 'CKD', { parties: [] }, activeContract()),
    ).rejects.toThrow('FL prediction workload requires a valid flPredictionSpec');
  });

  it('rejects when CONNECTOR_PARTICIPANT_ID is missing', async () => {
    delete process.env.CONNECTOR_PARTICIPANT_ID;
    const audit = new AuditService();
    const runner = new FlTaskRunner(new PolicyEnforcementPoint(audit));
    const spec = ckdEsrdRiskFlPredictionSpec();

    await expect(runner.run('fl-task-3', spec.purpose, spec, activeContract())).rejects.toThrow(
      'CONNECTOR_PARTICIPANT_ID is required for FL prediction workload',
    );
  });
});

describe('ConnectorTaskRunner — FL prediction routing', () => {
  it('rejects sync run for federated_learning workloads', async () => {
    const audit = new AuditService();
    const connectorRunner = new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const spec = ckdEsrdRiskFlPredictionSpec();

    await expect(
      connectorRunner.run(
        {
          taskId: 'fl-task-4',
          purpose: spec.purpose,
          workloadType: 'federated_learning',
          flPredictionSpec: spec,
        },
        activeContract(),
      ),
    ).rejects.toThrow('FL prediction workload is async');
  });
});
