import scenario from './ckd-scenario.json';

export type ConnectorRole = 'provider' | 'consumer';
export type ConnectorStatus = 'online' | 'idle' | 'offline';
export type TaskStatus = 'draft' | 'awaiting-auth' | 'running' | 'completed' | 'blocked';
export type WorkloadType = 'rws' | 'federated_learning' | 'secretflow';

export interface Connector {
  id: string;
  org: string;
  role: ConnectorRole;
  status: ConnectorStatus;
  region: string;
  certFingerprint: string;
  certValidUntil: string;
  datasetCount: number;
  recordCount: number;
  lastSeen: string;
  residency: string;
}

export interface TaskNodeRun {
  connectorId: string;
  org: string;
  state: 'pending' | 'authorized' | 'executing' | 'gate' | 'returned' | 'denied';
  progress: number;
  note?: string;
}

export interface UsagePolicy {
  purpose: string;
  retention: string;
  output: string;
  validUntil: string;
}

export interface SpaceTask {
  id: string;
  workloadType: WorkloadType;
  title: string;
  initiator: string;
  purpose: string;
  cohort: string;
  analysis: string;
  status: TaskStatus;
  createdAt: string;
  targets: TaskNodeRun[];
  output?: {
    kind: string;
    rowsSuppressed: number;
    summary: string;
  };
  policy: UsagePolicy;
}

export interface Attestation {
  id: string;
  txHash: string;
  taskId: string;
  taskTitle: string;
  kind: 'policy' | 'task' | 'output';
  participants: string[];
  inputFingerprint: string;
  outputHash: string;
  block: number;
  at: string;
}

export interface CatalogProductSeed {
  id: string;
  providerId: string;
  title: string;
  classification: string;
  rightsConfirmed: boolean;
  recordCount: number;
  modality: string;
  fhirSchema: Record<string, unknown>;
  productRoles?: string[];
}

export interface SettlementRecord {
  id: string;
  taskId: string;
  taskRef: string;
  consumer: string;
  consumerId: string;
  currency: string;
  contributionTotal: number;
  total: number;
  lines: Array<{
    org: string;
    participantId: string;
    contribution: number;
    amount: number;
  }>;
  hash: string;
  at: string;
}

export interface SecretFlowTaskSpecExport {
  parties: Array<{
    participantId: string;
    role: string;
    connectorId?: string;
    dataResidency?: string;
  }>;
  modalities: Array<{
    type: string;
    dataProductId?: string;
    schema?: string;
  }>;
  llmBackbone: { modelType: string; modelNameOrPath: string };
  peftStrategy: {
    type: string;
    r: number;
    alpha: number;
    targetModules: string[];
  };
  fusionBridge?: {
    type: string;
    hiddenSize: number;
    numQueries?: number;
  };
  privacy: {
    teeRequired: boolean;
    heuEnabled: boolean;
    dpSgd?: { clipNorm: number; noiseMultiplier: number; targetEpsilon?: number };
  };
  outputPolicy: { allowedArtifacts: string[] };
  purpose?: string;
  epochs?: number;
}

export const CKD_SCENARIO = scenario;
export const SPACE_ID = scenario.spaceId;
export const CKD_PURPOSE = scenario.purpose;
export const CONNECTORS = scenario.connectors as Connector[];
export const SPACE_TASKS = scenario.tasks as SpaceTask[];
export const ATTESTATIONS = scenario.attestations as Attestation[];
export const CATALOG_PRODUCTS = scenario.catalogProducts as CatalogProductSeed[];
export const SETTLEMENT_RECORDS = scenario.settlements as SettlementRecord[];
export const SECRETFLOW_SPEC = scenario.secretflowSpec as SecretFlowTaskSpecExport;
export const ASSISTANT_PLACEHOLDER = scenario.assistantPlaceholder;
export const PARTY_MODALITY_MAP: Record<string, string[]> = Object.fromEntries(
  scenario.participants.map((p) => [p.participantId, p.modalities]),
);

/** Core SecretFlowTaskSpec fields (without purpose/epochs extras). */
export function coreSecretFlowSpec(): Omit<SecretFlowTaskSpecExport, 'purpose' | 'epochs'> {
  const { purpose: _p, epochs: _e, ...core } = SECRETFLOW_SPEC;
  return core;
}

export function computeSpaceStats() {
  return {
    participants: CONNECTORS.length,
    online: CONNECTORS.filter((c) => c.status === 'online').length,
    records: CONNECTORS.reduce((n, c) => n + c.recordCount, 0),
    activeTasks: SPACE_TASKS.filter((t) => t.status === 'running' || t.status === 'awaiting-auth').length,
    attestations: ATTESTATIONS.length,
    rawDataEgress: 0,
  };
}

/** YAML for the SecretFlow dashboard textarea (sf-3007 flagship task). */
export function secretFlowSpecToYaml(): string {
  const s = SECRETFLOW_SPEC;
  const lines: string[] = [
    'parties:',
    ...s.parties.map((p) => {
      const parts = [`  - participantId: ${p.participantId}`, `    role: ${p.role}`];
      if (p.connectorId) parts.push(`    connectorId: ${p.connectorId}`);
      if (p.dataResidency) parts.push(`    dataResidency: ${p.dataResidency}`);
      return parts.join('\n');
    }),
    'modalities:',
    ...s.modalities.map((m) => {
      const parts = [`  - type: ${m.type}`];
      if (m.dataProductId) parts.push(`    dataProductId: ${m.dataProductId}`);
      if (m.schema) parts.push(`    schema: ${m.schema}`);
      return parts.join('\n');
    }),
    'llmBackbone:',
    `  modelType: ${s.llmBackbone.modelType}`,
    `  modelNameOrPath: ${s.llmBackbone.modelNameOrPath}`,
    'peftStrategy:',
    `  type: ${s.peftStrategy.type}`,
    `  r: ${s.peftStrategy.r}`,
    `  alpha: ${s.peftStrategy.alpha}`,
    `  targetModules: [${s.peftStrategy.targetModules.join(', ')}]`,
  ];

  if (s.fusionBridge) {
    lines.push(
      'fusionBridge:',
      `  type: ${s.fusionBridge.type}`,
      `  hiddenSize: ${s.fusionBridge.hiddenSize}`,
      `  numQueries: ${s.fusionBridge.numQueries ?? 8}`,
    );
  }

  lines.push(
    'privacy:',
    `  teeRequired: ${s.privacy.teeRequired}`,
    `  heuEnabled: ${s.privacy.heuEnabled}`,
  );

  if (s.privacy.dpSgd) {
    lines.push(
      '  dpSgd:',
      `    clipNorm: ${s.privacy.dpSgd.clipNorm}`,
      `    noiseMultiplier: ${s.privacy.dpSgd.noiseMultiplier}`,
    );
  }

  lines.push(
    'outputPolicy:',
    `  allowedArtifacts: [${s.outputPolicy.allowedArtifacts.join(', ')}]`,
    `purpose: ${s.purpose}`,
    `epochs: ${s.epochs ?? 5}`,
    '',
  );

  return lines.join('\n');
}

export const SECRETFLOW_SPEC_YAML = secretFlowSpecToYaml();
