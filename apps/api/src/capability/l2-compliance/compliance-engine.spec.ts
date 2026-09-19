import { evaluateCompliance } from "./compliance-engine";
import { LoadedRules, EvaluationInput } from "./engine.types";

function rules(): LoadedRules {
  return {
    riskPolicies: [
      {
        riskLevel: "high",
        requiredAnonymizationKey: "adequate_or_complete",
        requiredSecurityCapabilityKey: "enhanced",
        requiredAlgorithmKeys: ["DP-SGD", "DP-Query"],
        approvalRequired: true,
      },
      {
        riskLevel: "medium",
        requiredAnonymizationKey: "partial_or_above",
        requiredSecurityCapabilityKey: "enhanced",
        requiredAlgorithmKeys: [],
        approvalRequired: false,
      },
      {
        riskLevel: "low",
        requiredAnonymizationKey: "partial_or_above",
        requiredSecurityCapabilityKey: "basic",
        requiredAlgorithmKeys: [],
        approvalRequired: false,
      },
    ],
    guardrails: [
      {
        key: "k-anonymity",
        kind: "privacy_model",
        thresholds: { medical_general: 5, high_risk: 11 },
      },
      {
        key: "l-diversity",
        kind: "privacy_model",
        thresholds: { threshold: 2 },
      },
      {
        key: "epsilon-differential-privacy",
        kind: "crypto_model",
        thresholds: {
          medical_guidelines: { aggregated_statistics: { epsilon: 1.0 } },
        },
      },
    ],
    blockRuleKeys: [
      "block-high-partial",
      "block-high-not-enhanced",
      "block-cross-inst-low-k",
      "block-epsilon-too-high",
      "block-genetic-no-nhcc",
    ],
  };
}

describe("evaluateCompliance", () => {
  it("RWS high-risk genomic → manual_review (spec §6 example 1)", () => {
    const input: EvaluationInput = {
      scenarioRisk: "high",
      chosen: { anonymizationKey: "adequate", kAnonymity: 5, epsilon: 0.5 },
      chosenSecurityCapability: "enhanced",
      dimensions: {
        dataSensitivity: "high",
        participantCount: 3,
        dataFlowChain: "long",
        quasiIdentifierDensity: 8,
        humanGeneticResources: true,
        approvedByNHCC: true,
      },
    };
    const r = evaluateCompliance(input, rules());
    expect(r.overallRisk).toBe("high");
    expect(r.required.securityCapability).toBe("enhanced");
    expect(r.required.kAnonymity).toBe(5);
    expect(r.required.lDiversity).toBe(2);
    expect(r.required.epsilon).toBe(1.0);
    expect(r.required.approvalRequired).toBe(true);
    expect(r.blockingRulesMatched).toEqual([]);
    expect(r.autoVerdict).toBe("manual_review");
    expect(r.warnings.join()).toMatch(/遗传资源|NHCC|基因/);
  });

  it("CDSS low-risk internal → auto_approve (spec §6 example 2)", () => {
    const input: EvaluationInput = {
      scenarioRisk: "low",
      chosen: { anonymizationKey: "adequate", kAnonymity: 5 },
      chosenSecurityCapability: "basic",
      dimensions: {
        dataSensitivity: "deidentified",
        participantCount: 1,
        dataFlowChain: "internal",
        quasiIdentifierDensity: 3,
      },
    };
    const r = evaluateCompliance(input, rules());
    expect(r.overallRisk).toBe("low");
    expect(r.required.securityCapability).toBe("basic");
    expect(r.required.approvalRequired).toBe(false);
    expect(r.required.epsilon).toBeUndefined();
    expect(r.required.lDiversity).toBeUndefined();
    expect(r.autoVerdict).toBe("auto_approve");
    expect(r.blockingRulesMatched).toEqual([]);
  });

  it("block: high risk + partial anonymization", () => {
    const r = evaluateCompliance(
      {
        scenarioRisk: "high",
        chosen: { anonymizationKey: "partial", kAnonymity: 5, epsilon: 0.5 },
        chosenSecurityCapability: "enhanced",
        dimensions: { humanGeneticResources: false },
      },
      rules(),
    );
    expect(r.blockingRulesMatched).toContain("block-high-partial");
    expect(r.autoVerdict).toBe("block");
  });

  it("block: high risk + non-enhanced security", () => {
    const r = evaluateCompliance(
      {
        scenarioRisk: "high",
        chosen: { anonymizationKey: "adequate", kAnonymity: 5, epsilon: 0.5 },
        chosenSecurityCapability: "basic",
        dimensions: {},
      },
      rules(),
    );
    expect(r.blockingRulesMatched).toContain("block-high-not-enhanced");
  });

  it("block: cross-institution + k<5", () => {
    const r = evaluateCompliance(
      {
        scenarioRisk: "medium",
        chosen: { anonymizationKey: "adequate", kAnonymity: 3 },
        chosenSecurityCapability: "enhanced",
        dimensions: { participantCount: 2, dataFlowChain: "cross" },
      },
      rules(),
    );
    expect(r.blockingRulesMatched).toContain("block-cross-inst-low-k");
  });

  it("block: epsilon > 8.0", () => {
    const r = evaluateCompliance(
      {
        scenarioRisk: "medium",
        chosen: { anonymizationKey: "adequate", kAnonymity: 5, epsilon: 9 },
        chosenSecurityCapability: "enhanced",
        dimensions: {},
      },
      rules(),
    );
    expect(r.blockingRulesMatched).toContain("block-epsilon-too-high");
  });

  it("structural: missing required algorithm → structuralIssues", () => {
    const r = evaluateCompliance(
      {
        scenarioRisk: "high",
        chosen: { anonymizationKey: "adequate", kAnonymity: 5, epsilon: 0.5 },
        chosenAlgorithmKeys: ["fedavg"],
        chosenSecurityCapability: "enhanced",
        dimensions: {},
      },
      rules(),
    );
    expect(r.structuralIssues.join()).toMatch(/dp-sgd|dp-query/i);
  });

  it("structural: required algorithms present → no structural issue", () => {
    const r = evaluateCompliance(
      {
        scenarioRisk: "high",
        chosen: { anonymizationKey: "adequate", kAnonymity: 5, epsilon: 0.5 },
        chosenAlgorithmKeys: ["DP-SGD", "DP-Query"],
        chosenSecurityCapability: "enhanced",
        dimensions: {},
      },
      rules(),
    );
    expect(r.structuralIssues).toEqual([]);
  });

  it("block: genetic resources without NHCC approval", () => {
    const r = evaluateCompliance(
      {
        scenarioRisk: "high",
        chosen: { anonymizationKey: "adequate", kAnonymity: 5, epsilon: 0.5 },
        chosenSecurityCapability: "enhanced",
        dimensions: { humanGeneticResources: true, approvedByNHCC: false },
      },
      rules(),
    );
    expect(r.blockingRulesMatched).toContain("block-genetic-no-nhcc");
    expect(r.autoVerdict).toBe("block");
  });
});

// D-CMP-1 / D5：维度上调风险 + 各风险等级强制所需保障级（新增 federated）
function rulesFederated(): LoadedRules {
  return {
    riskPolicies: [
      {
        riskLevel: "high",
        requiredAnonymizationKey: "adequate_or_complete",
        requiredSecurityCapabilityKey: "enhanced",
        requiredAlgorithmKeys: ["DP-SGD", "DP-Query"],
        approvalRequired: true,
      },
      {
        riskLevel: "medium",
        requiredAnonymizationKey: "partial_or_above",
        requiredSecurityCapabilityKey: "federated",
        requiredAlgorithmKeys: [],
        approvalRequired: false,
      },
      {
        riskLevel: "low",
        requiredAnonymizationKey: "partial_or_above",
        requiredSecurityCapabilityKey: "basic",
        requiredAlgorithmKeys: [],
        approvalRequired: false,
      },
    ],
    guardrails: [],
    blockRuleKeys: ["block-security-below-required"],
  };
}

describe("evaluateCompliance — 维度上调风险 + 强制保障级（D-CMP-1）", () => {
  it("medium 场景 + 参与机构≥3 → 总体风险升为 high", () => {
    const r = evaluateCompliance(
      {
        scenarioRisk: "medium",
        chosen: {},
        chosenSecurityCapability: "enhanced",
        dimensions: { participantCount: 3 },
      },
      rulesFederated(),
    );
    expect(r.overallRisk).toBe("high");
    expect(r.required.securityCapability).toBe("enhanced");
  });

  it("含人类遗传资源 → 总体风险升为 high", () => {
    const r = evaluateCompliance(
      {
        scenarioRisk: "low",
        chosen: {},
        chosenSecurityCapability: "enhanced",
        dimensions: { humanGeneticResources: true },
      },
      rulesFederated(),
    );
    expect(r.overallRisk).toBe("high");
  });

  it("medium 要求 federated，仅 basic → block-security-below-required", () => {
    const r = evaluateCompliance(
      {
        scenarioRisk: "medium",
        chosen: {},
        chosenSecurityCapability: "basic",
        dimensions: {},
      },
      rulesFederated(),
    );
    expect(r.required.securityCapability).toBe("federated");
    expect(r.blockingRulesMatched).toContain("block-security-below-required");
    expect(r.autoVerdict).toBe("block");
  });

  it("medium 要求 federated，选 federated → 不阻断、自动放行", () => {
    const r = evaluateCompliance(
      {
        scenarioRisk: "medium",
        chosen: {},
        chosenSecurityCapability: "federated",
        dimensions: {},
      },
      rulesFederated(),
    );
    expect(r.blockingRulesMatched).not.toContain(
      "block-security-below-required",
    );
    expect(r.autoVerdict).toBe("auto_approve");
  });

  it("保障级高于要求也通过（low 要求 basic，选 federated/enhanced）", () => {
    for (const cap of ["basic", "federated", "enhanced"] as const) {
      const r = evaluateCompliance(
        {
          scenarioRisk: "low",
          chosen: {},
          chosenSecurityCapability: cap,
          dimensions: {},
        },
        rulesFederated(),
      );
      expect(r.blockingRulesMatched).not.toContain(
        "block-security-below-required",
      );
    }
  });

  it("未选协议（保障级 null）低于任何要求 → 阻断", () => {
    const r = evaluateCompliance(
      {
        scenarioRisk: "medium",
        chosen: {},
        chosenSecurityCapability: null,
        dimensions: {},
      },
      rulesFederated(),
    );
    expect(r.blockingRulesMatched).toContain("block-security-below-required");
  });
});
