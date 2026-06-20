// TAXONOMY 种子的形状。字段名与各层实体列对齐,seeder 可近似直接 upsert。
// 跨层引用(typical*/underlying*/training*/supported*/required*)P0 忠实照搬源
// 分类学的"显示名"字符串,不强制规范成 key;seeder 做 warn-only 解析报告。
export interface TaxonomySeed {
  version: string;
  scenarios: {
    key: string; name: string; description: string;
    riskLevel: 'low' | 'medium' | 'high';
    typicalModelKeys: string[]; typicalAlgorithmKeys: string[];
  }[];
  guardrails: {
    key: string; name: string; kind: 'privacy_model' | 'crypto_model';
    description?: string; thresholds?: Record<string, unknown>;
    requiredOperatorKeys?: string[]; requiredAlgorithmKeys?: string[];
    applicableScenarios?: string[]; basedOn?: string;
  }[];
  riskPolicies: {
    key: string; riskLevel: 'low' | 'medium' | 'high'; criteria: string;
    requiredAnonymizationKey: string; requiredSecurityCapabilityKey: string;
    requiredAlgorithmKeys?: string[]; approvalRequired: boolean;
  }[];
  anonymizationDegrees: {
    key: string; name: string; definition: string;
    requiredTechniques: string[]; reIdentificationRiskUpper?: number; allowedScenarios: string[];
  }[];
  securityCapabilities: {
    key: string; name: string; requiredProtocolKeys: string[]; description?: string;
  }[];
  models: { key: string; name: string; category: string; trainingAlgorithmKeys: string[]; complianceNote?: string }[];
  algorithms: { key: string; name: string; category: string; underlyingOperatorKeys: string[]; compliancePrivacyModels?: string[] }[];
  operators: { key: string; name: string; opType: string; supportedProtocolKeys: string[]; complianceDriven?: boolean; triggeredBy?: string }[];
  protocols: { key: string; name: string; family: string; securityAssumption: string; securityCapabilityLevel: 'basic' | 'enhanced'; handlerKey?: string }[];
  infrastructure: { key: string; name: string; infraType: string; vendor: string; complianceNote?: string; handlerKey?: string }[];
  blockRules: { key: string; condition: string; reason: string }[];
  approvalRules: { conditionGroup: 'auto_block' | 'auto_approve' | 'manual'; conditions: string[] }[];
}
