import { Injectable } from '@nestjs/common';
import { ContractView } from '../contract-view';
import { PolicyEnforcementPoint } from '../policy-enforcement';
import { isSecretFlowTaskSpec } from './secretflow-task-spec';

export interface SecretFlowPlaceholderResult {
  workloadType: 'secretflow';
  taskId: string;
  status: 'accepted';
}

@Injectable()
export class SecretFlowTaskRunner {
  constructor(private readonly pep: PolicyEnforcementPoint) {}

  run(
    taskId: string,
    purpose: string,
    secretflowSpec: unknown,
    contract: ContractView,
  ): SecretFlowPlaceholderResult {
    if (!isSecretFlowTaskSpec(secretflowSpec)) {
      throw new Error('SecretFlow workload requires a valid secretflowSpec');
    }

    this.pep.check({ taskId, purpose }, contract);

    return {
      workloadType: 'secretflow',
      taskId,
      status: 'accepted',
    };
  }
}
