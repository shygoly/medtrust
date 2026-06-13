import { Injectable } from '@nestjs/common';
import { AuditService } from './audit';
import { Deidentifier } from './deidentifier';
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

    // 5.3 — small-cell suppression
    let suppressed = 0;
    const buckets = agg.buckets.map((b) => {
      if (b.count > 0 && b.count < threshold) {
        suppressed++;
        return { ...b, count: 0, rate: 0, suppressed: true };
      }
      return b;
    });
    if (suppressed) {
      this.audit.record({
        action: 'small-cell-suppression',
        actor: 'output-gate',
        allowed: true,
        detail: `抑制 ${suppressed} 个小单元格(阈值 ${threshold})`,
      });
    }
    return { ...agg, buckets };
  }

  private containsRowLevel(obj: unknown): boolean {
    const json = JSON.stringify(obj ?? '');
    // pseudonymous row keys or source identifiers must never appear in output
    return json.includes('subjectKey') || json.includes('patientId');
  }
}
