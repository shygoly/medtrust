import { Injectable, Logger } from "@nestjs/common";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { AttestationService } from "../digital-contract/attestation.service";
import { RwsAssignmentEntity } from "@medtrust/database";

// L0 algorithm-validation merge (rws-algorithm-validation D6 / task 5.1).
//
// Unlike L2/L3 (random-effects meta), L0 MUST NOT pool accuracy across
// providers. The same conceptual definition may have different operational
// definitions and different algorithm performance at different sources
// (《指导原则》§2.1, §1.1). Averaging would assume the very homogeneity the
// validation is supposed to test.
//
// This service collects per-provider ValidationResults "as-is", builds a
// canonical payload, hashes it, anchors the hash on-chain (D6), and returns
// a `MetaMergeOutcome`-compatible shape that slots into `RefreshTaskOptions`
// without changing `refreshTaskStatus` (the option is already optional).

export interface L0ValidationResultShape {
  algorithmId: string;
  algorithmVersion: string;
  providerId: string;
  variableDefinitionId: string;
  goldStandardSetVersion: string;
  confusionMatrix: { tp: number; fp: number; tn: number; fn: number };
  metrics?: unknown;
  suppressed: boolean;
  suppressionReason?: string;
  attestationLevel: string;
  /** §7.3: 'synthetic' = Synthea/unit-fixture gold standard; MUST NOT be used
   * for regulatory submission. The UI/report layer surfaces this flag. */
  goldStandardProvenance?: "real" | "synthetic";
}

export interface L0MergeSuccess {
  merged: true;
  kind: "l0_validation";
  results: L0ValidationResultShape[];
  resultHash: string;
  attestation: { txHash: string; block: number; hash: string };
}

export interface L0MergeSkipped {
  merged: false;
  kind: "l0_validation";
  reason: string;
  code: "no_completed" | "single_site";
}

export type L0MergeOutcome = L0MergeSuccess | L0MergeSkipped;

@Injectable()
export class L0ValidationMergeService {
  private readonly logger = new Logger(L0ValidationMergeService.name);

  constructor(
    private readonly gm: GMCryptoService,
    private readonly attestation: AttestationService,
  ) {}

  /**
   * Collect per-provider ValidationResults from completed assignments. Hash
   * the canonical payload + anchor (D6, mirrors meta-analysis.service.ts:89-90).
   * MUST NOT sum confusion matrices across providers.
   */
  async collectResults(
    taskId: string,
    assignments: RwsAssignmentEntity[],
  ): Promise<L0MergeOutcome> {
    const completed = assignments.filter(
      (a) => a.status === "completed" && a.aggregate,
    );
    if (completed.length === 0) {
      return {
        merged: false,
        kind: "l0_validation",
        reason: "尚无连接器回传验证结果",
        code: "no_completed",
      };
    }

    const results: L0ValidationResultShape[] = [];
    for (const a of completed) {
      const vr = (a.aggregate as Record<string, unknown> | null)
        ?.validationResult;
      if (!vr || typeof vr !== "object") continue;
      results.push(this.normalize(vr as Record<string, unknown>, a.providerId));
    }

    if (results.length === 0) {
      return {
        merged: false,
        kind: "l0_validation",
        reason: "已完成的分派未携带 validationResult",
        code: "no_completed",
      };
    }

    // CRITICAL (D6): the payload is the per-provider COLLECTION, never a sum.
    // Sorting by providerId makes the hash deterministic across assignment
    // completion order AND across re-runs (the hash excludes volatile
    // timestamps so two merges of the same result set produce the same hash).
    results.sort((x, y) => x.providerId.localeCompare(y.providerId));
    const payload = {
      taskId,
      kind: "l0_validation",
      results,
    };
    const resultHash = "SM3:" + this.gm.sm3Hash(JSON.stringify(payload));
    const attestation = await this.attestation.anchor(resultHash);

    // Single-provider tasks still anchor (the spec mandates存证 for every
    // validation result); the `single_site` code is reserved for future
    // heterogeneity-reporting that would distinguish 1 vs N providers.
    return {
      merged: true,
      kind: "l0_validation",
      results,
      resultHash,
      attestation,
    };
  }

  /** Coerce the loosely-typed JSON column into a known shape. */
  private normalize(
    vr: Record<string, unknown>,
    fallbackProvider: string,
  ): L0ValidationResultShape {
    const cm = (vr.confusionMatrix ?? {}) as Record<string, unknown>;
    return {
      algorithmId: String(vr.algorithmId ?? ""),
      algorithmVersion: String(vr.algorithmVersion ?? ""),
      providerId: String(vr.providerId ?? fallbackProvider),
      variableDefinitionId: String(vr.variableDefinitionId ?? ""),
      goldStandardSetVersion: String(vr.goldStandardSetVersion ?? ""),
      confusionMatrix: {
        tp: Number(cm.tp ?? 0),
        fp: Number(cm.fp ?? 0),
        tn: Number(cm.tn ?? 0),
        fn: Number(cm.fn ?? 0),
      },
      metrics: vr.metrics,
      suppressed: Boolean(vr.suppressed),
      suppressionReason: vr.suppressionReason as string | undefined,
      attestationLevel: String(vr.attestationLevel ?? "software"),
      goldStandardProvenance: vr.goldStandardProvenance as
        | "real"
        | "synthetic"
        | undefined,
    };
  }
}
