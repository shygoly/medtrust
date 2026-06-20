// 七层标识。L2 是规则层(非能力注册表),其余为能力层。
export enum LayerKind {
  L1_SCENARIO = 'l1_scenario',
  L2_COMPLIANCE = 'l2_compliance',
  L3_MODEL = 'l3_model',
  L4_ALGORITHM = 'l4_algorithm',
  L5_OPERATOR = 'l5_operator',
  L6_PROTOCOL = 'l6_protocol',
  L7_INFRASTRUCTURE = 'l7_infrastructure',
}

export const TAXONOMY_VERSION = '7.0-medical-2026-06-20';
