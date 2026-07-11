import { z } from "zod";

/**
 * Zod schema mirroring SecretFlowTaskSpec (compute-task/dto/secretflow-task-spec.ts).
 * The LLM returns JSON; we validate it here from the source so enums / required
 * fields / numeric bounds are enforced before the spec ever reaches the
 * orchestrator. Enums are kept in sync with the runtime guards in that file.
 */

export const modalityType = z.enum([
  "dicom",
  "genomics",
  "clinical_text",
  "structured_ehr",
]);

export const partyRole = z.enum(["provider", "consumer", "coordinator"]);

export const artifactKind = z.enum([
  "lora_delta_hash",
  "encrypted_delta_ref",
  "aggregate_metrics",
  "attestation_report",
  "model_card",
]);

export const fusionBridgeType = z.enum([
  "linear_projection",
  "perceiver_resampler",
]);

const partySchema = z.object({
  participantId: z.string().min(1),
  role: partyRole,
  spaceId: z.string().optional(),
  connectorId: z.string().optional(),
  dataResidency: z.string().optional(),
});

const modalitySchema = z.object({
  type: modalityType,
  dataProductId: z.string().optional(),
  manifestUri: z.string().optional(),
  count: z.number().optional(),
  schema: z.string().optional(),
});

const llmBackboneSchema = z.object({
  modelType: z.string().min(1),
  modelNameOrPath: z.string().min(1),
});

const peftStrategySchema = z.object({
  type: z.literal("lora"),
  r: z.number().int().min(1),
  alpha: z.number().int().min(1),
  targetModules: z.array(z.string().min(1)).min(1),
});

const fusionBridgeSchema = z.object({
  type: fusionBridgeType,
  hiddenSize: z.number(),
  numQueries: z.number().optional(),
});

const dpSgdSchema = z.object({
  clipNorm: z.number(),
  noiseMultiplier: z.number(),
  targetEpsilon: z.number().optional(),
});

const privacySchema = z.object({
  teeRequired: z.boolean(),
  heuEnabled: z.boolean(),
  dpSgd: dpSgdSchema.optional(),
});

const outputPolicySchema = z.object({
  allowedArtifacts: z.array(artifactKind).min(1),
});

export const secretFlowSpecSchema = z.object({
  parties: z.array(partySchema).min(1),
  modalities: z.array(modalitySchema).min(1),
  llmBackbone: llmBackboneSchema,
  peftStrategy: peftStrategySchema,
  fusionBridge: fusionBridgeSchema.optional(),
  privacy: privacySchema,
  outputPolicy: outputPolicySchema,
});

/** Per-block plain-language explanation ("why is it configured this way"). */
const rationaleSchema = z.object({
  parties: z.string().optional(),
  modalities: z.string().optional(),
  llmBackbone: z.string().optional(),
  peftStrategy: z.string().optional(),
  privacy: z.string().optional(),
  outputPolicy: z.string().optional(),
});

/** Full LLM draft: a valid spec plus reviewer-facing rationale/warnings/assumptions. */
export const draftSchema = z.object({
  spec: secretFlowSpecSchema,
  rationale: rationaleSchema,
  warnings: z.array(z.string()),
  assumptions: z.array(z.string()),
});

export type SecretFlowSpecDraft = z.infer<typeof secretFlowSpecSchema>;
export type SecretFlowDraft = z.infer<typeof draftSchema>;
