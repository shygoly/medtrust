import {
  EvaluationInput,
  EvaluationResult,
  LoadedRules,
  ComplianceRequired,
  Risk,
  RiskDimensions,
  SecurityLevel,
} from "./engine.types";

const ANON_ADEQUATE = new Set(["adequate", "complete", "adequate_or_complete"]);

const RISK_RANK: Record<Risk, number> = { low: 0, medium: 1, high: 2 };
const RISK_BY_RANK: Risk[] = ["low", "medium", "high"];
// 保障级序 basic < federated < enhanced（D-CMP-1）
const SECURITY_RANK: Record<SecurityLevel, number> = {
  basic: 0,
  federated: 1,
  enhanced: 2,
};

function maxRisk(a: Risk, b: Risk): Risk {
  return RISK_BY_RANK[Math.max(RISK_RANK[a], RISK_RANK[b])];
}

// 由风险维度判定的风险(只上调不下调):参与机构≥3 或 含人类遗传资源 → high。
// 判定标准原文见 taxonomy 的 risk-high 说明,此处为其代码谓词(D5)。
export function dimensionRisk(d: RiskDimensions): Risk {
  if ((d.participantCount ?? 0) >= 3 || d.humanGeneticResources) return "high";
  return "low";
}

// 每条 block 规则 = 一个 typed 谓词;仅当 key 在 LoadedRules.blockRuleKeys 内才参与。
// 规则的目录/原因是数据(库内),判定逻辑是代码——契合"通则+判例"。
const BLOCK_PREDICATES: Record<string, (i: EvaluationInput) => boolean> = {
  "block-high-partial": (i) =>
    i.scenarioRisk === "high" &&
    !ANON_ADEQUATE.has(i.chosen.anonymizationKey ?? ""),
  "block-high-not-enhanced": (i) =>
    i.scenarioRisk === "high" && i.chosenSecurityCapability !== "enhanced",
  "block-cross-inst-low-k": (i) =>
    (i.chosen.kAnonymity ?? 0) < 5 && (i.dimensions.participantCount ?? 1) > 1,
  "block-epsilon-too-high": (i) => (i.chosen.epsilon ?? 0) > 8.0,
  "block-genetic-no-nhcc": (i) =>
    !!i.dimensions.humanGeneticResources && !i.dimensions.approvedByNHCC,
};

function computeRequired(risk: Risk, rules: LoadedRules): ComplianceRequired {
  const policy = rules.riskPolicies.find((p) => p.riskLevel === risk);
  const k = rules.guardrails.find((g) => g.key === "k-anonymity");
  const l = rules.guardrails.find((g) => g.key === "l-diversity");
  const eps = rules.guardrails.find(
    (g) => g.key === "epsilon-differential-privacy",
  );
  const req: ComplianceRequired = {
    anonymization: policy?.requiredAnonymizationKey ?? "partial_or_above",
    kAnonymity: (k?.thresholds?.medical_general as number) ?? 5,
    securityCapability:
      (policy?.requiredSecurityCapabilityKey as SecurityLevel) ?? "basic",
    approvalRequired: policy?.approvalRequired ?? false,
  };
  // l-diversity 仅在高风险纳入(对齐 §6: RWS 有 l:2, CDSS 无)
  if (risk === "high" && l)
    req.lDiversity = (l.thresholds?.threshold as number) ?? 2;
  // ε 仅在风险要求 DP 算法时纳入(high → [DP-SGD,DP-Query])
  if ((policy?.requiredAlgorithmKeys?.length ?? 0) > 0 && eps) {
    req.epsilon =
      (eps.thresholds?.medical_guidelines?.aggregated_statistics
        ?.epsilon as number) ?? 1.0;
  }
  return req;
}

export function evaluateCompliance(
  input: EvaluationInput,
  rules: LoadedRules,
): EvaluationResult {
  // 维度可上调风险:总体风险 = max(场景声明风险, 维度判定风险)(D-CMP-1 / D5)
  const overallRisk = maxRisk(
    input.scenarioRisk,
    dimensionRisk(input.dimensions),
  );
  const required = computeRequired(overallRisk, rules);

  // 结构校验: 风险策略要求的算法须在组合内(只用可解析的绑定边,沿用 warn-only:
  // 写入 structuralIssues 作为提示,不据此硬阻断)。
  const structuralIssues: string[] = [];
  if (input.chosenAlgorithmKeys) {
    const norm = (s: string) => s.trim().toLowerCase();
    const chosenAlgos = new Set(input.chosenAlgorithmKeys.map(norm));
    const policy = rules.riskPolicies.find((p) => p.riskLevel === overallRisk);
    for (const req of policy?.requiredAlgorithmKeys ?? []) {
      if (!chosenAlgos.has(norm(req)))
        structuralIssues.push(`缺少风险要求的算法: ${req}`);
    }
  }

  // block 谓词(仅库内启用的规则参与),保持库内顺序
  const blockingRulesMatched = rules.blockRuleKeys.filter(
    (key) => BLOCK_PREDICATES[key]?.(input) ?? false,
  );

  // 各风险等级都强制所需保障级(D-CMP-1 / D5):所选协议推出的保障级低于要求即阻断。
  // 需要 required(依赖 overallRisk),故不放进静态谓词表;仅当库内启用该规则时参与。
  if (rules.blockRuleKeys.includes("block-security-below-required")) {
    const chosenRank =
      input.chosenSecurityCapability != null
        ? SECURITY_RANK[input.chosenSecurityCapability]
        : -1;
    if (chosenRank < SECURITY_RANK[required.securityCapability]) {
      blockingRulesMatched.push("block-security-below-required");
    }
  }

  const warnings: string[] = [];
  if (input.dimensions.humanGeneticResources) {
    warnings.push("含基因组/人类遗传资源数据 → 需国家卫健委(NHCC)审批");
  }
  if (input.dimensions.crossBorder) {
    warnings.push("数据跨境 → 需通过数据出境安全评估(PIPL/DSL)");
  }

  let autoVerdict: EvaluationResult["autoVerdict"];
  if (blockingRulesMatched.length > 0) {
    autoVerdict = "block";
  } else if (
    required.approvalRequired ||
    (required.epsilon !== undefined && (input.chosen.epsilon ?? 0) > 1.0) ||
    input.dimensions.crossBorder ||
    input.dimensions.humanGeneticResources
  ) {
    autoVerdict = "manual_review";
  } else {
    autoVerdict = "auto_approve";
  }

  return {
    overallRisk,
    required,
    autoVerdict,
    blockingRulesMatched,
    warnings,
    structuralIssues,
  };
}
