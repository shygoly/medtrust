import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { RwsAdmissionService } from "./rws-admission.service";
import { MetaAnalysisService } from "./meta-analysis.service";
import { L0ValidationMergeService } from "./l0-validation-merge";
import { AttestationService } from "../digital-contract/attestation.service";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { RwsOrchestratorService } from "./rws-orchestrator.service";
import { ContractService } from "../digital-contract/contract.service";
import { mockRepo } from "../test-utils/mock-repo";
import { RwsAssignmentEntity, RwsTaskEntity } from "@medtrust/database";
import type { RwsAnalysisSpec } from "./types";

describe("RwsAdmissionService", () => {
  let admission: RwsAdmissionService;
  const contracts = {
    get: jest.fn(),
    effectiveStatus: jest.fn().mockReturnValue("active"),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    admission = new RwsAdmissionService(
      contracts as unknown as ContractService,
    );
  });

  it("admits active contracts for consumer + purpose", async () => {
    contracts.get.mockResolvedValue({
      id: "c1",
      providerId: "p-ruijin",
      consumerId: "p-meddata",
      purpose: "慢病真实世界研究",
      status: "active",
    });
    const out = await admission.admit(["c1"], "p-meddata", "慢病真实世界研究");
    expect(out).toHaveLength(1);
  });

  it("denies purpose mismatch", async () => {
    contracts.get.mockResolvedValue({
      id: "c1",
      providerId: "p-ruijin",
      consumerId: "p-meddata",
      purpose: "药物警戒",
      status: "active",
    });
    await expect(
      admission.admit(["c1"], "p-meddata", "慢病真实世界研究"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("RwsOrchestratorService", () => {
  let orchestrator: RwsOrchestratorService;
  const contracts = {
    get: jest.fn(),
    effectiveStatus: jest.fn().mockReturnValue("active"),
  };
  const admission = {
    admit: jest.fn(),
  };
  const taskRepo = mockRepo<RwsTaskEntity>();
  const assignmentRepo = mockRepo<RwsAssignmentEntity>();

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new RwsOrchestratorService(
      admission as unknown as RwsAdmissionService,
      contracts as unknown as ContractService,
      new MetaAnalysisService(
        new GMCryptoService(),
        new AttestationService(new GMCryptoService()),
      ),
      new L0ValidationMergeService(
        new GMCryptoService(),
        new AttestationService(new GMCryptoService()),
      ),
      taskRepo,
      assignmentRepo,
    );
  });

  it("pull → complete merges aggregates", async () => {
    admission.admit.mockResolvedValue([
      {
        id: "c1",
        dataProductId: "dp1",
        providerId: "p-ruijin",
        consumerId: "p-meddata",
        purpose: "PV",
        retention: "阅后即焚",
        output: "仅聚合",
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        status: "active",
      },
    ]);

    const record = await orchestrator.submit({
      purpose: "PV",
      analysis: {
        type: "cohort-count",
        designType: "cross-sectional",
        rationale: "descriptive cohort size by age band",
      },
      contractIds: ["c1"],
      consumerId: "p-meddata",
    });

    const pending = await orchestrator.pullPending("p-ruijin");
    expect(pending).toHaveLength(1);

    const done = await orchestrator.completeAssignment(
      pending[0].assignmentId,
      "p-ruijin",
      {
        aggregate: {
          analysisType: "cohort-count",
          cohortSize: 10,
          buckets: [{ key: "30-39", count: 10, rate: 1 }],
        },
      },
    );

    expect(done.status).toBe("completed");
    expect(done.merged?.cohortSize).toBe(10);

    const persisted = await orchestrator.get(record.taskId);
    expect(persisted.status).toBe("completed");
    expect(persisted.merged?.cohortSize).toBe(10);
  });

  it("rejects completion from wrong provider", async () => {
    admission.admit.mockResolvedValue([
      {
        id: "c1",
        dataProductId: "dp1",
        providerId: "p-ruijin",
        consumerId: "p-meddata",
        purpose: "PV",
        retention: "阅后即焚",
        output: "仅聚合",
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        status: "active",
      },
    ]);
    await orchestrator.submit({
      purpose: "PV",
      analysis: {
        type: "cohort-count",
        designType: "cross-sectional",
        rationale: "descriptive cohort size by age band",
      },
      contractIds: ["c1"],
      consumerId: "p-meddata",
    });
    const pending = await orchestrator.pullPending("p-ruijin");
    await expect(
      orchestrator.completeAssignment(pending[0].assignmentId, "p-huashan", {
        aggregate: { analysisType: "cohort-count", cohortSize: 1, buckets: [] },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("L2 comparative-effect: two sites → meta pooled OR on task merged", async () => {
    admission.admit.mockResolvedValue([
      {
        id: "c1",
        dataProductId: "dp1",
        providerId: "p-huashan",
        consumerId: "p-meddata",
        purpose: "PV",
        retention: "阅后即焚",
        output: "仅聚合",
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        status: "active",
      },
      {
        id: "c2",
        dataProductId: "dp2",
        providerId: "p-ruijin",
        consumerId: "p-meddata",
        purpose: "PV",
        retention: "阅后即焚",
        output: "仅聚合",
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        status: "active",
      },
    ]);

    const record = await orchestrator.submit({
      purpose: "PV",
      analysis: {
        type: "comparative-effect",
        level: "L2",
        drug: "目标药",
        outcome: "ALT升高",
        designType: "cohort",
        rationale: "new-user cohort comparative study",
        sap: { significanceLevel: 0.05, power: 0.8, sampleSizeAssumption: 200 },
      },
      contractIds: ["c1", "c2"],
      consumerId: "p-meddata",
    });

    const agg = (beta: number, se: number) => ({
      analysisType: "comparative-effect",
      cohortSize: 50,
      outcome: "ALT升高",
      buckets: [{ key: "40-49", count: 5, rate: 0.1, b: 10, c: 2, d: 33 }],
      effectEstimate: {
        measure: "log_or" as const,
        beta,
        standardError: se,
        covariance: [
          [0.1, 0],
          [0, se * se],
        ],
        ci95: [beta - 0.2, beta + 0.2] as [number, number],
        mantelHaenszel: {
          logOr: beta,
          or: Math.exp(beta),
          standardError: se,
          ci95: [beta - 0.2, beta + 0.2] as [number, number],
        },
      },
    });

    const h = await orchestrator.pullPending("p-huashan");
    await orchestrator.completeAssignment(h[0].assignmentId, "p-huashan", {
      aggregate: agg(0.6, 0.2),
    });
    const partial = await orchestrator.get(record.taskId);
    expect(partial.merged?.metaPooled).toMatchObject({
      merged: false,
      code: "single_site",
    });

    const r = await orchestrator.pullPending("p-ruijin");
    const done = await orchestrator.completeAssignment(
      r[0].assignmentId,
      "p-ruijin",
      { aggregate: agg(0.4, 0.25) },
    );

    expect(done.status).toBe("completed");
    expect(done.merged?.metaPooled?.merged).toBe(true);
    if (done.merged?.metaPooled?.merged) {
      expect(done.merged.metaPooled.pooledOr).toBeGreaterThan(0);
      expect(done.merged.metaPooled.attestation.txHash).toMatch(/^0x/);
    }
    expect(done.attestation?.txHash).toMatch(/^0x/);
    if (done.merged?.metaPooled?.merged) {
      expect(done.attestation).toEqual(done.merged.metaPooled.attestation);
    }
  });

  describe("L0 algorithm-validation (rws-algorithm-validation)", () => {
    it("routes algorithm-validation tasks through the L0 path (no meta merge)", async () => {
      admission.admit.mockResolvedValue([
        {
          id: "c-l0",
          dataProductId: "dp1",
          providerId: "p-hospital-a",
          consumerId: "p-meddata",
          purpose: "算法验证",
          retention: "阅后即焚",
          output: "仅聚合",
          validUntil: new Date(Date.now() + 86_400_000).toISOString(),
          status: "active",
        },
      ]);

      const submitted = await orchestrator.submit({
        purpose: "算法验证",
        analysis: {
          type: "algorithm-validation",
          level: "L0",
          algorithm: {
            id: "dm2-v1",
            version: "1.0.0",
            expression: { kind: "codeset", codeset: {} },
          },
          variableDefinitionId: "dm2",
          goldStandardSetVersion: "gs-v1",
          allowedArtifacts: ["validation_metrics"],
        },
        contractIds: ["c-l0"],
        consumerId: "p-meddata",
      });

      const pending = await orchestrator.pullPending("p-hospital-a");
      expect(pending).toHaveLength(1);

      const vr = {
        algorithmId: "dm2-v1",
        algorithmVersion: "1.0.0",
        providerId: "p-hospital-a",
        variableDefinitionId: "dm2",
        goldStandardSetVersion: "gs-v1",
        confusionMatrix: { tp: 80, fp: 10, tn: 85, fn: 20 },
        metrics: { sensitivity: { point: 0.8, ci95: [0.7, 0.87] } },
        suppressed: false,
        attestationLevel: "software",
        // §7.3: provenance propagates from connector → orchestrator → merged record.
        goldStandardProvenance: "synthetic" as const,
      };
      const done = await orchestrator.completeAssignment(
        pending[0].assignmentId,
        "p-hospital-a",
        {
          aggregate: {
            analysisType: "algorithm-validation",
            cohortSize: 195,
            buckets: [],
            validationResult: vr,
          },
        },
      );

      // L0 path: task completes, l0Validation carries the per-provider result,
      // attestation is anchored, and metaPooled is NOT populated.
      expect(done.status).toBe("completed");
      expect(done.merged?.metaPooled).toBeUndefined();
      const l0 = done.merged?.l0Validation as
        | {
            merged?: boolean;
            results?: Array<{
              providerId?: string;
              goldStandardProvenance?: string;
            }>;
            attestation?: { txHash: string };
          }
        | undefined;
      expect(l0?.merged).toBe(true);
      expect(l0?.results?.[0]?.providerId).toBe("p-hospital-a");
      // §7.3: the synthetic flag survives the connector→control hop and is
      // readable by the API layer for the report/UI labeling hook.
      expect(l0?.results?.[0]?.goldStandardProvenance).toBe("synthetic");
      expect(l0?.attestation?.txHash).toMatch(/^0x/);
      // The top-level attestation is hoisted from l0Validation, matching the
      // metaPooled hoist for L2/L3.
      expect(done.attestation?.txHash).toMatch(/^0x/);

      // task 5.5 (carry-along): a subsequent lookup for the same algorithm
      // finds the validation result; a different version returns 'unknown'.
      const hit = await orchestrator.lookupValidationMetrics(
        "dm2-v1",
        "1.0.0",
        "p-hospital-a",
      );
      expect(hit.status).toBe("found");
      const miss = await orchestrator.lookupValidationMetrics(
        "dm2-v1",
        "2.0.0", // version changed → not the same result (task 5.4)
        "p-hospital-a",
      );
      expect(miss.status).toBe("unknown");

      // The submitted taskId is preserved on the L0 task record for the
      // audit trail.
      void submitted;
    });

    it("L0 with two providers keeps results 分列, never summed (D6)", async () => {
      admission.admit.mockResolvedValue([
        {
          id: "c-a",
          dataProductId: "dp1",
          providerId: "p-hospital-a",
          consumerId: "p-meddata",
          purpose: "算法验证",
          retention: "阅后即焚",
          output: "仅聚合",
          validUntil: new Date(Date.now() + 86_400_000).toISOString(),
          status: "active",
        },
        {
          id: "c-b",
          dataProductId: "dp1",
          providerId: "p-hospital-b",
          consumerId: "p-meddata",
          purpose: "算法验证",
          retention: "阅后即焚",
          output: "仅聚合",
          validUntil: new Date(Date.now() + 86_400_000).toISOString(),
          status: "active",
        },
      ]);

      await orchestrator.submit({
        purpose: "算法验证",
        analysis: {
          type: "algorithm-validation",
          level: "L0",
          algorithm: {
            id: "dm2-v1",
            version: "1.0.0",
            expression: { kind: "codeset" },
          },
          variableDefinitionId: "dm2",
        },
        contractIds: ["c-a", "c-b"],
        consumerId: "p-meddata",
      });

      const pendingA = await orchestrator.pullPending("p-hospital-a");
      const pendingB = await orchestrator.pullPending("p-hospital-b");
      await orchestrator.completeAssignment(
        pendingA[0].assignmentId,
        "p-hospital-a",
        {
          aggregate: {
            analysisType: "algorithm-validation",
            cohortSize: 100,
            buckets: [],
            validationResult: {
              algorithmId: "dm2-v1",
              algorithmVersion: "1.0.0",
              providerId: "p-hospital-a",
              variableDefinitionId: "dm2",
              confusionMatrix: { tp: 80, fp: 10, tn: 85, fn: 20 },
              suppressed: false,
              attestationLevel: "software",
            },
          },
        },
      );
      const done = await orchestrator.completeAssignment(
        pendingB[0].assignmentId,
        "p-hospital-b",
        {
          aggregate: {
            analysisType: "algorithm-validation",
            cohortSize: 100,
            buckets: [],
            validationResult: {
              algorithmId: "dm2-v1",
              algorithmVersion: "1.0.0",
              providerId: "p-hospital-b",
              variableDefinitionId: "dm2",
              confusionMatrix: { tp: 60, fp: 5, tn: 70, fn: 10 },
              suppressed: false,
              attestationLevel: "software",
            },
          },
        },
      );

      const l0 = done.merged?.l0Validation as
        | {
            results?: Array<{
              providerId?: string;
              confusionMatrix?: { tp: number; fp: number };
            }>;
          }
        | undefined;
      expect(l0?.results).toHaveLength(2);
      const ids = l0?.results?.map((r) => r.providerId).sort();
      expect(ids).toEqual(["p-hospital-a", "p-hospital-b"]);
      // Both confusion matrices kept intact, never summed into one.
      const a = l0?.results?.find((r) => r.providerId === "p-hospital-a");
      const b = l0?.results?.find((r) => r.providerId === "p-hospital-b");
      expect(a?.confusionMatrix?.tp).toBe(80);
      expect(b?.confusionMatrix?.tp).toBe(60);
    });
  });

  describe("rws-study-protocol-spec — Phase 2 admission (required + warning)", () => {
    beforeEach(() => {
      admission.admit.mockResolvedValue([
        {
          id: "c-1",
          dataProductId: "dp1",
          providerId: "p-ruijin",
          consumerId: "p-meddata",
          purpose: "PV",
          retention: "阅后即焚",
          output: "仅聚合",
          validUntil: new Date(Date.now() + 86_400_000).toISOString(),
          status: "active",
        },
      ]);
    });

    it("accepts a complete protocol with required designType + SAP", async () => {
      // Phase 2: designType + rationale are globally required; SAP required
      // for L2/L3/L4. Old-shape specs (no designType) are rejected.
      const record = await orchestrator.submit({
        purpose: "PV",
        analysis: {
          type: "cohort-count",
          designType: "cross-sectional",
          rationale: "descriptive cohort size",
        },
        contractIds: ["c-1"],
        consumerId: "p-meddata",
      });
      expect(record.status).toBe("pending");
      // protocolVersion defaults to 1 on initial submit.
      expect(record.protocolVersion).toBe(1);
    });

    it("rejects a spec missing designType (Phase 2 hard reject)", async () => {
      await expect(
        orchestrator.submit({
          purpose: "PV",
          analysis: { type: "cohort-count" }, // no designType
          contractIds: ["c-1"],
          consumerId: "p-meddata",
        }),
      ).rejects.toThrow(/designType is required/);
    });

    it("attaches protocolWarnings for the OPTIONAL missing elements only", async () => {
      // designType + SAP are now hard-required (rejected if missing) — so
      // protocolWarnings only surfaces the still-optional missingness.
      const record = await orchestrator.submit({
        purpose: "PV",
        analysis: {
          type: "comparative-effect",
          level: "L2",
          drug: "A",
          outcome: "MI",
          designType: "cohort",
          rationale: "new-user cohort",
          sap: {
            significanceLevel: 0.05,
            power: 0.8,
            sampleSizeAssumption: 200,
          },
        },
        contractIds: ["c-1"],
        consumerId: "p-meddata",
      });
      // Phase 2: designType + SAP are hard-required (validator rejects).
      // protocolWarnings only fires for still-optional fields (missingness)
      // and the free-text independence uncertainty.
      expect(record.protocolWarnings).toBeDefined();
      const warns = record.protocolWarnings ?? [];
      // Missingness is optional → warned.
      expect(warns.some((w) => w.includes("缺失值"))).toBe(true);
      // designType/SAP no longer appear in warnings (they're hard-required).
      expect(warns.some((w) => w.includes("designType"))).toBe(false);
      expect(warns.some((w) => w.includes("SAP"))).toBe(false);
      // Free-text L2 outcome → independence-not-verified warning.
      expect(warns.some((w) => w.includes("独立性未校验"))).toBe(true);
    });

    it("produces NO protocolWarnings when the protocol is complete", async () => {
      const record = await orchestrator.submit({
        purpose: "PV",
        analysis: {
          type: "comparative-effect",
          level: "L2",
          drug: "A",
          outcome: "MI",
          designType: "cohort",
          rationale: "New-user cohort, acute-onset AE.",
          sap: {
            significanceLevel: 0.05,
            power: 0.8,
            sampleSizeAssumption: 1200,
          },
          missingness: {
            mechanism: "MAR",
            imputationStrategy: "multiple imputation",
          },
          // Structured outcome ref suppresses the independence-uncertainty warning.
          outcomeAlgorithm: {
            id: "outcome-mi",
            version: "1",
            expression: { kind: "codeset" },
          },
        },
        contractIds: ["c-1"],
        consumerId: "p-meddata",
      });
      expect(record.protocolWarnings).toEqual([]);
    });

    it("rejects a protocol with designType but no rationale (paired check)", async () => {
      await expect(
        orchestrator.submit({
          purpose: "PV",
          analysis: {
            type: "cohort-count",
            designType: "cohort", // rationale missing
          },
          contractIds: ["c-1"],
          consumerId: "p-meddata",
        }),
      ).rejects.toThrow(/rationale is required when designType/);
    });

    it("rejects outcome-exposure code-set intersection (fail-closed, §2.7.4)", async () => {
      const algo = (codes: string[]) => ({
        id: `algo-${codes.join("-")}`,
        version: "1.0.0",
        expression: {
          kind: "codeset",
          codeset: {
            codeSystem: "ICD-10",
            codeSystemVersion: "2023",
            codes,
            valueSource: "discharge_dx",
            diagnosisOrder: "any",
          },
        },
      });
      await expect(
        orchestrator.submit({
          purpose: "PV",
          analysis: {
            type: "comparative-effect",
            level: "L2",
            designType: "cohort",
            rationale: "test fixture",
            sap: { significanceLevel: 0.05 },
            outcomeAlgorithm: algo(["I21", "E11.9"]),
            exposureAlgorithm: algo(["E11.9"]), // intersection
          },
          contractIds: ["c-1"],
          consumerId: "p-meddata",
        }),
      ).rejects.toThrow(/编码交集/);
    });
  });

  describe("rws-study-protocol-spec — Phase 3 freeze (D1 first-dispatch)", () => {
    beforeEach(() => {
      admission.admit.mockResolvedValue([
        {
          id: "c-1",
          dataProductId: "dp1",
          providerId: "p-ruijin",
          consumerId: "p-meddata",
          purpose: "PV",
          retention: "阅后即焚",
          output: "仅聚合",
          validUntil: new Date(Date.now() + 86_400_000).toISOString(),
          status: "active",
        },
      ]);
    });

    it("sets frozenAt on first dispatch (pullPending pending → running)", async () => {
      const submitted = await orchestrator.submit({
        purpose: "PV",
        analysis: {
          type: "cohort-count",
          designType: "cross-sectional",
          rationale: "fixture",
        },
        contractIds: ["c-1"],
        consumerId: "p-meddata",
      });
      expect(submitted.status).toBe("pending");

      const before = Date.now();
      await orchestrator.pullPending("p-ruijin");
      const after = Date.now();

      const task = await taskRepo.findOne({
        where: { taskId: submitted.taskId },
      });
      expect(task?.status).toBe("running");
      expect(task?.frozenAt).toBeInstanceOf(Date);
      const frozenMs = task!.frozenAt!.getTime();
      expect(frozenMs).toBeGreaterThanOrEqual(before);
      expect(frozenMs).toBeLessThanOrEqual(after);
    });

    it("frozenAt is idempotent — re-dispatch does not change it", async () => {
      const submitted = await orchestrator.submit({
        purpose: "PV",
        analysis: {
          type: "cohort-count",
          designType: "cross-sectional",
          rationale: "fixture",
        },
        contractIds: ["c-1"],
        consumerId: "p-meddata",
      });
      await orchestrator.pullPending("p-ruijin");
      const firstFrozen = (await taskRepo.findOne({
        where: { taskId: submitted.taskId },
      }))!.frozenAt;
      expect(firstFrozen).toBeInstanceOf(Date);

      // Simulate the same provider pulling again (e.g. retry) — frozenAt stays.
      // (In practice pullPending has no more pending assignments; we set the
      // assignment back to pending to simulate a re-dispatch.)
      const assignment = await assignmentRepo.findOne({
        where: { taskId: submitted.taskId },
      });
      if (assignment) {
        assignment.status = "pending";
        await assignmentRepo.save(assignment);
      }
      await new Promise((r) => setTimeout(r, 10));
      await orchestrator.pullPending("p-ruijin");
      const refrozen = (await taskRepo.findOne({
        where: { taskId: submitted.taskId },
      }))!.frozenAt;
      expect(refrozen?.getTime()).toBe(firstFrozen!.getTime());
    });
  });

  describe("rws-study-protocol-spec — Phase 3 revise endpoint (version + unfreeze)", () => {
    const protocolV1: RwsAnalysisSpec = {
      type: "cohort-count",
      designType: "cross-sectional",
      rationale: "v1 descriptive",
    };
    const protocolV2: RwsAnalysisSpec = {
      type: "cohort-count",
      designType: "cross-sectional",
      rationale: "v2 — refine inclusion after chart review",
    };

    beforeEach(() => {
      admission.admit.mockResolvedValue([
        {
          id: "c-1",
          dataProductId: "dp1",
          providerId: "p-ruijin",
          consumerId: "p-meddata",
          purpose: "PV",
          retention: "阅后即焚",
          output: "仅聚合",
          validUntil: new Date(Date.now() + 86_400_000).toISOString(),
          status: "active",
        },
      ]);
    });

    it("creates a new version with revisionReason + bumps protocolVersion + resets frozenAt", async () => {
      const v1 = await orchestrator.submit({
        purpose: "PV",
        analysis: protocolV1,
        contractIds: ["c-1"],
        consumerId: "p-meddata",
      });
      // Freeze the v1.
      await orchestrator.pullPending("p-ruijin");
      const frozenV1 = (await taskRepo.findOne({
        where: { taskId: v1.taskId },
      }))!.frozenAt;
      expect(frozenV1).toBeInstanceOf(Date);

      // Revise to v2.
      const v2 = await orchestrator.revise(v1.taskId, {
        analysis: protocolV2,
        revisionReason: "chart review suggested refining inclusion criteria",
        consumerId: "p-meddata",
      });
      expect(v2.protocolVersion).toBe(2);
      const task = await taskRepo.findOne({ where: { taskId: v1.taskId } });
      expect(task?.protocolVersion).toBe(2);
      expect(task?.revisionReason).toBe(
        "chart review suggested refining inclusion criteria",
      );
      expect(task?.revisedAt).toBeInstanceOf(Date);
      expect(task?.frozenAt).toBeNull(); // new version starts unfrozen
      expect(task?.status).toBe("pending");
      expect(task?.merged).toBeNull();
      // Old assignments are deleted (mock stubbed) and a fresh pending one
      // is created. The mock repo doesn't truly persist the delete/create
      // cycle, so we assert on the returned record carrying the new assignment.
      expect(v2.assignments).toHaveLength(1);
      expect(v2.assignments[0].status).toBe("pending");
    });

    it("rejects revise without revisionReason", async () => {
      const v1 = await orchestrator.submit({
        purpose: "PV",
        analysis: protocolV1,
        contractIds: ["c-1"],
        consumerId: "p-meddata",
      });
      await expect(
        orchestrator.revise(v1.taskId, {
          analysis: protocolV2,
          revisionReason: "",
          consumerId: "p-meddata",
        }),
      ).rejects.toThrow(/revisionReason/);
    });

    it("rejects revise from wrong consumer (ownership)", async () => {
      const v1 = await orchestrator.submit({
        purpose: "PV",
        analysis: protocolV1,
        contractIds: ["c-1"],
        consumerId: "p-meddata",
      });
      await expect(
        orchestrator.revise(v1.taskId, {
          analysis: protocolV2,
          revisionReason: "x",
          consumerId: "p-other-consumer",
        }),
      ).rejects.toThrow(/仅任务发起方可修订/);
    });

    it("rejects revise with an invalid analysis (re-validates)", async () => {
      const v1 = await orchestrator.submit({
        purpose: "PV",
        analysis: protocolV1,
        contractIds: ["c-1"],
        consumerId: "p-meddata",
      });
      await expect(
        orchestrator.revise(v1.taskId, {
          analysis: {
            type: "comparative-effect",
            level: "L2",
            // missing designType + sap — Phase 2 hard reject
          } as never,
          revisionReason: "x",
          consumerId: "p-meddata",
        }),
      ).rejects.toThrow(/designType is required|sap is required/);
    });

    it("returns 404 for an unknown taskId", async () => {
      await expect(
        orchestrator.revise("nonexistent-task-id", {
          analysis: protocolV1,
          revisionReason: "x",
          consumerId: "p-meddata",
        }),
      ).rejects.toThrow(/不存在/);
    });
  });

  describe("L2-sap-lock — run-log model signature consistency", () => {
    // L2-sap-lock acceptance 2: the model signature frozen in the SAP MUST
    // match the actual model signature recorded in the main-analysis run log.
    // Today the orchestrator neither records an actualModelSignature nor
    // enforces the match — these tests are RED until the Green phase adds it.
    const admitTwoSites = () =>
      admission.admit.mockResolvedValue([
        {
          id: "c1",
          dataProductId: "dp1",
          providerId: "p-huashan",
          consumerId: "p-meddata",
          purpose: "PV",
          retention: "阅后即焚",
          output: "仅聚合",
          validUntil: new Date(Date.now() + 86_400_000).toISOString(),
          status: "active",
        },
        {
          id: "c2",
          dataProductId: "dp2",
          providerId: "p-ruijin",
          consumerId: "p-meddata",
          purpose: "PV",
          retention: "阅后即焚",
          output: "仅聚合",
          validUntil: new Date(Date.now() + 86_400_000).toISOString(),
          status: "active",
        },
      ]);

    // SAP frozen at submission time: version-controlled (sapVersion) with a
    // date stamp (frozenAt) and a declared model signature (modelSignature).
    const lockedSap = {
      significanceLevel: 0.05,
      power: 0.8,
      sampleSizeAssumption: 200,
      sapVersion: "v1",
      frozenAt: "2026-08-01T00:00:00.000Z",
      modelSignature: "sap-sig:cohort|log_or|age,sex",
    };
    const lockedL2Analysis = {
      type: "comparative-effect",
      level: "L2",
      drug: "目标药",
      outcome: "ALT升高",
      designType: "cohort",
      rationale: "new-user cohort comparative study",
      sap: lockedSap,
    } as unknown as RwsAnalysisSpec;

    const agg = (beta: number, se: number) => ({
      analysisType: "comparative-effect",
      cohortSize: 50,
      outcome: "ALT升高",
      buckets: [{ key: "40-49", count: 5, rate: 0.1, b: 10, c: 2, d: 33 }],
      effectEstimate: {
        measure: "log_or" as const,
        beta,
        standardError: se,
        covariance: [
          [0.1, 0],
          [0, se * se],
        ],
        ci95: [beta - 0.2, beta + 0.2] as [number, number],
        mantelHaenszel: {
          logOr: beta,
          or: Math.exp(beta),
          standardError: se,
          ci95: [beta - 0.2, beta + 0.2] as [number, number],
        },
      },
    });

    it("records an actualModelSignature in the merged run log equal to the SAP-declared signature", async () => {
      admitTwoSites();
      await orchestrator.submit({
        purpose: "PV",
        analysis: lockedL2Analysis,
        contractIds: ["c1", "c2"],
        consumerId: "p-meddata",
      });

      const h = await orchestrator.pullPending("p-huashan");
      await orchestrator.completeAssignment(h[0].assignmentId, "p-huashan", {
        aggregate: agg(0.6, 0.2),
      });
      const r = await orchestrator.pullPending("p-ruijin");
      const done = await orchestrator.completeAssignment(
        r[0].assignmentId,
        "p-ruijin",
        { aggregate: agg(0.4, 0.25) },
      );

      // The run log (merged result) must carry the actual model signature
      // used for the main analysis, and it must equal the frozen SAP's.
      const merged = done.merged as unknown as
        | Record<string, unknown>
        | undefined;
      expect(merged?.actualModelSignature).toBe(lockedSap.modelSignature);
    });

    it("fails closed when the actual run-log signature diverges from the frozen SAP signature", async () => {
      admitTwoSites();
      await orchestrator.submit({
        purpose: "PV",
        analysis: lockedL2Analysis,
        contractIds: ["c1", "c2"],
        consumerId: "p-meddata",
      });

      const h = await orchestrator.pullPending("p-huashan");
      await orchestrator.completeAssignment(h[0].assignmentId, "p-huashan", {
        aggregate: agg(0.6, 0.2),
      });
      const r = await orchestrator.pullPending("p-ruijin");

      // The aggregate produced by the run reports an actual model signature
      // that does NOT reproduce the frozen SAP signature — the orchestrator
      // MUST refuse to lock the results instead of silently emitting a
      // mismatched run log.
      await expect(
        orchestrator.completeAssignment(r[0].assignmentId, "p-ruijin", {
          aggregate: {
            ...agg(0.4, 0.25),
            actualModelSignature: "sap-sig:cohort|log_or|age-only",
          },
        }),
      ).rejects.toThrow(/signature|不一致|mismatch/i);
    });
  });
});
