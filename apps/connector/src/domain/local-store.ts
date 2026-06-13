import { Injectable } from '@nestjs/common';
import { InternalRecord, AccessContext } from './types';
import { AuditService } from './audit';

// 原始数据不出域守卫 (data-space-connector spec 3.4).
//
// The de-identified rows live here and physically have no external read path.
// `aggregateInternal` is the ONLY way to derive anything from them, and it
// returns derived values, never the rows. Any attempt to pull rows out with an
// external origin is refused and audited.
@Injectable()
export class LocalStore {
  private rows: InternalRecord[] = [];

  constructor(private readonly audit: AuditService) {}

  ingest(records: InternalRecord[]): void {
    this.rows.push(...records);
    this.audit.record({ action: 'ingest', actor: 'internal', allowed: true, detail: `${records.length} 条` });
  }

  count(): number {
    return this.rows.length;
  }

  // Internal-only compute over the local rows. The reducer receives the rows
  // but the caller is internal compute (TEE in production); only the derived
  // value is returned to callers up the chain.
  aggregateInternal<T>(ctx: AccessContext, reducer: (rows: readonly InternalRecord[]) => T): T {
    if (ctx.origin !== 'internal') {
      this.audit.record({ action: 'compute', actor: ctx.actor, allowed: false, detail: '非内部上下文' });
      throw new RawAccessDeniedError('compute requires internal context');
    }
    return reducer(this.rows);
  }

  // Guarded raw access. External origin is always denied — raw rows never leave.
  exportRaw(ctx: AccessContext): InternalRecord[] {
    if (ctx.origin === 'external') {
      this.audit.record({
        action: 'raw-read-blocked',
        actor: ctx.actor,
        allowed: false,
        detail: '拒绝读取行级原始数据(数据不出域)',
      });
      throw new RawAccessDeniedError('raw row-level data may not leave the connector');
    }
    this.audit.record({ action: 'raw-read', actor: ctx.actor, allowed: true });
    return [...this.rows];
  }
}

export class RawAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RawAccessDeniedError';
  }
}
