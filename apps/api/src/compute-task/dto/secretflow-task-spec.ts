export type SecretFlowModalityType =
  "dicom" | "genomics" | "clinical_text" | "structured_ehr";

export type SecretFlowPartyRole = "provider" | "consumer" | "coordinator";

export type SecretFlowArtifactKind =
  | "lora_delta_hash"
  | "encrypted_delta_ref"
  | "aggregate_metrics"
  | "attestation_report"
  | "model_card";

export type SecretFlowFusionBridgeType =
  "linear_projection" | "perceiver_resampler";

export interface SecretFlowParty {
  participantId: string;
  role: SecretFlowPartyRole;
  spaceId?: string;
  connectorId?: string;
  dataResidency?: string;
}

export interface SecretFlowModalitySpec {
  type: SecretFlowModalityType;
  dataProductId?: string;
  manifestUri?: string;
  count?: number;
  schema?: string;
}

export interface SecretFlowModelBackbone {
  modelType: string;
  modelNameOrPath: string;
}

export interface SecretFlowPeftStrategy {
  type: "lora";
  r: number;
  alpha: number;
  targetModules: string[];
}

export interface SecretFlowFusionBridge {
  type: SecretFlowFusionBridgeType;
  hiddenSize: number;
  numQueries?: number;
}

export interface SecretFlowDpSgdSpec {
  clipNorm: number;
  noiseMultiplier: number;
  targetEpsilon?: number;
}

export interface SecretFlowPrivacySpec {
  teeRequired: boolean;
  heuEnabled: boolean;
  dpSgd?: SecretFlowDpSgdSpec;
}

export interface SecretFlowOutputPolicy {
  allowedArtifacts: SecretFlowArtifactKind[];
}

export interface SecretFlowTaskSpec {
  parties: SecretFlowParty[];
  modalities: SecretFlowModalitySpec[];
  llmBackbone: SecretFlowModelBackbone;
  peftStrategy: SecretFlowPeftStrategy;
  fusionBridge?: SecretFlowFusionBridge;
  privacy: SecretFlowPrivacySpec;
  outputPolicy: SecretFlowOutputPolicy;
  /** Declared research / usage purpose (YAML specs; admission may also pass separately). */
  purpose?: string;
  epochs?: number;
}

const PARTY_ROLES: SecretFlowPartyRole[] = [
  "provider",
  "consumer",
  "coordinator",
];
const MODALITY_TYPES: SecretFlowModalityType[] = [
  "dicom",
  "genomics",
  "clinical_text",
  "structured_ehr",
];
const ARTIFACT_KINDS: SecretFlowArtifactKind[] = [
  "lora_delta_hash",
  "encrypted_delta_ref",
  "aggregate_metrics",
  "attestation_report",
  "model_card",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasRequiredParties(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !Array.isArray(value.parties) ||
    value.parties.length === 0
  ) {
    return false;
  }
  return value.parties.every(
    (party) =>
      isRecord(party) &&
      isNonEmptyString(party.participantId) &&
      typeof party.role === "string" &&
      PARTY_ROLES.includes(party.role as SecretFlowPartyRole),
  );
}

export function hasRequiredModalities(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !Array.isArray(value.modalities) ||
    value.modalities.length === 0
  ) {
    return false;
  }
  return value.modalities.every(
    (modality) =>
      isRecord(modality) &&
      typeof modality.type === "string" &&
      MODALITY_TYPES.includes(modality.type as SecretFlowModalityType),
  );
}

export function hasRequiredLlmBackbone(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.llmBackbone)) {
    return false;
  }
  const { llmBackbone } = value;
  return (
    isNonEmptyString(llmBackbone.modelType) &&
    isNonEmptyString(llmBackbone.modelNameOrPath)
  );
}

export function hasRequiredPeftStrategy(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.peftStrategy)) {
    return false;
  }
  const { peftStrategy } = value;
  return (
    peftStrategy.type === "lora" &&
    typeof peftStrategy.r === "number" &&
    peftStrategy.r >= 1 &&
    typeof peftStrategy.alpha === "number" &&
    peftStrategy.alpha >= 1 &&
    Array.isArray(peftStrategy.targetModules) &&
    peftStrategy.targetModules.length > 0 &&
    peftStrategy.targetModules.every((module) => isNonEmptyString(module))
  );
}

export function hasRequiredPrivacy(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.privacy)) {
    return false;
  }
  const { privacy } = value;
  return (
    typeof privacy.teeRequired === "boolean" &&
    typeof privacy.heuEnabled === "boolean"
  );
}

export function hasRequiredOutputPolicy(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.outputPolicy)) {
    return false;
  }
  const { outputPolicy } = value;
  return (
    Array.isArray(outputPolicy.allowedArtifacts) &&
    outputPolicy.allowedArtifacts.length > 0 &&
    outputPolicy.allowedArtifacts.every(
      (artifact) =>
        typeof artifact === "string" &&
        ARTIFACT_KINDS.includes(artifact as SecretFlowArtifactKind),
    )
  );
}

export function isSecretFlowTaskSpec(
  value: unknown,
): value is SecretFlowTaskSpec {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasRequiredParties(value) &&
    hasRequiredModalities(value) &&
    hasRequiredLlmBackbone(value) &&
    hasRequiredPeftStrategy(value) &&
    hasRequiredPrivacy(value) &&
    hasRequiredOutputPolicy(value)
  );
}
