import { Module } from '@nestjs/common';
import { AuditService } from './domain/audit';
import { Deidentifier } from './domain/deidentifier';
import { FhirGateway } from './domain/fhir-gateway';
import { LocalStore } from './domain/local-store';
import { RwsExecutor } from './domain/rws-executor';
import { TaskPuller } from './domain/task-puller';
import { PolicyEnforcementPoint } from './domain/policy-enforcement';
import { TaskScratch } from './domain/task-scratch';
import { RetentionEnforcer } from './domain/retention';
import { ConnectorTaskRunner } from './domain/connector-task-runner';
import { SoftwareTee } from './domain/tee';
import { OutputGate } from './domain/output-gate';
import { RwsOrchestrator } from './domain/rws-orchestrator';

@Module({
  providers: [
    AuditService,
    Deidentifier,
    FhirGateway,
    LocalStore,
    SoftwareTee,
    OutputGate,
    RwsExecutor,
    TaskPuller,
    PolicyEnforcementPoint,
    TaskScratch,
    RetentionEnforcer,
    ConnectorTaskRunner,
    RwsOrchestrator,
  ],
})
export class AppModule {}
