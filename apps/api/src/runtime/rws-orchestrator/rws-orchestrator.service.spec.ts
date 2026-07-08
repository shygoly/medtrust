import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RwsAdmissionService } from './rws-admission.service';
import { RwsOrchestratorService } from './rws-orchestrator.service';
import { ContractService } from '../digital-contract/contract.service';
import { mockRepo } from '../test-utils/mock-repo';
import { RwsAssignmentEntity, RwsTaskEntity } from '@medtrust/database';

describe('RwsAdmissionService', () => {
  let admission: RwsAdmissionService;
  const contracts = {
    get: jest.fn(),
    effectiveStatus: jest.fn().mockReturnValue('active'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    admission = new RwsAdmissionService(contracts as unknown as ContractService);
  });

  it('admits active contracts for consumer + purpose', async () => {
    contracts.get.mockResolvedValue({
      id: 'c1',
      providerId: 'p-ruijin',
      consumerId: 'p-meddata',
      purpose: '慢病真实世界研究',
      status: 'active',
    });
    const out = await admission.admit(['c1'], 'p-meddata', '慢病真实世界研究');
    expect(out).toHaveLength(1);
  });

  it('denies purpose mismatch', async () => {
    contracts.get.mockResolvedValue({
      id: 'c1',
      providerId: 'p-ruijin',
      consumerId: 'p-meddata',
      purpose: '药物警戒',
      status: 'active',
    });
    await expect(admission.admit(['c1'], 'p-meddata', '慢病真实世界研究')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('RwsOrchestratorService', () => {
  let orchestrator: RwsOrchestratorService;
  const contracts = {
    get: jest.fn(),
    effectiveStatus: jest.fn().mockReturnValue('active'),
  };
  const admission = {
    admit: jest.fn(),
  };
  const taskRepo = mockRepo<RwsTaskEntity>();
  const assignmentRepo = mockRepo<RwsAssignmentEntity>();

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new RwsOrchestratorService(
      admission as unknown as RwsAdmissionService,
      contracts as unknown as ContractService,
      taskRepo,
      assignmentRepo,
    );
  });

  it('pull → complete merges aggregates', async () => {
    admission.admit.mockResolvedValue([
      {
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
    ]);

    const record = await orchestrator.submit({
      purpose: 'PV',
      analysis: { type: 'cohort-count' },
      contractIds: ['c1'],
      consumerId: 'p-meddata',
    });

    const pending = await orchestrator.pullPending('p-ruijin');
    expect(pending).toHaveLength(1);

    const done = await orchestrator.completeAssignment(pending[0].assignmentId, 'p-ruijin', {
      aggregate: {
        analysisType: 'cohort-count',
        cohortSize: 10,
        buckets: [{ key: '30-39', count: 10, rate: 1 }],
      },
    });

    expect(done.status).toBe('completed');
    expect(done.merged?.cohortSize).toBe(10);

    const persisted = await orchestrator.get(record.taskId);
    expect(persisted.status).toBe('completed');
    expect(persisted.merged?.cohortSize).toBe(10);
  });

  it('rejects completion from wrong provider', async () => {
    admission.admit.mockResolvedValue([
      {
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
    ]);
    await orchestrator.submit({
      purpose: 'PV',
      analysis: { type: 'cohort-count' },
      contractIds: ['c1'],
      consumerId: 'p-meddata',
    });
    const pending = await orchestrator.pullPending('p-ruijin');
    await expect(
      orchestrator.completeAssignment(pending[0].assignmentId, 'p-huashan', {
        aggregate: { analysisType: 'cohort-count', cohortSize: 1, buckets: [] },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
