export type Risk = "low" | "medium" | "high";
export type SecurityLevel = "basic" | "enhanced";

export interface RiskDimensions {
  dataSensitivity?: string; // 'high' | 'deidentified' | ...
  participantCount?: number;
  dataFlowChain?: string; // 'internal' | 'long' | 'cross' | ...
  quasiIdentifierDensity?: number;
  humanGeneticResources?: boolean;
  crossBorder?: boolean;
  approvedByNHCC?: boolean;
}

export interface ChosenParams {
  anonymizationKey?: string;
  kAnonymity?: number;
  epsilon?: number;
}

export interface EvaluationInput {
  scenarioRisk: Risk; // = l1_scenario.riskLevel
  chosen: ChosenParams;
  chosenSecurityCapability: SecurityLevel | null; // 由所选协议推出
  chosenAlgorithmKeys?: string[]; // 组合所选 L4 算法(结构校验用,可选)
  dimensions: RiskDimensions;
}

// 从 DB 装载的 L2 规则(子集投影,引擎只取所需)
export interface LoadedRules {
  riskPolicies: {
    riskLevel: Risk;
    requiredAnonymizationKey: string;
    requiredSecurityCapabilityKey: string;
    requiredAlgorithmKeys: string[];
    approvalRequired: boolean;
  }[];
  guardrails: {
    key: string;
    kind: string;
    thresholds: Record<string, any> | null;
  }[];
  blockRuleKeys: string[]; // 库内启用的 block_rule.key 集合
}

export interface ComplianceRequired {
  anonymization: string;
  kAnonymity: number;
  lDiversity?: number;
  epsilon?: number;
  securityCapability: SecurityLevel;
  approvalRequired: boolean;
}

export interface EvaluationResult {
  overallRisk: Risk;
  required: ComplianceRequired;
  autoVerdict: "auto_approve" | "manual_review" | "block";
  blockingRulesMatched: string[];
  warnings: string[];
  structuralIssues: string[];
}
