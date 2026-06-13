import { Injectable } from '@nestjs/common';

export interface AuditEntry {
  action: string;
  actor: string;
  allowed: boolean;
  detail?: string;
  at: Date;
}

// Local audit log (connector-local). In production this persists to the
// connector's local_audit_log table and reports digests on-chain; here it is
// in-memory so the loop is verifiable without a DB.
@Injectable()
export class AuditService {
  private entries: AuditEntry[] = [];

  record(e: Omit<AuditEntry, 'at'>): void {
    this.entries.push({ ...e, at: new Date() });
  }

  all(): AuditEntry[] {
    return [...this.entries];
  }

  blocked(): AuditEntry[] {
    return this.entries.filter((e) => !e.allowed);
  }
}
