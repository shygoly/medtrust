import { Injectable } from '@nestjs/common';
import { SETTLEMENT_RECORDS } from '@medtrust/demo-scenario';

export interface SettlementLine {
  org: string;
  participantId: string;
  contribution: number;
  amount: number;
}

export interface SettlementRecord {
  id: string;
  taskId: string;
  taskRef: string; // task attestation hash
  consumer: string;
  consumerId: string;
  currency: string;
  contributionTotal: number;
  total: number;
  lines: SettlementLine[];
  hash: string;
  at: string;
}

// 价值共创结算台账(控制面)。按角色控权查询:提供方见自身收益、使用方见自身
// 费用、运营方见全局(value-settlement 10.5)。
@Injectable()
export class SettlementService {
  private readonly records = new Map<string, SettlementRecord>();

  constructor() {
    for (const rec of SETTLEMENT_RECORDS) {
      this.record(rec);
    }
  }

  record(rec: SettlementRecord): void {
    this.records.set(rec.id, rec);
  }

  // Role-gated view. provider → records they earned in, only their own line;
  // consumer → records they paid for; operator → everything.
  list(user: { role?: string; participantId?: string }): any[] {
    const all = [...this.records.values()];
    if (user.role === 'operator') return all;

    if (user.role === 'provider') {
      return all
        .filter((r) => r.lines.some((l) => l.participantId === user.participantId))
        .map((r) => ({
          id: r.id,
          taskId: r.taskId,
          taskRef: r.taskRef,
          currency: r.currency,
          at: r.at,
          // only this provider's own earning line is visible
          earning: r.lines.find((l) => l.participantId === user.participantId),
        }));
    }

    if (user.role === 'consumer') {
      return all.filter((r) => r.consumerId === user.participantId);
    }
    return [];
  }
}
