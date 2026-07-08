import { ConnectorWorkerService } from './connector-worker.service';
import { TaskProgressReporter } from './task-progress-reporter';
import { ControlPlaneClient } from './control-plane-client';
import { ConnectorTaskRunner } from './connector-task-runner';
import { DataProductLocalSource } from './data-product-local-source';

describe('ConnectorWorkerService', () => {
  it('prefetches catalog, runs task, completes assignment', async () => {
    const controlPlane = {
      getParticipantId: () => 'p-ruijin',
      prefetchCatalogProduct: jest.fn().mockResolvedValue({
        id: 'dp1',
        providerId: 'p-ruijin',
        fhirSchema: { localDataPath: 'data/synthea/ingested-clinical-text' },
      }),
      pullPendingRws: jest.fn().mockResolvedValue([
        {
          assignmentId: 'a1',
          taskId: 't1',
          purpose: 'PV',
          workloadType: 'rws',
          analysis: { type: 'cohort-count' },
          contract: {
            id: 'c1',
            dataProductId: 'dp1',
            providerId: 'p-ruijin',
            consumerId: 'p-meddata',
            purpose: 'PV',
            retention: '阅后即焚',
            output: '仅聚合',
            validUntil: new Date(Date.now() + 86_400_000).toISOString(),
            status: 'active',
          },
        },
      ]),
      completeAssignment: jest.fn().mockResolvedValue(undefined),
      reportProgress: jest.fn().mockResolvedValue(undefined),
    };

    const productSource = {
      registerProduct: jest.fn(),
    };

    const runner = {
      run: jest.fn().mockReturnValue({
        analysisType: 'cohort-count',
        cohortSize: 5,
        buckets: [],
      }),
    };

    const progress = { bind: jest.fn(), clear: jest.fn(), stage: jest.fn() };

    const worker = new ConnectorWorkerService(
      controlPlane as unknown as ControlPlaneClient,
      productSource as unknown as DataProductLocalSource,
      runner as unknown as ConnectorTaskRunner,
      progress as unknown as TaskProgressReporter,
    );

    await worker.pollOnce();

    expect(controlPlane.prefetchCatalogProduct).toHaveBeenCalledWith('dp1');
    expect(productSource.registerProduct).toHaveBeenCalled();
    expect(runner.run).toHaveBeenCalled();
    expect(controlPlane.completeAssignment).toHaveBeenCalledWith('a1', expect.objectContaining({ aggregate: expect.any(Object) }));
  });
});
