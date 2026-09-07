import { GoldStandardJudgment, GoldStandardSource } from '@medtrust/database';

// Gold-standard loader. Reads the connector-local annotation table and
// returns a subjectKey → judgment map for ONE variable definition.
//
// CRITICAL (rws-algorithm-validation spec): when there is no annotation for
// the target variable, the task MUST fail with an explicit reason. We MUST
// NOT fall back to using the algorithm's own output as the gold standard —
// that would be circular and produce a meaningless 100% accuracy.

export class NoGoldStandard extends Error {
  constructor(variableDefinitionId: string) {
    super(
      `无金标准标注:variableDefinitionId=${variableDefinitionId} — 不能用算法输出充当金标准`,
    );
    this.name = 'NoGoldStandard';
  }
}

export interface GoldStandardRow {
  subjectKey: string;
  variableDefinitionId: string;
  judgment: GoldStandardJudgment;
  source: GoldStandardSource;
  goldStandardSetVersion: string;
}

/**
 * Pluggable store so the L0 path can run in tests without a live SQLite
 * connection. The live implementation reads `local_gold_standard` via
 * ConnectorDataSource; tests inject an in-memory variant.
 *
 * The interface is SYNCHRONOUS because the connector task runner is
 * synchronous (the worker.service pollOnce path does not await runner.run).
 * A TypeORM-backed production implementation can pre-load rows in the worker
 * and hand the executor a sync view.
 */
export interface GoldStandardStore {
  /** Return all annotations for the given variable definition. */
  findByVariableDefinition(variableDefinitionId: string): GoldStandardRow[];
  /**
   * Provenance of the annotation set for the variable definition.
   * Returns `'synthetic'` when any row's source is `'synthetic'`,
   * `'real'` otherwise. Used to label ValidationResult so synthetic
   * results are flagged for the UI/report layer (§7.3).
   */
  provenanceFor(variableDefinitionId: string): 'real' | 'synthetic';
}

/**
 * Load the gold standard for a variable definition. Returns the
 * subjectKey → judgment map. Throws NoGoldStandard if there are zero rows.
 */
export function loadGoldStandard(
  store: GoldStandardStore,
  variableDefinitionId: string,
): Map<string, GoldStandardJudgment> {
  const rows = store.findByVariableDefinition(variableDefinitionId);
  if (rows.length === 0) {
    throw new NoGoldStandard(variableDefinitionId);
  }
  const out = new Map<string, GoldStandardJudgment>();
  for (const r of rows) {
    // Last-write-wins on duplicate subjectKey within a set version — loaders
    // are expected to have already deduplicated, but be defensive.
    out.set(r.subjectKey, r.judgment);
  }
  return out;
}

// Back-compat: some callers (tests) still want the async shape. Provide it as
// a thin wrapper for ergonomic test code.
export interface AsyncGoldStandardStore {
  findByVariableDefinition(variableDefinitionId: string): Promise<GoldStandardRow[]>;
}

export async function loadGoldStandardAsync(
  store: AsyncGoldStandardStore,
  variableDefinitionId: string,
): Promise<Map<string, GoldStandardJudgment>> {
  const rows = await store.findByVariableDefinition(variableDefinitionId);
  if (rows.length === 0) {
    throw new NoGoldStandard(variableDefinitionId);
  }
  const out = new Map<string, GoldStandardJudgment>();
  for (const r of rows) out.set(r.subjectKey, r.judgment);
  return out;
}
