import { Injectable } from "@nestjs/common";
import { SecretFlowTaskSpec } from "../../compute-task/dto/secretflow-task-spec";
import { NodeCapabilityProfile, NodePlan, NodeTier } from "./types";

/**
 * Heterogeneous compute adaptation (design §3 Step 2).
 *
 * Scores each participant's hardware and produces a per-node execution plan:
 * - Nodes with a TEE + confidential GPU run the full feature-extraction + LoRA
 *   fine-tuning workload locally (`teeu_full`).
 * - Weaker nodes are degraded to lightweight local feature extraction (`pyu_only`)
 *   and offload encrypted features/aggregation to the shared TEEU pool.
 */
@Injectable()
export class NodeCapabilityService {
  /** Build a node plan for every party, applying degrade rules. */
  plan(
    spec: SecretFlowTaskSpec,
    profiles: NodeCapabilityProfile[] = [],
  ): NodePlan[] {
    const byId = new Map(profiles.map((p) => [p.participantId, p]));
    return spec.parties.map((party) => {
      const profile = byId.get(party.participantId) ?? {
        participantId: party.participantId,
      };
      return this.planForNode(spec, profile);
    });
  }

  private planForNode(
    spec: SecretFlowTaskSpec,
    profile: NodeCapabilityProfile,
  ): NodePlan {
    const tier = this.evaluateTier(spec, profile);
    const device = profile.device ?? (tier === "teeu_full" ? "GPU" : "CPU");

    if (tier === "teeu_full") {
      return {
        participantId: profile.participantId,
        tier,
        device,
        offloadAggregation: false,
        localEpochs: 2,
        rationale:
          "TEE + confidential GPU present: full local multimodal feature extraction + LoRA fine-tuning.",
      };
    }

    return {
      participantId: profile.participantId,
      tier,
      device,
      offloadAggregation: true,
      localEpochs: 1,
      rationale: this.degradeRationale(spec, profile),
    };
  }

  private evaluateTier(
    spec: SecretFlowTaskSpec,
    profile: NodeCapabilityProfile,
  ): NodeTier {
    // teeRequired hard-gates: without a TEE the node cannot run the confidential
    // local workload, so it is degraded to PYU-only feature extraction.
    const hasTee = profile.hasTee ?? false;
    const hasGpu = profile.hasConfidentialGpu ?? false;
    const enoughMem = (profile.gpuMemoryGb ?? 0) >= 24;

    if (spec.privacy.teeRequired && !hasTee) {
      return "pyu_only";
    }
    if (hasTee && hasGpu && enoughMem) {
      return "teeu_full";
    }
    return "pyu_only";
  }

  private degradeRationale(
    spec: SecretFlowTaskSpec,
    profile: NodeCapabilityProfile,
  ): string {
    const reasons: string[] = [];
    if (spec.privacy.teeRequired && !profile.hasTee) {
      reasons.push("no TEE for a TEE-required task");
    }
    if (!profile.hasConfidentialGpu) {
      reasons.push("no confidential GPU");
    }
    if ((profile.gpuMemoryGb ?? 0) < 24) {
      reasons.push("insufficient GPU memory (<24GB)");
    }
    const why = reasons.length ? reasons.join("; ") : "limited capability";
    return `Degraded to PYU-only feature extraction (${why}); encrypted features offloaded to shared TEEU pool.`;
  }
}
