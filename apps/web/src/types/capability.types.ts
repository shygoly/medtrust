// 七层能力图谱前端类型(对齐 packages/database/src/capability)。

export type CapabilityLayer =
  | "l1_scenario"
  | "l3_model"
  | "l4_algorithm"
  | "l5_operator"
  | "l6_protocol"
  | "l7_infrastructure";

export type Risk = "low" | "medium" | "high";

// 各层系统对象(并集形态;不同层用到的字段不同)。
export interface CapabilityObject {
  id?: string;
  key: string;
  name: string;
  version?: string;
  status?: "active" | "deprecated" | "draft";
  basedOn?: string;
  // L1
  riskLevel?: Risk;
  description?: string;
  criteria?: string;
  typicalModelKeys?: string[];
  typicalAlgorithmKeys?: string[];
  // L3 / L4
  category?: string;
  trainingAlgorithmKeys?: string[];
  complianceNote?: string;
  underlyingOperatorKeys?: string[];
  compliancePrivacyModels?: string[];
  // L5
  opType?: string;
  supportedProtocolKeys?: string[];
  complianceDriven?: boolean;
  triggeredBy?: string;
  // L6
  family?: string;
  securityAssumption?: string;
  securityCapabilityLevel?: "basic" | "enhanced";
  handlerKey?: string;
  // L7
  infraType?: string;
  vendor?: string;
}

export interface Composition {
  id: string;
  scenarioKey: string;
  modelKeys: string[];
  algorithmKeys: string[];
  operatorKeys: string[];
  protocolKeys: string[];
  infraKeys: string[];
  chosenParams?: { anonymizationKey?: string; kAnonymity?: number; epsilon?: number } | null;
  riskDimensions?: Record<string, unknown> | null;
}

export type Verdict = "auto_approve" | "manual_review" | "block";

export interface ComplianceEvaluation {
  id: string;
  compositionId: string;
  overallRisk: Risk;
  required: {
    anonymization?: string;
    kAnonymity?: number;
    lDiversity?: number;
    epsilon?: number;
    securityCapability?: string;
    approvalRequired?: boolean;
  };
  autoVerdict: Verdict;
  blockingRulesMatched: string[];
  warnings: string[];
  structuralIssues: string[];
  evaluatedAt?: string;
}

// 七层展示元数据(标签 / 副标题 / 中文名)。
export const LAYER_META: Record<
  CapabilityLayer,
  { n: string; label: string; en: string; role: string }
> = {
  l1_scenario: { n: "L1", label: "场景", en: "SCENARIOS", role: "做什么事 · 声明风险等级" },
  l3_model: { n: "L3", label: "模型", en: "MODELS", role: "用什么资产" },
  l4_algorithm: { n: "L4", label: "算法", en: "ALGORITHMS", role: "怎么动" },
  l5_operator: { n: "L5", label: "算子", en: "OPERATORS", role: "原子动作" },
  l6_protocol: { n: "L6", label: "协议", en: "PROTOCOLS", role: "怎么保护" },
  l7_infrastructure: { n: "L7", label: "基础设施", en: "INFRASTRUCTURE", role: "跑在哪" },
};

export const LAYER_ORDER: CapabilityLayer[] = [
  "l1_scenario",
  "l3_model",
  "l4_algorithm",
  "l5_operator",
  "l6_protocol",
  "l7_infrastructure",
];
