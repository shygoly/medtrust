export type RwsAnalysisType = 'adverse-event-signal' | 'cohort-count' | 'condition-prevalence';

export interface RwsAnalysisSpec {
  type: RwsAnalysisType;
  drug?: string;
}

export type AssignmentStatus = 'pending' | 'running' | 'completed' | 'failed';

export type RwsProgressStage =
  | 'queued'
  | 'pulled'
  | 'catalog-prefetch'
  | 'data-load'
  | 'pep-check'
  | 'compute'
  | 'output-gate'
  | 'retention'
  | 'complete'
  | 'failed';

export interface RwsProgressEvent {
  at: string;
  stage: RwsProgressStage;
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
  status: 'active' | 'draft' | 'expired' | 'revoked';
}

export interface RwsTaskAssignment {
  assignmentId: string;
  taskId: string;
  providerId: string;
  purpose: string;
  analysis: RwsAnalysisSpec;
  contract: ConnectorContractPayload;
  status: AssignmentStatus;
  progress?: RwsProgressEvent[];
  aggregate?: {
    analysisType: string;
    cohortSize: number;
    buckets: { key: string; count: number; rate: number; suppressed?: boolean }[];
  };
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export type RwsOrchestrationStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed';

export interface RwsOrchestrationRecord {
  taskId: string;
  title: string;
  purpose: string;
  analysis: RwsAnalysisSpec;
  consumerId: string;
  contractIds: string[];
  status: RwsOrchestrationStatus;
  assignments: RwsTaskAssignment[];
  merged?: RwsTaskAssignment['aggregate'];
  createdAt: string;
  completedAt?: string;
}

export interface ConnectorPendingTask {
  assignmentId: string;
  taskId: string;
  purpose: string;
  workloadType: 'rws';
  analysis: RwsAnalysisSpec;
  contract: ConnectorContractPayload;
}
