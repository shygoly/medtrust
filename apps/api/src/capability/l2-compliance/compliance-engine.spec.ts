import { evaluateCompliance } from './compliance-engine';
import { LoadedRules, EvaluationInput } from './engine.types';

function rules(): LoadedRules {
  return {
    riskPolicies: [
      { riskLevel: 'high', requiredAnonymizationKey: 'adequate_or_complete', requiredSecurityCapabilityKey: 'enhanced', requiredAlgorithmKeys: ['DP-SGD', 'DP-Query'], approvalRequired: true },
      { riskLevel: 'medium', requiredAnonymizationKey: 'partial_or_above', requiredSecurityCapabilityKey: 'enhanced', requiredAlgorithmKeys: [], approvalRequired: false },
      { riskLevel: 'low', requiredAnonymizationKey: 'partial_or_above', requiredSecurityCapabilityKey: 'basic', requiredAlgorithmKeys: [], approvalRequired: false },
    ],
    guardrails: [
      { key: 'k-anonymity', kind: 'privacy_model', thresholds: { medical_general: 5, high_risk: 11 } },
      { key: 'l-diversity', kind: 'privacy_model', thresholds: { threshold: 2 } },
      { key: 'epsilon-differential-privacy', kind: 'crypto_model', thresholds: { medical_guidelines: { aggregated_statistics: { epsilon: 1.0 } } } },
    ],
    blockRuleKeys: ['block-high-partial', 'block-high-not-enhanced', 'block-cross-inst-low-k', 'block-epsilon-too-high', 'block-genetic-no-nhcc'],
  };
}

describe('evaluateCompliance', () => {
  it('RWS high-risk genomic → manual_review (spec §6 example 1)', () => {
    const input: EvaluationInput = {
      scenarioRisk: 'high',
      chosen: { anonymizationKey: 'adequate', kAnonymity: 5, epsilon: 0.5 },
      chosenSecurityCapability: 'enhanced',
      dimensions: { dataSensitivity: 'high', participantCount: 3, dataFlowChain: 'long', quasiIdentifierDensity: 8, humanGeneticResources: true, approvedByNHCC: true },
    };
    const r = evaluateCompliance(input, rules());
    expect(r.overallRisk).toBe('high');
    expect(r.required.securityCapability).toBe('enhanced');
    expect(r.required.kAnonymity).toBe(5);
    expect(r.required.lDiversity).toBe(2);
    expect(r.required.epsilon).toBe(1.0);
    expect(r.required.approvalRequired).toBe(true);
    expect(r.blockingRulesMatched).toEqual([]);
    expect(r.autoVerdict).toBe('manual_review');
    expect(r.warnings.join()).toMatch(/遗传资源|NHCC|基因/);
  });

  it('CDSS low-risk internal → auto_approve (spec §6 example 2)', () => {
    const input: EvaluationInput = {
      scenarioRisk: 'low',
      chosen: { anonymizationKey: 'adequate', kAnonymity: 5 },
      chosenSecurityCapability: 'basic',
      dimensions: { dataSensitivity: 'deidentified', participantCount: 1, dataFlowChain: 'internal', quasiIdentifierDensity: 3 },
    };
    const r = evaluateCompliance(input, rules());
    expect(r.overallRisk).toBe('low');
    expect(r.required.securityCapability).toBe('basic');
    expect(r.required.approvalRequired).toBe(false);
    expect(r.required.epsilon).toBeUndefined();
    expect(r.required.lDiversity).toBeUndefined();
    expect(r.autoVerdict).toBe('auto_approve');
    expect(r.blockingRulesMatched).toEqual([]);
  });

  it('block: high risk + partial anonymization', () => {
    const r = evaluateCompliance(
      { scenarioRisk: 'high', chosen: { anonymizationKey: 'partial', kAnonymity: 5, epsilon: 0.5 }, chosenSecurityCapability: 'enhanced', dimensions: { humanGeneticResources: false } },
      rules(),
    );
    expect(r.blockingRulesMatched).toContain('block-high-partial');
    expect(r.autoVerdict).toBe('block');
  });

  it('block: high risk + non-enhanced security', () => {
    const r = evaluateCompliance(
      { scenarioRisk: 'high', chosen: { anonymizationKey: 'adequate', kAnonymity: 5, epsilon: 0.5 }, chosenSecurityCapability: 'basic', dimensions: {} },
      rules(),
    );
    expect(r.blockingRulesMatched).toContain('block-high-not-enhanced');
  });

  it('block: cross-institution + k<5', () => {
    const r = evaluateCompliance(
      { scenarioRisk: 'medium', chosen: { anonymizationKey: 'adequate', kAnonymity: 3 }, chosenSecurityCapability: 'enhanced', dimensions: { participantCount: 2, dataFlowChain: 'cross' } },
      rules(),
    );
    expect(r.blockingRulesMatched).toContain('block-cross-inst-low-k');
  });

  it('block: epsilon > 8.0', () => {
    const r = evaluateCompliance(
      { scenarioRisk: 'medium', chosen: { anonymizationKey: 'adequate', kAnonymity: 5, epsilon: 9 }, chosenSecurityCapability: 'enhanced', dimensions: {} },
      rules(),
    );
    expect(r.blockingRulesMatched).toContain('block-epsilon-too-high');
  });

  it('block: genetic resources without NHCC approval', () => {
    const r = evaluateCompliance(
      { scenarioRisk: 'high', chosen: { anonymizationKey: 'adequate', kAnonymity: 5, epsilon: 0.5 }, chosenSecurityCapability: 'enhanced', dimensions: { humanGeneticResources: true, approvedByNHCC: false } },
      rules(),
    );
    expect(r.blockingRulesMatched).toContain('block-genetic-no-nhcc');
    expect(r.autoVerdict).toBe('block');
  });
});
