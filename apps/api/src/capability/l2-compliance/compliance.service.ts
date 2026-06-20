import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Composition, ComplianceEvaluation,
  L1Scenario, L6Protocol, L2RiskPolicy, L2Guardrail, L2BlockRule,
} from '@medtrust/database';
import { evaluateCompliance } from './compliance-engine';
import {
  EvaluationInput, LoadedRules, Risk, SecurityLevel, RiskDimensions, ChosenParams,
} from './engine.types';
import { CreateCompositionDto } from './dto/create-composition.dto';

@Injectable()
export class ComplianceService {
  constructor(
    @InjectRepository(Composition) private readonly compositions: Repository<Composition>,
    @InjectRepository(ComplianceEvaluation) private readonly evaluations: Repository<ComplianceEvaluation>,
    @InjectRepository(L1Scenario) private readonly scenarios: Repository<L1Scenario>,
    @InjectRepository(L6Protocol) private readonly protocols: Repository<L6Protocol>,
    @InjectRepository(L2RiskPolicy) private readonly riskPolicies: Repository<L2RiskPolicy>,
    @InjectRepository(L2Guardrail) private readonly guardrails: Repository<L2Guardrail>,
    @InjectRepository(L2BlockRule) private readonly blockRules: Repository<L2BlockRule>,
  ) {}

  createComposition(dto: CreateCompositionDto): Promise<Composition> {
    const c = this.compositions.create({
      scenarioKey: dto.scenarioKey,
      modelKeys: dto.modelKeys ?? [],
      algorithmKeys: dto.algorithmKeys ?? [],
      operatorKeys: dto.operatorKeys ?? [],
      protocolKeys: dto.protocolKeys ?? [],
      infraKeys: dto.infraKeys ?? [],
      chosenParams: (dto.chosenParams as Composition['chosenParams']) ?? null,
      riskDimensions: dto.riskDimensions ?? null,
      computeTaskId: dto.computeTaskId,
    });
    return this.compositions.save(c);
  }

  getComposition(id: string): Promise<Composition | null> {
    return this.compositions.findOne({ where: { id } });
  }

  getEvaluation(compositionId: string): Promise<ComplianceEvaluation | null> {
    return this.evaluations.findOne({
      where: { compositionId },
      order: { evaluatedAt: 'DESC' },
    });
  }

  private async loadRules(): Promise<LoadedRules> {
    const [policies, guardrails, blocks] = await Promise.all([
      this.riskPolicies.find(),
      this.guardrails.find(),
      this.blockRules.find(),
    ]);
    return {
      riskPolicies: policies.map((p) => ({
        riskLevel: p.riskLevel as Risk,
        requiredAnonymizationKey: p.requiredAnonymizationKey,
        requiredSecurityCapabilityKey: p.requiredSecurityCapabilityKey,
        requiredAlgorithmKeys: p.requiredAlgorithmKeys ?? [],
        approvalRequired: p.approvalRequired,
      })),
      guardrails: guardrails.map((g) => ({ key: g.key, kind: g.kind, thresholds: g.thresholds })),
      blockRuleKeys: blocks.map((b) => b.key),
    };
  }

  // 所选协议里有 enhanced → enhanced;否则 basic;未选协议 → null。
  private async deriveSecurityCapability(protocolKeys: string[]): Promise<SecurityLevel | null> {
    if (!protocolKeys || protocolKeys.length === 0) return null;
    const rows = await this.protocols.find({ where: { key: In(protocolKeys) } });
    if (rows.length === 0) return null;
    return rows.some((p) => p.securityCapabilityLevel === 'enhanced') ? 'enhanced' : 'basic';
  }

  // fail-closed: composition 不存在 → 404;scenario/risk_policy 缺失 → 按高风险且不自动放行。
  async evaluate(compositionId: string): Promise<ComplianceEvaluation> {
    const composition = await this.compositions.findOne({ where: { id: compositionId } });
    if (!composition) throw new NotFoundException(`composition ${compositionId} 不存在`);

    const scenario = await this.scenarios.findOne({ where: { key: composition.scenarioKey } });
    const scenarioMissing = !scenario;
    const scenarioRisk: Risk = (scenario?.riskLevel as Risk) ?? 'high';

    const rules = await this.loadRules();
    const chosenSecurityCapability = await this.deriveSecurityCapability(composition.protocolKeys);

    const input: EvaluationInput = {
      scenarioRisk,
      chosen: (composition.chosenParams as ChosenParams) ?? {},
      chosenSecurityCapability,
      chosenAlgorithmKeys: composition.algorithmKeys ?? [],
      dimensions: (composition.riskDimensions as RiskDimensions) ?? {},
    };

    const result = evaluateCompliance(input, rules);

    // fail-closed 兜底: 规则数据缺失时绝不静默放行
    const structuralIssues = [...result.structuralIssues];
    let autoVerdict = result.autoVerdict;
    if (scenarioMissing) structuralIssues.push(`场景 ${composition.scenarioKey} 不存在,按高风险处理`);
    if (rules.riskPolicies.length === 0) structuralIssues.push('L2 风险策略表为空,无法判定');
    if ((scenarioMissing || rules.riskPolicies.length === 0) && autoVerdict === 'auto_approve') {
      autoVerdict = 'manual_review';
    }

    const evaluation = this.evaluations.create({
      compositionId,
      overallRisk: result.overallRisk,
      required: result.required as unknown as Record<string, unknown>,
      autoVerdict,
      blockingRulesMatched: result.blockingRulesMatched,
      warnings: result.warnings,
      structuralIssues,
    });
    return this.evaluations.save(evaluation);
  }
}
