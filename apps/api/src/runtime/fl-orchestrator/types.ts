import { FlPredictionTaskSpec } from "../../compute-task/dto/fl-prediction-task-spec";
import { FlAttestationSummary } from "../../compute-task/dto/fl-run-result";

export type FlAssignmentStatus = "pending" | "running" | "completed" | "failed";

export type FlProgressStage =
  | "queued"
  | "pulled"
  | "catalog-prefetch"
  | "data-load"
  | "pep-check"
  | "compute"
  | "output-gate"
  | "retention"
  | "complete"
  | "failed";

export interface FlProgressEvent {
  at: string;
  stage: FlProgressStage;
  detail?: string;
}

export interface ConnectorContractPayload {
  id: string;
  dataProductId: string;
  providerId: string;
  consumerId: string;
  purpose: string;
  retention: string;
  output: string;
  validUntil: string;
  status: "active" | "draft" | "expired" | "revoked";
}

export type FlTrainingMode = "sklearn" | "mock";

export interface FlPartyRunResultPayload {
  taskId: string;
  participantId: string;
  roundsCompleted: number;
  sampleCount: number;
  localMetrics: {
    auc?: number;
    f1?: number;
    precision?: number;
    recall?: number;
    accuracy?: number;
  };
  localModelHash: string;
  trainingMode?: FlTrainingMode;
}

export interface FlTaskAssignment {
  assignmentId: string;
  taskId: string;
  providerId: string;
  purpose: string;
  flPredictionSpec: FlPredictionTaskSpec;
  contract: ConnectorContractPayload;
  status: FlAssignmentStatus;
  progress?: FlProgressEvent[];
  partyResult?: FlPartyRunResultPayload;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export type FlOrchestrationStatus =
  | "pending"
  | "running"
  | "completed"
  | "partial"
  | "failed";

export interface FlOrchestrationRecord {
  taskId: string;
  title: string;
  purpose: string;
  flPredictionSpec: FlPredictionTaskSpec;
  consumerId: string;
  contractIds: string[];
  computeTaskId?: number;
  status: FlOrchestrationStatus;
  assignments: FlTaskAssignment[];
  merged?: Record<string, unknown>;
  /** 顶层存证摘要（从 merged.attestation 提升，便于消费方直接读取链上凭据）。 */
  attestation?: FlAttestationSummary;
  resultSummary?: Record<string, unknown>;
  createdAt: string;
  completedAt?: string;
}

export interface ConnectorPendingFlTask {
  assignmentId: string;
  taskId: string;
  purpose: string;
  workloadType: "federated_learning";
  flPredictionSpec: FlPredictionTaskSpec;
  contract: ConnectorContractPayload;
}
