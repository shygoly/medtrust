import { Injectable } from '@nestjs/common';
import { AuditService } from './audit';
import { Deidentifier } from './deidentifier';
import {
  bucketToContingency2x2,
  effectEstimateFromStratifiedTables,
  stratumSampleSize,
} from './comparative-effect';
import { gateKmCurve } from './km-gate';
import { AggregateResult } from './types';

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

  pass(candidate: unknown, threshold = DEFAULT_MIN_CELL): AggregateResult {
    // 5.4 — block row-level / identifiable data
    if (this.deid.containsDirectIdentifier(candidate) || this.containsRowLevel(candidate)) {
      this.audit.record({
        action: 'output-blocked',
        actor: 'output-gate',
        allowed: false,
        detail: '含行级/可识别数据,拒绝放行',
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
        detail: `L2 抑制 ${stratumSuppressed} 个小分层(阈值 n≥${threshold}),重算效应量`,
      });
    }

    if (suppressed) {
      this.audit.record({
        action: 'small-cell-suppression',
        actor: 'output-gate',
        allowed: true,
        detail: `抑制 ${suppressed} 个小单元格(阈值 ${threshold})`,
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
          detail: `L3 抑制 ${before} 个 KM 尾部分箱(阈值 atRisk≥${threshold})`,
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
        detail: `L3 队列规模 ${agg.cohortSize} < ${threshold},抑制效应量`,
      });
    }

    return { ...agg, buckets, effectEstimate, kmCurve };
  }

  private containsRowLevel(obj: unknown): boolean {
    const json = JSON.stringify(obj ?? '');
    // pseudonymous row keys or source identifiers must never appear in output
    return json.includes('subjectKey') || json.includes('patientId');
  }
}
