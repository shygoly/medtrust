export type Risk = "low" | "medium" | "high";
// 保障级序 basic < federated < enhanced（D-CMP-1：federated = 数据不出域 + 输出闸门 + 全程审计）
export type SecurityLevel = "basic" | "federated" | "enhanced";
// 风险维度取值来源：由系统事实推导 / 由申请方自报（design D3）
export type DimensionSource = "derived" | "declared";

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

// 写入合约、并在任务准入时复核的裁决快照（design D2）。
// 跨库按值保存（预审在主库、合约在独立控制面 PostgreSQL），计入合约哈希 → 事后不可篡改。
export interface PreReviewSnapshot {
  compositionId: string;
  evaluationId: string;
  verdict: EvaluationResult["autoVerdict"];
  overallRisk: Risk;
  required: ComplianceRequired;
  dimensions: RiskDimensions;
  dimensionSources: Partial<Record<keyof RiskDimensions, DimensionSource>>;
  dimensionConflicts: string[]; // 自报比推导低风险的维度（疑似低报）
  rulesDigest: string; // 当次装载的 L2 规则 stableStringify 后的 SM3
  evaluatedAt: string; // ISO
}
