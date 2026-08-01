import { InternalRecord } from './types';

/**
 * rws-study-protocol-spec §3.4 — L2-missing-data.
 *
 * The SAP MUST declare the missingness mechanism (MCAR/MAR/MNAR) and an
 * imputation strategy. This module applies that declaration to the cohort
 * BEFORE the aggregate is computed, and returns a log that lets the execution
 * be reconciled against the SAP. The executor MUST NOT silently mix 多重插补
 * and 完全病例 — the strategy the code actually applies is the one recorded
 * (no 混用 red line).
 */

/** Shape of the §3.4 declaration as carried on `RwsAnalysis.missingness`. */
export interface MissingnessDeclarationLike {
  mechanism: 'MCAR' | 'MAR' | 'MNAR';
  imputationStrategy: string;
}

export type MissingnessAppliedStrategy = 'multiple_imputation' | 'complete_case' | 'none';

export interface MissingnessLog {
  mechanism: 'MCAR' | 'MAR' | 'MNAR';
  /** Verbatim SAP declaration — the reconciliation key (§3.4 与 SAP 一致). */
  declaredStrategy: string;
  appliedStrategy: MissingnessAppliedStrategy;
  rowsBefore: number;
  rowsAfter: number;
  /** Set when complete_case is applied. */
  droppedRows?: number;
  /** Set when multiple_imputation is applied. */
  imputationsPerformed?: number;
}

/** §3.4 closed-set classification of the free-text SAP strategy. */
export function classifyMissingnessStrategy(declared: string): MissingnessAppliedStrategy {
  const s = declared.trim();
  if (/多重插补|multiple[\s_-]*imputation|\bMI\b/i.test(s)) return 'multiple_imputation';
  if (/完全病例|complete[\s_-]*case|\bCC\b/i.test(s)) return 'complete_case';
  return 'none';
}

function isIncomplete(r: InternalRecord, stratifyBy: Array<'ageBand' | 'sex'>): boolean {
  return stratifyBy.some((f) => (f === 'sex' ? r.sex === undefined || r.sex === '' : !r.ageBand));
}

function modeOf(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let bestCount = -1;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Apply the SAP-declared missingness strategy to the cohort.
 *
 * A row is "incomplete" when it misses a stratification value (the cells the
 * stratified aggregate must keep clean). Under `complete_case` such rows are
 * dropped and counted; under `multiple_imputation` the missing value is
 * imputed deterministically (mode of the complete rows) and counted — never
 * silently. The returned log always reconciles to the declaration.
 */
export function applyMissingness(
  rows: readonly InternalRecord[],
  declaration: MissingnessDeclarationLike,
  stratifyBy: Array<'ageBand' | 'sex'> = ['ageBand'],
): { rows: InternalRecord[]; log: MissingnessLog } {
  const rowsBefore = rows.length;
  const declaredStrategy = declaration.imputationStrategy ?? '';
  const appliedStrategy = classifyMissingnessStrategy(declaredStrategy);
  const mechanism = declaration.mechanism;

  let handled: InternalRecord[];
  let droppedRows: number | undefined;
  let imputationsPerformed: number | undefined;

  if (appliedStrategy === 'complete_case') {
    handled = rows.filter((r) => !isIncomplete(r, stratifyBy));
    droppedRows = rowsBefore - handled.length;
  } else if (appliedStrategy === 'multiple_imputation') {
    const completeRows = rows.filter((r) => !isIncomplete(r, stratifyBy));
    const modeSex = modeOf(completeRows.map((r) => r.sex).filter((s): s is string => !!s));
    const modeAgeBand = modeOf(completeRows.map((r) => r.ageBand).filter((a) => !!a));
    let imputed = 0;
    handled = rows.map((r) => {
      if (!isIncomplete(r, stratifyBy)) return r;
      imputed++;
      const copy: InternalRecord = { ...r };
      if (stratifyBy.includes('sex') && (copy.sex === undefined || copy.sex === '')) {
        copy.sex = modeSex ?? '未知';
      }
      if (stratifyBy.includes('ageBand') && !copy.ageBand) {
        copy.ageBand = modeAgeBand ?? '未知';
      }
      return copy;
    });
    imputationsPerformed = imputed;
  } else {
    handled = [...rows];
  }

  const log: MissingnessLog = {
    mechanism,
    declaredStrategy,
    appliedStrategy,
    rowsBefore,
    rowsAfter: handled.length,
    ...(droppedRows !== undefined ? { droppedRows } : {}),
    ...(imputationsPerformed !== undefined ? { imputationsPerformed } : {}),
  };

  return { rows: handled, log };
}
