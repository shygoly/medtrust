import { Injectable, Logger } from "@nestjs/common";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { AttestationService } from "../digital-contract/attestation.service";
import {
  MetaAnalysisResult,
  MetaInputRejected,
  SiteEffectEstimate,
  derSimonianLaird,
  fingerprintSiteEffects,
  validateSiteEffects,
} from "./meta-analysis";

export interface MetaMergeSuccess {
  merged: true;
  result: MetaAnalysisResult;
  inputFingerprint: string;
  resultHash: string;
  attestation: { txHash: string; block: number; hash: string };
}

export interface MetaMergeSkipped {
  merged: false;
  reason: string;
  code: "single_site";
}

export type MetaMergeOutcome = MetaMergeSuccess | MetaMergeSkipped;

@Injectable()
export class MetaAnalysisService {
  private readonly logger = new Logger(MetaAnalysisService.name);

  constructor(
    private readonly gm: GMCryptoService,
    private readonly attestation: AttestationService,
  ) {}

  /**
   * 随机效应 meta 合并 + 存证 (任务 3.1 + 3.3).
   * 输入校验失败抛 MetaInputRejected (任务 3.2).
   */
  async mergeSiteEffects(input: unknown, taskId?: string): Promise<MetaMergeOutcome> {
    let sites;
    try {
      sites = validateSiteEffects(input);
    } catch (err) {
      if (err instanceof MetaInputRejected && err.code === "row_level") {
        this.logger.warn(
          JSON.stringify({
            event: "meta_input_rejected",
            code: err.code,
            taskId: taskId ?? null,
            reason: err.message,
          }),
        );
      }
      throw err;
    }
    if (sites.length < 2) {
      return {
        merged: false,
        reason: "仅一个有效站点返回效应量,无法做随机效应 meta",
        code: "single_site",
      };
    }

    const result = derSimonianLaird(sites);
    const inputFingerprint =
      "SM3:" + this.gm.sm3Hash(fingerprintSiteEffects(sites));
    const mergedAt = new Date().toISOString();
    const resultPayload = {
      taskId: taskId ?? null,
      method: result.method,
      mergedAt,
      k: result.k,
      pooledEffect: +result.pooledEffect.toFixed(6),
      pooledSe: +result.pooledSe.toFixed(6),
      ci95: result.ci95.map((x) => +x.toFixed(6)),
      heterogeneity: {
        q: +result.heterogeneity.q.toFixed(6),
        df: result.heterogeneity.df,
        tau2: +result.heterogeneity.tau2.toFixed(6),
        i2Percent: +result.heterogeneity.i2Percent.toFixed(4),
      },
    };
    const resultHash = "SM3:" + this.gm.sm3Hash(JSON.stringify(resultPayload));
    const receipt = await this.attestation.anchor(resultHash);

    return {
      merged: true,
      result,
      inputFingerprint,
      resultHash,
      attestation: receipt,
    };
  }

  /** 供编排层在持久化前校验站点效应量形状. */
  parseSiteEffects(input: unknown): SiteEffectEstimate[] {
    return validateSiteEffects(input);
  }

  isRowLevelRejection(err: unknown): err is MetaInputRejected {
    return err instanceof MetaInputRejected && err.code === "row_level";
  }
}
