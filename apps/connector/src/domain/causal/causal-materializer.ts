import { matchesCondition, matchesMedication } from '../clinical-matching';
import { passesCohortDefinition } from '../cohort-definition';
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

function passesTteFilters(row: InternalRecord, tte: TteSpec): boolean {
  // L1.5-cohort-def: 委托给共享的可执行队列判定 (age>= / ckd_stage>= 不再是 no-op)。
  return passesCohortDefinition(row, { inclusion: tte.inclusion, exclusion: tte.exclusion });
}

function isTreated(row: InternalRecord, tte: TteSpec, drug?: string): boolean {
  if (typeof row.treated === 'boolean') return row.treated;
  const exposureDrug = armDrug(tte.exposureArm) ?? drug;
  if (!exposureDrug) return false;
  return matchesMedication(row.medications, exposureDrug);
}

function hasOutcome(row: InternalRecord, tte: TteSpec): boolean {
  if (typeof row.eventOccurred === 'boolean') return row.eventOccurred;
  const event = tte.outcome.event;
  if (tte.outcome.type === 'binary') {
    return matchesCondition(row.conditions, event);
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
