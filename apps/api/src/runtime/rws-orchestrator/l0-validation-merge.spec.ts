import { L0ValidationMergeService } from "./l0-validation-merge";
import { AttestationService } from "../digital-contract/attestation.service";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { RwsAssignmentEntity } from "@medtrust/database";

function assignment(
  providerId: string,
  vr: Record<string, unknown> | null,
): RwsAssignmentEntity {
  return {
    assignmentId: `a-${providerId}`,
    taskId: "t1",
    providerId,
    purpose: "算法验证",
    analysis: { type: "algorithm-validation" },
    contract: {},
    status: "completed",
    progress: [],
    aggregate: vr
      ? {
          analysisType: "algorithm-validation",
          cohortSize: 30,
          buckets: [],
          validationResult: vr,
        }
      : null,
  } as unknown as RwsAssignmentEntity;
}

const vrHospitalA = {
  algorithmId: "dm2-v1",
  algorithmVersion: "1.0.0",
  providerId: "p-hospital-a",
  variableDefinitionId: "dm2",
  goldStandardSetVersion: "gs-v1",
  confusionMatrix: { tp: 80, fp: 10, tn: 85, fn: 20 },
  metrics: { sensitivity: { point: 0.8, ci95: [0.7, 0.87] } },
  suppressed: false,
  attestationLevel: "software",
};

describe("L0ValidationMergeService — D6 per-provider 分列, never summed", () => {
  let svc: L0ValidationMergeService;

  beforeEach(() => {
    svc = new L0ValidationMergeService(
      new GMCryptoService(),
      new AttestationService(new GMCryptoService()),
    );
  });

  it("returns one entry per provider — MUST NOT sum confusion matrices across providers", async () => {
    const vrB = {
      ...vrHospitalA,
      providerId: "p-hospital-b",
      confusionMatrix: { tp: 60, fp: 5, tn: 70, fn: 10 },
    };
    const out = await svc.collectResults("t1", [
      assignment("p-hospital-a", vrHospitalA),
      assignment("p-hospital-b", vrB),
    ]);
    expect(out.merged).toBe(true);
    if (!out.merged) return;
    expect(out.results).toHaveLength(2);
    expect(out.results.map((r) => r.providerId).sort()).toEqual([
      "p-hospital-a",
      "p-hospital-b",
    ]);
    // The two confusion matrices are kept distinct, never added.
    const a = out.results.find((r) => r.providerId === "p-hospital-a")!;
    const b = out.results.find((r) => r.providerId === "p-hospital-b")!;
    expect(a.confusionMatrix).toEqual({ tp: 80, fp: 10, tn: 85, fn: 20 });
    expect(b.confusionMatrix).toEqual({ tp: 60, fp: 5, tn: 70, fn: 10 });
  });

  it("anchors a result hash on-chain (D6 / mirror of meta-analysis attestation)", async () => {
    const out = await svc.collectResults("t1", [
      assignment("p-hospital-a", vrHospitalA),
    ]);
    expect(out.merged).toBe(true);
    if (!out.merged) return;
    expect(out.resultHash).toMatch(/^SM3:/);
    expect(out.attestation).toBeDefined();
    expect(out.attestation.hash).toMatch(/^SM3:/);
    expect(typeof out.attestation.txHash).toBe("string");
    expect(typeof out.attestation.block).toBe("number");
  });

  it("produces a deterministic hash regardless of assignment order", async () => {
    const vrB = { ...vrHospitalA, providerId: "p-hospital-b" };
    const o1 = await svc.collectResults("t1", [
      assignment("p-hospital-a", vrHospitalA),
      assignment("p-hospital-b", vrB),
    ]);
    const o2 = await svc.collectResults("t1", [
      assignment("p-hospital-b", vrB),
      assignment("p-hospital-a", vrHospitalA),
    ]);
    expect((o1 as { resultHash: string }).resultHash).toEqual(
      (o2 as { resultHash: string }).resultHash,
    );
  });

  it("returns merged:false when no assignment is completed yet", async () => {
    const out = await svc.collectResults("t1", [
      {
        ...assignment("p-hospital-a", null),
        status: "pending",
      } as unknown as RwsAssignmentEntity,
    ]);
    expect(out.merged).toBe(false);
  });

  it("carries suppressed flags through unchanged (does not re-evaluate)", async () => {
    const vrSuppressed = {
      ...vrHospitalA,
      confusionMatrix: { tp: 0, fp: 0, tn: 0, fn: 0 },
      metrics: undefined,
      suppressed: true,
      suppressionReason: "insufficient_sample",
    };
    const out = await svc.collectResults("t1", [
      assignment("p-hospital-a", vrSuppressed),
    ]);
    expect(out.merged).toBe(true);
    if (!out.merged) return;
    expect(out.results[0].suppressed).toBe(true);
    expect(out.results[0].metrics).toBeUndefined();
  });
});
