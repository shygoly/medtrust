import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { NotFoundException } from "@nestjs/common";
import {
  Composition,
  ComplianceEvaluation,
  L1Scenario,
  L6Protocol,
  L2RiskPolicy,
  L2Guardrail,
  L2BlockRule,
} from "@medtrust/database";
import { ComplianceService } from "./compliance.service";
import { CapabilityRegistryService } from "../registry.service";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";

const riskPolicies = [
  {
    riskLevel: "high",
    requiredAnonymizationKey: "adequate_or_complete",
    requiredSecurityCapabilityKey: "enhanced",
    requiredAlgorithmKeys: ["DP-SGD", "DP-Query"],
    approvalRequired: true,
  },
  {
    riskLevel: "low",
    requiredAnonymizationKey: "partial_or_above",
    requiredSecurityCapabilityKey: "basic",
    requiredAlgorithmKeys: [],
    approvalRequired: false,
  },
];
const guardrails = [
  {
    key: "k-anonymity",
    kind: "privacy_model",
    thresholds: { medical_general: 5, high_risk: 11 },
  },
  { key: "l-diversity", kind: "privacy_model", thresholds: { threshold: 2 } },
  {
    key: "epsilon-differential-privacy",
    kind: "crypto_model",
    thresholds: {
      medical_guidelines: { aggregated_statistics: { epsilon: 1.0 } },
    },
  },
];
const blockRows = [
  "block-high-partial",
  "block-high-not-enhanced",
  "block-cross-inst-low-k",
  "block-epsilon-too-high",
  "block-genetic-no-nhcc",
].map((key) => ({ key }));

describe("ComplianceService", () => {
  const composition = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const evaluation = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: "eval-1", ...x })),
  };
  const scenario = { findOne: jest.fn() };
  const protocol = { find: jest.fn() };
  const riskPolicy = { find: jest.fn(async () => riskPolicies) };
  const guardrail = { find: jest.fn(async () => guardrails) };
  const blockRule = { find: jest.fn(async () => blockRows) };
  const registry = { get: jest.fn() };
  const gm = { sm3Hash: jest.fn(() => "digest") };
  let svc: ComplianceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComplianceService,
        { provide: getRepositoryToken(Composition), useValue: composition },
        {
          provide: getRepositoryToken(ComplianceEvaluation),
          useValue: evaluation,
        },
        { provide: getRepositoryToken(L1Scenario), useValue: scenario },
        { provide: getRepositoryToken(L6Protocol), useValue: protocol },
        { provide: getRepositoryToken(L2RiskPolicy), useValue: riskPolicy },
        { provide: getRepositoryToken(L2Guardrail), useValue: guardrail },
        { provide: getRepositoryToken(L2BlockRule), useValue: blockRule },
        { provide: CapabilityRegistryService, useValue: registry },
        { provide: GMCryptoService, useValue: gm },
      ],
    }).compile();
    svc = module.get(ComplianceService);
    jest.clearAllMocks();
  });

  it("evaluates a high-risk composition → manual_review, derives enhanced from protocols, persists", async () => {
    composition.findOne.mockResolvedValue({
      id: "c1",
      scenarioKey: "real-world-study-rws",
      protocolKeys: ["tee-sgx"],
      chosenParams: {
        anonymizationKey: "adequate",
        kAnonymity: 5,
        epsilon: 0.5,
      },
      riskDimensions: {
        participantCount: 3,
        humanGeneticResources: true,
        approvedByNHCC: true,
      },
    });
    scenario.findOne.mockResolvedValue({
      key: "real-world-study-rws",
      riskLevel: "high",
    });
    protocol.find.mockResolvedValue([
      { key: "tee-sgx", securityCapabilityLevel: "enhanced" },
    ]);

    const r = await svc.evaluate("c1");
    expect(r.overallRisk).toBe("high");
    expect(r.autoVerdict).toBe("manual_review");
    expect(r.blockingRulesMatched).toEqual([]);
    expect(evaluation.save).toHaveBeenCalledTimes(1);
  });

  it("fail-closed: missing scenario → high risk, never auto_approve", async () => {
    composition.findOne.mockResolvedValue({
      id: "c2",
      scenarioKey: "ghost",
      protocolKeys: ["guomi-sm4"],
      chosenParams: { anonymizationKey: "adequate", kAnonymity: 5 },
      riskDimensions: {},
    });
    scenario.findOne.mockResolvedValue(null);
    protocol.find.mockResolvedValue([
      { key: "guomi-sm4", securityCapabilityLevel: "basic" },
    ]);

    const r = await svc.evaluate("c2");
    expect(r.overallRisk).toBe("high");
    expect(r.autoVerdict).not.toBe("auto_approve");
    expect(r.structuralIssues.join()).toMatch(/不存在/);
  });

  it("throws NotFound for an unknown composition", async () => {
    composition.findOne.mockResolvedValue(null);
    await expect(svc.evaluate("nope")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // 2.1 创建预审校验对象已落地
  it("createComposition 拒绝未落地(draft)对象并列出", async () => {
    registry.get.mockImplementation(async (_layer, key) =>
      key === "tee-sgx" ? { key, status: "draft" } : { key, status: "active" },
    );
    await expect(
      svc.createComposition(
        { scenarioKey: "s", protocolKeys: ["tee-sgx"] } as any,
        "p-meddata",
      ),
    ).rejects.toThrow(/tee-sgx/);
    expect(composition.save).not.toHaveBeenCalled();
  });

  it("createComposition 拒绝不存在的对象", async () => {
    registry.get.mockResolvedValue(null);
    await expect(
      svc.createComposition({ scenarioKey: "ghost" } as any, "p-meddata"),
    ).rejects.toThrow(/ghost/);
  });

  it("createComposition 全部 active 时落库并记归属", async () => {
    registry.get.mockResolvedValue({ status: "active" });
    composition.create.mockImplementation((x: any) => x);
    composition.save.mockImplementation(async (x: any) => ({ id: "c9", ...x }));
    const c = await svc.createComposition(
      { scenarioKey: "s", modelKeys: ["m"] } as any,
      "p-meddata",
    );
    expect(c.ownerParticipantId).toBe("p-meddata");
  });

  // 2.2 / 2.3 推导覆盖自报 + 冲突 + 规则摘要
  it("事实维度覆盖自报值、记录冲突、升风险、带规则摘要", async () => {
    composition.findOne.mockResolvedValue({
      id: "c3",
      scenarioKey: "rws",
      protocolKeys: [],
      chosenParams: {},
      riskDimensions: { participantCount: 2 },
    });
    scenario.findOne.mockResolvedValue({ key: "rws", riskLevel: "medium" });
    protocol.find.mockResolvedValue([]);
    const r = await svc.evaluate("c3", { participantCount: 3 });
    expect(r.overallRisk).toBe("high"); // 3 家机构上调
    expect((r.dimensionSources as any).participantCount).toBe("derived");
    expect(r.dimensionConflicts.join()).toMatch(/participantCount/);
    expect(r.rulesDigest).toMatch(/^SM3:/);
  });
});
