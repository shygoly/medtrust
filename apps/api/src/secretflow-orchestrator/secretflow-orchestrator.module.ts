import { Module } from '@nestjs/common';
import { SecretFlowOrchestratorController } from './secretflow-orchestrator.controller';
import { SecretFlowOrchestratorService } from './secretflow-orchestrator.service';
import { NodeCapabilityService } from './node-capability.service';
import { SecretFlowTranspilerService } from './transpiler.service';
import { OrchestratorFsmService } from './orchestrator-fsm.service';
import { AgentDispatchClient } from './agent-dispatch.client';
import { AgentLogBridge } from './agent-log-bridge.service';
import { SecretFlowEventsGateway } from './secretflow-events.gateway';
import { SecretFlowAdmissionService } from './secretflow-admission.service';
import { DigitalContractModule } from '../digital-contract/digital-contract.module';
import { SettlementModule } from '../settlement/settlement.module';
import { ComplianceModule } from '../capability/l2-compliance/compliance.module';

/**
 * Space Orchestrator module — the declarative SecretFlow control plane.
 * Imports DigitalContract (PEP admission + attestation) and Settlement
 * (按贡献分账) so the business closure runs end-to-end.
 */
@Module({
  imports: [DigitalContractModule, SettlementModule, ComplianceModule],
  controllers: [SecretFlowOrchestratorController],
  providers: [
    SecretFlowOrchestratorService,
    NodeCapabilityService,
    SecretFlowTranspilerService,
    OrchestratorFsmService,
    AgentDispatchClient,
    AgentLogBridge,
    SecretFlowEventsGateway,
    SecretFlowAdmissionService,
  ],
  exports: [SecretFlowOrchestratorService],
})
export class SecretFlowOrchestratorModule {}
