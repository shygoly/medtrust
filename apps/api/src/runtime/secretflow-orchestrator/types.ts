import { SecretFlowTaskSpec } from "../../compute-task/dto/secretflow-task-spec";

/** Capability tier assigned to a participating node by the heterogeneity eval. */
export type NodeTier = "teeu_full" | "pyu_only";

/** Hardware/capability profile reported by (or assumed for) a participant. */
export interface NodeCapabilityProfile {
  participantId: string;
  device?: string; // e.g. 'H100' | 'V100' | 'CPU'
  hasTee?: boolean;
  hasConfidentialGpu?: boolean;
  gpuMemoryGb?: number;
}

/** Heterogeneity-adapted execution plan for a single node (sent to its agent). */
export interface NodePlan {
  participantId: string;
  tier: NodeTier;
  device: string;
  offloadAggregation: boolean; // weak node ships encrypted features to the TEEU pool
  localEpochs: number;
  rationale: string;
}

/** Finite-state-machine states for a SecretFlow orchestration. */
export type OrchestratorState =
  | "PENDING"
  | "VALIDATING"
  | "PLANNING"
  | "DISPATCHING"
  | "TRAINING"
  | "AGGREGATING"
  | "COMPLETED"
  | "FAILED"
  | "COMPENSATING";

export interface OrchestratorTransition {
  from: OrchestratorState;
  to: OrchestratorState;
  at: string;
  reason?: string;
}

export interface SettlementLine {
  org: string;
  participantId: string;
  contribution: number;
  amount: number;
}

export interface SettlementSummary {
  id: string;
  taskId: string;
  taskRef: string;
  consumerId: string;
  currency: string;
  total: number;
  contributionTotal: number;
  lines: SettlementLine[];
  txHash: string;
  block: number;
  at: string;
}

export interface OrchestrationRecord {
  taskId: string;
  state: OrchestratorState;
  spec: SecretFlowTaskSpec;
  nodePlan: NodePlan[];
  transpiledPayload: string;
  taskStreamUrl?: string;
  history: OrchestratorTransition[];
  droppedParties: string[];
  lastLoss?: number;
  currentEpoch?: number;
  result?: unknown;
  error?: string;
  contractRefs?: string[];
  complianceEvaluationId?: string; // L2 裁决结果引用(P2 闸门)
  settlement?: SettlementSummary;
}

/** A normalized training-log event re-broadcast to web subscribers. */
export interface OrchestratorLogEvent {
  taskId: string;
  phase: string;
  participantId?: string;
  epoch?: number;
  round?: number;
  loss?: number;
  globalLoss?: number;
  elapsedSeconds?: number;
  state?: OrchestratorState;
  result?: unknown;
  [key: string]: unknown;
}
