import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

export type PricingModel = 'per-record' | 'per-task' | 'subscription';

export interface Pricing {
  model: PricingModel;
  amount: number; // per-record unit price, per-task fee, or 0 for subscription
  currency: string; // e.g. CNY or a credit unit
}

export interface ContributionInput {
  org: string;
  participantId?: string;
  contribution: number; // e.g. cohort size contributed by this provider
}

export interface SettlementLine {
  org: string;
  participantId?: string;
  contribution: number;
  amount: number; // this provider's earning
}

export interface SettlementRecord {
  taskId: string;
  taskRef?: string; // the task attestation hash this settlement is anchored to
  consumer: string; // who pays
  currency: string;
  contributionTotal: number;
  total: number; // consumer charge
  lines: SettlementLine[]; // provider earnings
  hash: string; // on-chain digest
}

// 价值共创结算(value-settlement). Earnings are split among providers strictly
// by contribution ratio (收益占比 = 贡献占比), for any pricing model. The
// contribution comes from the task's real result (cohort size), never the
// consumer's say-so.
@Injectable()
export class SettlementService {
  settle(
    taskId: string,
    consumer: string,
    pricing: Pricing,
    contributions: ContributionInput[],
    taskRef?: string,
  ): SettlementRecord {
    const contributionTotal = contributions.reduce((s, c) => s + c.contribution, 0);
    const total =
      pricing.model === 'per-record'
        ? round2(pricing.amount * contributionTotal)
        : pricing.model === 'per-task'
          ? round2(pricing.amount)
          : 0; // subscription: covered by the subscription, no per-task charge

    const lines: SettlementLine[] = contributions.map((c) => ({
      org: c.org,
      participantId: c.participantId,
      contribution: c.contribution,
      amount: contributionTotal > 0 ? round2(total * (c.contribution / contributionTotal)) : 0,
    }));

    const hash =
      'SM3:' +
      createHash('sha256')
        .update(`${taskId}:${taskRef ?? ''}:${consumer}:${total}:${JSON.stringify(lines.map((l) => [l.org, l.amount]))}`)
        .digest('hex')
        .slice(0, 16);

    return { taskId, taskRef, consumer, currency: pricing.currency, contributionTotal, total, lines, hash };
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
