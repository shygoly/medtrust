import { Injectable } from '@nestjs/common';
import { ContractView } from '../contract-view';
import { PolicyEnforcementPoint } from '../policy-enforcement';
import { isSecretFlowTaskSpec } from './secretflow-task-spec';
import { MockSecretFlowAdapter } from './mock-secretflow-adapter';
import { SecretFlowRunResult, SecretFlowRuntimeAdapter } from './secretflow-runtime-adapter';

export type SecretFlowTaskRunResult = SecretFlowRunResult & { workloadType: 'secretflow' };

@Injectable()
export class SecretFlowTaskRunner {
  constructor(
    private readonly pep: PolicyEnforcementPoint,
    private readonly adapter: SecretFlowRuntimeAdapter = new MockSecretFlowAdapter(),
  ) {}

  run(
    taskId: string,
    purpose: string,
    secretflowSpec: unknown,
    contract: ContractView,
  ): SecretFlowTaskRunResult {
    if (!isSecretFlowTaskSpec(secretflowSpec)) {
      throw new Error('SecretFlow workload requires a valid secretflowSpec');
    }

    this.pep.check({ taskId, purpose }, contract);

    const environment = this.adapter.validateEnvironment();
    if (!environment.ready) {
      throw new Error(`SecretFlow runtime unavailable: ${environment.details ?? 'unknown'}`);
    }

    const prepared = this.adapter.prepare({ taskId, spec: secretflowSpec });
    try {
      const result = this.adapter.run(prepared, secretflowSpec);
      return { ...result, workloadType: 'secretflow' };
    } finally {
      this.adapter.cleanup(prepared);
    }
  }
}
