export * from './layer-kind';
export * from './system-object.base';
export * from './l1-scenario.entity';
export * from './l3-model.entity';
export * from './l4-algorithm.entity';
export * from './l5-operator.entity';
export * from './l6-protocol.entity';
export * from './l7-infrastructure.entity';
export * from './l2-guardrail.entity';
export * from './l2-risk-policy.entity';
export * from './l2-anonymization-degree.entity';
export * from './l2-security-capability.entity';
export * from './l2-block-rule.entity';
export * from './l2-approval-rule.entity';

import { L1Scenario } from './l1-scenario.entity';
import { L3Model } from './l3-model.entity';
import { L4Algorithm } from './l4-algorithm.entity';
import { L5Operator } from './l5-operator.entity';
import { L6Protocol } from './l6-protocol.entity';
import { L7Infrastructure } from './l7-infrastructure.entity';
import { L2Guardrail } from './l2-guardrail.entity';
import { L2RiskPolicy } from './l2-risk-policy.entity';
import { L2AnonymizationDegree } from './l2-anonymization-degree.entity';
import { L2SecurityCapability } from './l2-security-capability.entity';
import { L2BlockRule } from './l2-block-rule.entity';
import { L2ApprovalRule } from './l2-approval-rule.entity';

export const capabilityEntities = [
  L1Scenario, L3Model, L4Algorithm, L5Operator, L6Protocol, L7Infrastructure,
  L2Guardrail, L2RiskPolicy, L2AnonymizationDegree, L2SecurityCapability,
  L2BlockRule, L2ApprovalRule,
];
