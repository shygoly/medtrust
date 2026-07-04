export type SecretFlowTaskSummary = {
  taskId: string;
  state: string;
  lastLoss?: number;
  currentEpoch?: number;
  droppedParties?: string[];
};

export type SecretFlowMergedResult = {
  taskId: string;
  state: string;
  roundsCompleted?: number;
  loraDeltaHash?: string;
  metrics?: {
    trainLoss?: number;
    initialLoss?: number;
    lossReduction?: number;
    partyCount?: number;
    federatedConnectors?: string[];
  };
  contributions?: Array<{ participantId: string; share: number }>;
  privacySummary?: {
    safeOutputOnly?: boolean;
    multiConnector?: boolean;
    connectorCount?: number;
    aggregationMode?: 'fedavg' | 'hash_concat';
    demoStandInModel?: boolean;
  };
  attestation?: {
    reportHash?: string;
    runtime?: string;
  };
};

const PARTICIPANT_LABELS: Record<string, string> = {
  "hospital-huashan": "华山医院",
  "hospital-ruijin": "瑞金医院",
  "pharma-hengrui": "恒瑞医药",
  "p-huashan": "华山医院",
  "p-ruijin": "瑞金医院",
};

export function participantLabel(id: string): string {
  return PARTICIPANT_LABELS[id] ?? id;
}

export function federatedConnectorsLabel(ids: string[] | undefined): string {
  if (!ids?.length) return "—";
  return ids.map(participantLabel).join(" + ");
}

const STATE_LABELS: Record<string, string> = {
  PENDING: "待调度",
  VALIDATING: "校验中",
  PLANNING: "规划中",
  DISPATCHING: "派发中",
  TRAINING: "训练中",
  AGGREGATING: "聚合中",
  COMPENSATING: "补偿中",
  COMPLETED: "已完成",
  FAILED: "失败",
  REFUSED: "已拒绝",
};

export function federatedStateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

export function federatedStateColor(state: string): string {
  if (state === "COMPLETED") return "var(--cs-green)";
  if (state === "FAILED" || state === "REFUSED") return "var(--cs-red)";
  if (state === "TRAINING" || state === "AGGREGATING" || state === "DISPATCHING") return "var(--cs-cyan)";
  return "var(--cs-amber)";
}
