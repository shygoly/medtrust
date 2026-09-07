import { Injectable } from '@nestjs/common';
import { AuditService } from './audit';
import { Deidentifier } from './deidentifier';
import {
  bucketToContingency2x2,
  effectEstimateFromStratifiedTables,
  stratumSampleSize,
} from './comparative-effect';
import { gateKmCurve } from './km-gate';
import { AggregateResult, AggregateWarning } from './types';
import { ConfusionMatrix, ValidationResult } from './types';
import { metricsFromConfusionMatrix } from './algorithm-validation/stats';

export class OutputBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutputBlocked';
  }
}

export const DEFAULT_MIN_CELL = 5;

// 输出闸门 (D5). The last gate before anything leaves the connector. Row-level /
// identifiable output is blocked outright (5.4); aggregate small cells are
// suppressed (5.3). Only the sanitized aggregate is allowed through.
@Injectable()
export class OutputGate {
  constructor(
    private readonly audit: AuditService,
    private readonly deid: Deidentifier,
  ) {}

  pass(
    candidate: unknown,
    threshold = DEFAULT_MIN_CELL,
    meta?: { contractId?: string },
  ): AggregateResult {
    const gateTag = meta?.contractId
      ? `contract=${meta.contractId} minCell=${threshold}`
      : `minCell=${threshold}`;
    // 5.4 — block row-level / identifiable data
    if (this.deid.containsDirectIdentifier(candidate) || this.containsRowLevel(candidate)) {
      this.audit.record({
        action: 'output-blocked',
        actor: 'output-gate',
        allowed: false,
        detail: `含行级/可识别数据,拒绝放行 (${gateTag})`,
      });
      throw new OutputBlocked('输出含行级可识别数据,拒绝放行');
    }

    const agg = candidate as AggregateResult;
    if (!agg || !Array.isArray(agg.buckets)) {
      throw new OutputBlocked('输出不是合法聚合结果');
    }

    // 5.3 — small-cell / 小分层抑制
    let suppressed = 0;
    let stratumSuppressed = 0;
    const isComparative = agg.analysisType === 'comparative-effect';
    const buckets = agg.buckets.map((bucket) => {
      // L2: 按分层总样本量抑制 (任务 4.3),不用单格 a 触发.
      if (isComparative && bucket.b !== undefined) {
        const n = stratumSampleSize(bucket);
        if (n > 0 && n < threshold) {
          stratumSuppressed++;
          return {
            ...bucket,
            count: 0,
            rate: 0,
            b: 0,
            c: 0,
            d: 0,
            suppressed: true,
          };
        }
        return bucket;
      }

      if (bucket.count > 0 && bucket.count < threshold) {
        suppressed++;
        const gated = { ...bucket, count: 0, rate: 0, suppressed: true };
        // L1.5 2×2: 抑制暴露病例数 a(=count)时,整格清零 b/c/d,避免残留可推断.
        if (bucket.b !== undefined) {
          gated.b = 0;
          gated.c = 0;
          gated.d = 0;
        }
        return gated;
      }
      return bucket;
    });

    let effectEstimate = agg.effectEstimate;
    if (isComparative && stratumSuppressed > 0) {
      const remaining = buckets
        .filter((b) => !b.suppressed && b.b !== undefined)
        .map(bucketToContingency2x2);
      effectEstimate = effectEstimateFromStratifiedTables(remaining);
      this.audit.record({
        action: 'stratum-suppression',
        actor: 'output-gate',
        allowed: true,
        detail: `L2 抑制 ${stratumSuppressed} 个小分层(阈值 n≥${threshold}),重算效应量 (${gateTag})`,
      });
    }

    if (suppressed) {
      this.audit.record({
        action: 'small-cell-suppression',
        actor: 'output-gate',
        allowed: true,
        detail: `抑制 ${suppressed} 个小单元格(阈值 ${threshold}) (${gateTag})`,
      });
    }

    let kmCurve = agg.kmCurve;
    if (agg.analysisType === 'causal-survival' && kmCurve) {
      const before = kmCurve.bins.filter((b) => b.atRisk > 0 && b.atRisk < threshold).length;
      kmCurve = gateKmCurve(kmCurve, threshold);
      if (before > 0) {
        this.audit.record({
          action: 'km-tail-suppression',
          actor: 'output-gate',
          allowed: true,
          detail: `L3 抑制 ${before} 个 KM 尾部分箱(阈值 atRisk≥${threshold}) (${gateTag})`,
        });
      }
    }

    if (
      (agg.analysisType === 'causal-psm' || agg.analysisType === 'causal-survival') &&
      agg.cohortSize < threshold &&
      effectEstimate
    ) {
      effectEstimate = undefined;
      this.audit.record({
        action: 'causal-cohort-suppression',
        actor: 'output-gate',
        allowed: true,
        detail: `L3 队列规模 ${agg.cohortSize} < ${threshold},抑制效应量 (${gateTag})`,
      });
    }

    // 4.5/4.12 — statistical-power warnings. Signal-detection analyses
    // (disproportionality / adverse-event) need far larger cohorts than the
    // small-cell threshold (5). Flag the result instead of suppressing it so
    // consumers know the estimate has insufficient power.
    const warnings: AggregateWarning[] = [];
    const MIN_POWER_COHORT = 500;
    if (
      (agg.analysisType === 'disproportionality' ||
        agg.analysisType === 'adverse-event-signal') &&
      agg.cohortSize > 0 &&
      agg.cohortSize < MIN_POWER_COHORT
    ) {
      warnings.push({
        code: 'insufficient_power',
        detail: `队列 ${agg.cohortSize} < ${MIN_POWER_COHORT},失衡/不良信号检测统计效力不足`,
      });
    }
    if (
      agg.analysisType === 'disproportionality' &&
      buckets.every((b) => b.count === 0)
    ) {
      warnings.push({
        code: 'empty_buckets',
        detail: '失衡列联表全为空(无目标药暴露或事件),结果无可解释信号',
      });
    }

    if (warnings.length) {
      this.audit.record({
        action: 'power-warning',
        actor: 'output-gate',
        allowed: true,
        detail: warnings.map((w) => `${w.code}: ${w.detail}`).join('; '),
      });
    }

    return { ...agg, buckets, effectEstimate, kmCurve, warnings: warnings.length ? warnings : agg.warnings };
  }

  /**
   * L0 algorithm-validation gate (rws-algorithm-validation D3, task 4.1–4.4).
   *
   * The four accuracy metrics (Se/Sp/PPV/NPV) all share the same TP/FP/TN/FN
   * counts. If ANY cell is suppressed for being below the small-cell
   * threshold, the other three metrics are also withheld — partial release
   * would invite readers to make an overall judgment from a mutilated matrix.
   * This is the "all-or-nothing" / fail-closed rule (D-UC-2).
   *
   * The returned shape makes "suppressed for insufficient sample" structurally
   * distinct from "the algorithm performed poorly": when suppressed, `metrics`
   * is undefined and `suppressionReason` carries the reason; when not
   * suppressed, `metrics` is populated regardless of how low the accuracy is.
   */
  passValidation(
    cm: ConfusionMatrix,
    ctx: {
      algorithmId: string;
      algorithmVersion: string;
      providerId: string;
      variableDefinitionId: string;
      goldStandardSetVersion: string;
    },
    attestationLevel: 'software' | 'hardware' = 'software',
    threshold = DEFAULT_MIN_CELL,
    meta?: { contractId?: string },
  ): ValidationResult {
    const gateTag = meta?.contractId
      ? `contract=${meta.contractId} minCell=${threshold}`
      : `minCell=${threshold}`;
    const suppressed =
      cm.tp < threshold || cm.fp < threshold || cm.tn < threshold || cm.fn < threshold;

    if (suppressed) {
      this.audit.record({
        action: 'validation-suppressed',
        actor: 'output-gate',
        allowed: true,
        detail: `L0 混淆矩阵存在低于阈值(${threshold})的单元格(tp=${cm.tp}/fp=${cm.fp}/tn=${cm.tn}/fn=${cm.fn}),全部指标不出域(fail-closed) (${gateTag})`,
      });
      // Return the matrix with suppressed cells zeroed. The reason is explicit;
      // metrics is undefined so consumers cannot mistake this for poor accuracy.
      return {
        ...ctx,
        confusionMatrix: { tp: 0, fp: 0, tn: 0, fn: 0 },
        metrics: undefined,
        suppressed: true,
        suppressionReason: 'insufficient_sample',
        attestationLevel,
      };
    }

    const metrics = metricsFromConfusionMatrix(cm);
    return {
      ...ctx,
      confusionMatrix: cm,
      metrics,
      suppressed: false,
      attestationLevel,
    };
  }

  private containsRowLevel(obj: unknown): boolean {
    const json = JSON.stringify(obj ?? '');
    // pseudonymous row keys or source identifiers must never appear in output
    return json.includes('subjectKey') || json.includes('patientId');
  }
}
