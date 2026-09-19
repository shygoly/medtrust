import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import {
  Composition,
  ComplianceEvaluation,
  L1Scenario,
  L6Protocol,
  L2RiskPolicy,
  L2Guardrail,
  L2BlockRule,
  LayerKind,
} from "@medtrust/database";
import { evaluateCompliance } from "./compliance-engine";
import {
  EvaluationInput,
  LoadedRules,
  Risk,
  SecurityLevel,
  RiskDimensions,
  ChosenParams,
  ComplianceRequired,
  PreReviewSnapshot,
} from "./engine.types";
import { CreateCompositionDto } from "./dto/create-composition.dto";
import { CapabilityRegistryService } from "../registry.service";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { mergeDimensions, stableStringify } from "./dimensions";

const SECURITY_ORDER: SecurityLevel[] = ["basic", "federated", "enhanced"];

@Injectable()
export class ComplianceService {
  constructor(
    @InjectRepository(Composition)
    private readonly compositions: Repository<Composition>,
    @InjectRepository(ComplianceEvaluation)
    private readonly evaluations: Repository<ComplianceEvaluation>,
    @InjectRepository(L1Scenario)
    private readonly scenarios: Repository<L1Scenario>,
    @InjectRepository(L6Protocol)
    private readonly protocols: Repository<L6Protocol>,
    @InjectRepository(L2RiskPolicy)
    private readonly riskPolicies: Repository<L2RiskPolicy>,
    @InjectRepository(L2Guardrail)
    private readonly guardrails: Repository<L2Guardrail>,
    @InjectRepository(L2BlockRule)
    private readonly blockRules: Repository<L2BlockRule>,
    private readonly registry: CapabilityRegistryService,
    private readonly gm: GMCryptoService,
  ) {}

  // 创建预审组合前校验：场景与各层所选对象都必须存在且已落地（status=active），
  // 否则拒绝并列出不合格对象（fail-closed，spec「预审只能引用已落地能力对象」）。
  private async assertObjectsActive(dto: CreateCompositionDto): Promise<void> {
    const checks: Array<[LayerKind, string[]]> = [
      [LayerKind.L1_SCENARIO, dto.scenarioKey ? [dto.scenarioKey] : []],
      [LayerKind.L3_MODEL, dto.modelKeys ?? []],
      [LayerKind.L4_ALGORITHM, dto.algorithmKeys ?? []],
      [LayerKind.L5_OPERATOR, dto.operatorKeys ?? []],
      [LayerKind.L6_PROTOCOL, dto.protocolKeys ?? []],
      [LayerKind.L7_INFRASTRUCTURE, dto.infraKeys ?? []],
    ];
    const invalid: string[] = [];
    for (const [layer, keys] of checks) {
      for (const key of keys) {
        const obj = await this.registry.get(layer, key);
        if (!obj) invalid.push(`${key}（不存在）`);
        else if (obj.status !== "active")
          invalid.push(`${key}（${obj.status}）`);
      }
    }
    if (invalid.length) {
      throw new BadRequestException(
        `预审组合含未落地或不存在的能力对象：${invalid.join("、")}`,
      );
    }
  }

  async createComposition(
    dto: CreateCompositionDto,
    ownerParticipantId?: string,
  ): Promise<Composition> {
    await this.assertObjectsActive(dto);
    const c = this.compositions.create({
      scenarioKey: dto.scenarioKey,
      modelKeys: dto.modelKeys ?? [],
      algorithmKeys: dto.algorithmKeys ?? [],
      operatorKeys: dto.operatorKeys ?? [],
      protocolKeys: dto.protocolKeys ?? [],
      infraKeys: dto.infraKeys ?? [],
      chosenParams: (dto.chosenParams as Composition["chosenParams"]) ?? null,
      riskDimensions: dto.riskDimensions ?? null,
      ownerParticipantId: ownerParticipantId ?? null,
      computeTaskId: dto.computeTaskId,
    });
    return this.compositions.save(c);
  }

  // 种子/演示专用：直接 upsert 一个 composition（跳过 active 校验，种子数据可信）。
  // 供演示合约初始化时挂配套预审快照（D-CMP-2 / design D7）。
  async upsertSeedComposition(
    id: string,
    spec: Pick<
      CreateCompositionDto,
      | "scenarioKey"
      | "modelKeys"
      | "algorithmKeys"
      | "operatorKeys"
      | "protocolKeys"
      | "infraKeys"
      | "riskDimensions"
    >,
    ownerParticipantId: string,
  ): Promise<Composition> {
    const existing = await this.compositions.findOne({ where: { id } });
    const data = {
      id,
      scenarioKey: spec.scenarioKey,
      modelKeys: spec.modelKeys ?? [],
      algorithmKeys: spec.algorithmKeys ?? [],
      operatorKeys: spec.operatorKeys ?? [],
      protocolKeys: spec.protocolKeys ?? [],
      infraKeys: spec.infraKeys ?? [],
      riskDimensions: spec.riskDimensions ?? null,
      ownerParticipantId,
    };
    return this.compositions.save(
      existing
        ? this.compositions.merge(existing, data as Partial<Composition>)
        : this.compositions.create(data as Partial<Composition>),
    );
  }

  getComposition(id: string): Promise<Composition | null> {
    return this.compositions.findOne({ where: { id } });
  }

  getEvaluation(compositionId: string): Promise<ComplianceEvaluation | null> {
    return this.evaluations.findOne({
      where: { compositionId },
      order: { evaluatedAt: "DESC" },
    });
  }

  // 列出某数据使用方创建的预审 + 最近一次裁决（供「用此预审申请合约」选择器，D-CMP-2）。
  async listByOwner(ownerParticipantId: string): Promise<
    Array<{
      id: string;
      scenarioKey: string;
      verdict: string | null;
      overallRisk: string | null;
      createdAt: Date;
    }>
  > {
    if (!ownerParticipantId) return [];
    const rows = await this.compositions.find({
      where: { ownerParticipantId },
      order: { createdAt: "DESC" },
    });
    const out = [];
    for (const c of rows) {
      const ev = await this.getEvaluation(c.id);
      out.push({
        id: c.id,
        scenarioKey: c.scenarioKey,
        verdict: ev?.autoVerdict ?? null,
        overallRisk: ev?.overallRisk ?? null,
        createdAt: c.createdAt,
      });
    }
    return out;
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
      guardrails: guardrails.map((g) => ({
        key: g.key,
        kind: g.kind,
        thresholds: g.thresholds,
      })),
      blockRuleKeys: blocks.map((b) => b.key),
    };
  }

  // 所选协议推出的保障级 = 组合内最高一级（basic < federated < enhanced）；未选协议 → null。
  private async deriveSecurityCapability(
    protocolKeys: string[],
  ): Promise<SecurityLevel | null> {
    if (!protocolKeys || protocolKeys.length === 0) return null;
    const rows = await this.protocols.find({
      where: { key: In(protocolKeys) },
    });
    if (rows.length === 0) return null;
    let best = -1;
    for (const p of rows) {
      const rank = SECURITY_ORDER.indexOf(
        p.securityCapabilityLevel as SecurityLevel,
      );
      if (rank > best) best = rank;
    }
    return best >= 0 ? SECURITY_ORDER[best] : "basic";
  }

  /**
   * 对组合做 L2 裁决并持久化。`factDimensions` 为事实推导维度（合约层：数据敏感度；
   * 任务层：参与机构数），事实优先覆盖组合自报值并标注来源（design D3）。
   * fail-closed: composition 不存在 → 404；scenario/risk_policy 缺失 → 按高风险且不自动放行。
   */
  async evaluate(
    compositionId: string,
    factDimensions: Partial<RiskDimensions> = {},
  ): Promise<ComplianceEvaluation> {
    const composition = await this.compositions.findOne({
      where: { id: compositionId },
    });
    if (!composition)
      throw new NotFoundException(`composition ${compositionId} 不存在`);

    const scenario = await this.scenarios.findOne({
      where: { key: composition.scenarioKey },
    });
    const scenarioMissing = !scenario;
    const scenarioRisk: Risk = (scenario?.riskLevel as Risk) ?? "high";

    const rules = await this.loadRules();
    const rulesDigest = "SM3:" + this.gm.sm3Hash(stableStringify(rules));
    const chosenSecurityCapability = await this.deriveSecurityCapability(
      composition.protocolKeys,
    );

    const declared = (composition.riskDimensions as RiskDimensions) ?? {};
    const merged = mergeDimensions(declared, factDimensions);

    const input: EvaluationInput = {
      scenarioRisk,
      chosen: (composition.chosenParams as ChosenParams) ?? {},
      chosenSecurityCapability,
      chosenAlgorithmKeys: composition.algorithmKeys ?? [],
      dimensions: merged.dimensions,
    };

    const result = evaluateCompliance(input, rules);

    // fail-closed 兜底: 规则数据缺失时绝不静默放行
    const structuralIssues = [...result.structuralIssues];
    let autoVerdict = result.autoVerdict;
    if (scenarioMissing)
      structuralIssues.push(
        `场景 ${composition.scenarioKey} 不存在,按高风险处理`,
      );
    if (rules.riskPolicies.length === 0)
      structuralIssues.push("L2 风险策略表为空,无法判定");
    if (
      (scenarioMissing || rules.riskPolicies.length === 0) &&
      autoVerdict === "auto_approve"
    ) {
      autoVerdict = "manual_review";
    }

    const evaluation = this.evaluations.create({
      compositionId,
      overallRisk: result.overallRisk,
      required: result.required as unknown as Record<string, unknown>,
      autoVerdict,
      blockingRulesMatched: result.blockingRulesMatched,
      warnings: result.warnings,
      structuralIssues,
      dimensions: merged.dimensions as Record<string, unknown>,
      dimensionSources: merged.sources as Record<string, string>,
      dimensionConflicts: merged.conflicts,
      rulesDigest,
    });
    return this.evaluations.save(evaluation);
  }

  // 裁决 → 写入合约、任务准入复核时用的快照（design D2）；纯投影，不落库。
  toSnapshot(e: ComplianceEvaluation): PreReviewSnapshot {
    const evaluatedAt =
      e.evaluatedAt instanceof Date
        ? e.evaluatedAt.toISOString()
        : String(e.evaluatedAt ?? new Date().toISOString());
    return {
      compositionId: e.compositionId,
      evaluationId: e.id,
      verdict: e.autoVerdict,
      overallRisk: e.overallRisk as Risk,
      required: e.required as unknown as ComplianceRequired,
      dimensions: (e.dimensions as RiskDimensions) ?? {},
      dimensionSources:
        (e.dimensionSources as PreReviewSnapshot["dimensionSources"]) ?? {},
      dimensionConflicts: e.dimensionConflicts ?? [],
      rulesDigest: e.rulesDigest ?? "",
      evaluatedAt,
    };
  }
}
