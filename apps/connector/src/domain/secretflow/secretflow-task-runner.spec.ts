import { AuditService } from '../audit';
import { ConnectorTaskRunner } from '../connector-task-runner';
import { PolicyEnforcementPoint } from '../policy-enforcement';
import { ContractView } from '../contract-view';
import { SecretFlowTaskSpec } from './secretflow-task-spec';
import { SecretFlowTaskRunner } from './secretflow-task-runner';

function minimalSecretFlowSpec(): SecretFlowTaskSpec {
  return {
    parties: [{ participantId: 'hospital-a', role: 'provider' }],
    modalities: [{ type: 'clinical_text' }],
    llmBackbone: { modelType: 'llm', modelNameOrPath: 'mock/backbone' },
    peftStrategy: { type: 'lora', r: 8, alpha: 16, targetModules: ['q_proj'] },
    privacy: { teeRequired: true, heuEnabled: false },
    outputPolicy: { allowedArtifacts: ['lora_delta_hash', 'aggregate_metrics'] },
  };
}

const activeContract = (): ContractView => ({
  id: 'contract-sf-1',
  purpose: '多模态机密训练',
  retention: '阅后即焚',
  output: '仅聚合',
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  status: 'active',
});

describe('SecretFlowTaskRunner', () => {
  it('accepts a valid secretflow workload after PEP check', () => {
    const audit = new AuditService();
    const runner = new SecretFlowTaskRunner(new PolicyEnforcementPoint(audit));
    const spec = minimalSecretFlowSpec();

    const result = runner.run('sf-task-1', '多模态机密训练', spec, activeContract());

    expect(result).toEqual({
      workloadType: 'secretflow',
      taskId: 'sf-task-1',
      status: 'accepted',
    });
  });

  it('rejects invalid secretflowSpec', () => {
    const audit = new AuditService();
    const runner = new SecretFlowTaskRunner(new PolicyEnforcementPoint(audit));

    expect(() =>
      runner.run('sf-task-2', '多模态机密训练', { parties: [] }, activeContract()),
    ).toThrow('SecretFlow workload requires a valid secretflowSpec');
  });
});

describe('ConnectorTaskRunner — workload routing', () => {
  it('routes secretflow workloads to SecretFlowTaskRunner', () => {
    const audit = new AuditService();
    const pep = new PolicyEnforcementPoint(audit);
    const connectorRunner = new ConnectorTaskRunner(
      pep,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = connectorRunner.run(
      {
        taskId: 'sf-task-3',
        purpose: '多模态机密训练',
        workloadType: 'secretflow',
        secretflowSpec: minimalSecretFlowSpec(),
      },
      activeContract(),
    );

    expect(result).toEqual({
      workloadType: 'secretflow',
      taskId: 'sf-task-3',
      status: 'accepted',
    });
  });

  it('rejects unsupported workload types', () => {
    const audit = new AuditService();
    const connectorRunner = new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    expect(() =>
      connectorRunner.run(
        {
          taskId: 'unknown-task',
          purpose: 'test',
          workloadType: 'federated_learning' as 'rws',
        },
        activeContract(),
      ),
    ).toThrow('Unsupported connector workload type: federated_learning');
  });
});
