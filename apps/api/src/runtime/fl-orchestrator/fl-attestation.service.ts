import { Injectable } from "@nestjs/common";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { AttestationService } from "../digital-contract/attestation.service";
import { FlRunResult } from "../../compute-task/dto/fl-run-result";

/** L4 联邦预测合并结果存证 (任务 6.3). */
@Injectable()
export class FlAttestationService {
  constructor(
    private readonly gm: GMCryptoService,
    private readonly attestation: AttestationService,
  ) {}

  /** SM3 指纹 + 链上锚定 modelHash / AUC / F1,不含明文权重. */
  async attestMergedResult(
    result: FlRunResult,
    taskId: string,
  ): Promise<FlRunResult> {
    const payload = {
      taskId,
      modelHash: result.modelHash,
      modelType: result.modelType,
      roundsCompleted: result.roundsCompleted,
      metrics: {
        auc: result.aggregateMetrics.auc,
        f1: result.aggregateMetrics.f1,
      },
      partyHashes: result.partyContributions
        .map((p) => p.localModelHash)
        .sort(),
      attestedAt: new Date().toISOString(),
    };
    const reportHash = "SM3:" + this.gm.sm3Hash(JSON.stringify(payload));
    const receipt = await this.attestation.anchor(reportHash, undefined, {
      kind: "output",
      subjectType: "fl-task",
      subjectId: taskId,
    });
    return {
      ...result,
      attestation: {
        reportHash,
        runtime: result.attestation?.runtime ?? "connector-ml",
        generatedAt: payload.attestedAt,
        specHash: result.attestation?.specHash ?? `task:${taskId}`,
        chainTxHash: receipt.txHash,
        chainBlock: receipt.block,
      },
    };
  }
}
