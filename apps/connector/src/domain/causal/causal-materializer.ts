import { InternalRecord, TteSpec } from '../types';

/** Agent-safe cohort row (no identifiers). */
export interface CausalCohortRow {
  ageBand: string;
  sex: string;
  followUpDays: number;
  eventOccurred: boolean;
  treated: boolean;
  conditions: string[];
}

function armDrug(arm: string): string | null {
  const m = arm.match(/^drug:(.+)$/);
  return m ? m[1] : null;
}

function matchesRule(row: InternalRecord, rule: string): boolean {
  if (rule === 'pregnancy') {
    return row.conditions.some((c) => c.includes('妊娠'));
  }
  if (rule.startsWith('age>=')) return true;
  if (rule.startsWith('ckd_stage>=')) return true;
  return true;
}

function passesTteFilters(row: InternalRecord, tte: TteSpec): boolean {
  if (tte.inclusion.length && !tte.inclusion.every((r) => matchesRule(row, r))) {
    return false;
  }
  if (tte.exclusion.some((r) => matchesRule(row, r))) return false;
  return true;
}

function isTreated(row: InternalRecord, tte: TteSpec, drug?: string): boolean {
  if (typeof row.treated === 'boolean') return row.treated;
  const exposureDrug = armDrug(tte.exposureArm) ?? drug;
  if (!exposureDrug) return false;
  return row.medications.includes(exposureDrug);
}

function hasOutcome(row: InternalRecord, tte: TteSpec): boolean {
  if (typeof row.eventOccurred === 'boolean') return row.eventOccurred;
  const event = tte.outcome.event;
  if (tte.outcome.type === 'binary') {
    return row.conditions.includes(event);
  }
  return row.adverseEvents.some((e) => e.term === event);
}

/** 脱敏行 → agent 可消费队列 (任务 5.1). */
export function materializeCausalCohort(
  rows: readonly InternalRecord[],
  tte: TteSpec,
  drug?: string,
): CausalCohortRow[] {
  return rows
    .filter((r) => passesTteFilters(r, tte))
    .map((r) => ({
      ageBand: r.ageBand,
      sex: r.sex ?? '未知',
      followUpDays: r.followUpDays ?? 365,
      eventOccurred: hasOutcome(r, tte),
      treated: isTreated(r, tte, drug),
      conditions: [...r.conditions],
    }));
}
