import { FlPredictionTaskSpec } from './fl-prediction-task-spec';
import { HttpFlAdapter } from './http-fl-adapter';
import { hashFlPredictionSpec } from './mock-fl-adapter';

const spec: FlPredictionTaskSpec = {
  purpose: 'CKD FL',
  federationMode: 'horizontal',
  modality: 'structured_ehr',
  parties: [
    { participantId: 'p-demohospa', role: 'provider', dataProductId: 'dp-1' },
    { participantId: 'p-demohospb', role: 'provider', dataProductId: 'dp-2' },
  ],
  modelType: 'logistic_regression',
  objective: 'binary',
  targetColumn: 'label',
  featureColumns: [{ name: 'f1', dtype: 'numeric' }],
  aggregation: 'fedavg',
  rounds: 3,
  outputPolicy: { allowedArtifacts: ['auc', 'model_hash'] },
};

describe('HttpFlAdapter', () => {
  it('calls connector-ml /v1/fl/train and returns safe party result', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        taskId: 't-http',
        participantId: 'p-demohospa',
        roundsCompleted: 3,
        sampleCount: 40,
        localModelHash: 'LOCAL:abc123',
        localMetrics: { auc: 0.81, f1: 0.72 },
      }),
    });

    const adapter = new HttpFlAdapter({ baseUrl: 'http://127.0.0.1:5030', fetchImpl });
    const prepared = {
      taskId: 't-http',
      specHash: hashFlPredictionSpec('t-http', spec),
      participantId: 'p-demohospa',
      sampleCount: 40,
      modelType: 'logistic_regression',
      preparedAt: new Date(0).toISOString(),
    };

    const result = await adapter.run(prepared, spec, {
      taskId: 't-http',
      spec,
      participantId: 'p-demohospa',
      sampleCount: 40,
      tabularRows: [{ f1: 1, label: true }],
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:5030/v1/fl/train',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.localMetrics.auc).toBe(0.81);
  });

  it('reports environment not ready when health check fails', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const adapter = new HttpFlAdapter({ baseUrl: 'http://127.0.0.1:5030', fetchImpl });
    const env = await adapter.validateEnvironmentAsync();
    expect(env.ready).toBe(false);
  });
});
