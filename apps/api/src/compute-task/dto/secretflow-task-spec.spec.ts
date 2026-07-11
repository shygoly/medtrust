import {
  hasRequiredModalities,
  hasRequiredParties,
  isSecretFlowTaskSpec,
  SecretFlowTaskSpec,
} from "./secretflow-task-spec";

function minimalSecretFlowTaskSpec(): SecretFlowTaskSpec {
  return {
    parties: [{ participantId: "hospital-a", role: "provider" }],
    modalities: [{ type: "clinical_text", dataProductId: "dp-001" }],
    llmBackbone: { modelType: "llm", modelNameOrPath: "mock/backbone" },
    peftStrategy: { type: "lora", r: 8, alpha: 16, targetModules: ["q_proj"] },
    privacy: { teeRequired: true, heuEnabled: false },
    outputPolicy: {
      allowedArtifacts: ["lora_delta_hash", "aggregate_metrics"],
    },
  };
}

describe("secretflow-task-spec", () => {
  it("accepts a minimal valid SecretFlowTaskSpec", () => {
    const spec = minimalSecretFlowTaskSpec();
    expect(isSecretFlowTaskSpec(spec)).toBe(true);
    expect(hasRequiredParties(spec)).toBe(true);
    expect(hasRequiredModalities(spec)).toBe(true);
  });

  it("rejects missing parties", () => {
    const spec = { ...minimalSecretFlowTaskSpec(), parties: [] };
    expect(hasRequiredParties(spec)).toBe(false);
    expect(isSecretFlowTaskSpec(spec)).toBe(false);
  });

  it("rejects missing modalities", () => {
    const spec = { ...minimalSecretFlowTaskSpec(), modalities: [] };
    expect(hasRequiredModalities(spec)).toBe(false);
    expect(isSecretFlowTaskSpec(spec)).toBe(false);
  });

  it("rejects invalid party role", () => {
    const spec = {
      ...minimalSecretFlowTaskSpec(),
      parties: [{ participantId: "hospital-a", role: "observer" }],
    };
    expect(isSecretFlowTaskSpec(spec)).toBe(false);
  });

  it("rejects unknown output artifact kinds", () => {
    const spec = {
      ...minimalSecretFlowTaskSpec(),
      outputPolicy: { allowedArtifacts: ["raw_rows"] },
    };
    expect(isSecretFlowTaskSpec(spec)).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(isSecretFlowTaskSpec(null)).toBe(false);
    expect(isSecretFlowTaskSpec("secretflow")).toBe(false);
  });
});
