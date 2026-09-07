import { GoldStandardJudgment } from '@medtrust/database';

// rws-algorithm-validation §7.1–7.3 + D-DATA-1 (rws-test-data-signal-injection Task 4):
//
// Primary path: L0 gold = injected true disease state (`truePancreatitis` from
// the TS injection answer key / truth.json). That is the only gold that makes
// Se/Sp recovery of injected codeSensitivity/codeSpecificity meaningful.
//
// Legacy path: flip-based `synthesizeGoldStandard` (algorithm output ⊕ seeded
// flips). Kept for one-iteration rollback via `MEDTRUST_SYNTH_GOLD_FLIP=1` and
// for fixture smoke tests that have no truth file. MUST NOT be the default
// for injected RWS datasets.

/** A subject's algorithm judgment (true = algorithm-positive). */
export type AlgorithmJudgment = boolean;

/** Minimal truth row from the injection layer (avoid importing testdata/). */
export interface InjectedTruthRow {
  subjectKey: string;
  /** Injected true disease state — gold positive when true. */
  truePancreatitis: boolean;
}

/** mulberry32 — small, fast, deterministic PRNG. Not crypto; for fixtures only. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string to a uint32 (FNV-1a). */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface SynthesizeOptions {
  variableDefinitionId: string;
  goldStandardSetVersion: string;
  algorithmId: string;
  algorithmVersion: string;
  /**
   * Per-class flip rate. `flipOnPositive` flips algorithm-positive → gold-
   * negative (controls PPV); `flipOnNegative` flips algorithm-negative →
   * gold-positive (controls NPV). Together they pin the implied Se/Sp:
   *   Sp ≈ 1 − flipOnNegative
   *   Se ≈ 1 − flipOnPositive
   */
  flipOnPositive?: number; // default 0.1
  flipOnNegative?: number; // default 0.1
  /**
   * Optional extra seed salt for scenarios that want multiple distinct
   * annotation sets off the same algorithm/variable triple.
   */
  salt?: string;
}

/**
 * L0 gold from injected truth (D-DATA-1). Maps `truePancreatitis` → judgment.
 * When `subjectKeys` is provided, only those subjects are emitted (hospital filter).
 */
export function goldFromInjectedTruth(
  truth: readonly InjectedTruthRow[],
  subjectKeys?: Iterable<string>,
): Map<string, GoldStandardJudgment> {
  const filter =
    subjectKeys === undefined ? null : new Set([...subjectKeys]);
  const out = new Map<string, GoldStandardJudgment>();
  for (const row of truth) {
    if (filter && !filter.has(row.subjectKey)) continue;
    out.set(row.subjectKey, row.truePancreatitis ? 'positive' : 'negative');
  }
  return out;
}

/** Rollback switch: force flip-based synth even when truth is available. */
export function shouldUseFlipGoldStandard(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const v = env.MEDTRUST_SYNTH_GOLD_FLIP;
  return v === '1' || v === 'true';
}

/**
 * Resolve L0 gold: prefer injected truth unless `MEDTRUST_SYNTH_GOLD_FLIP=1`.
 * Falls back to flip synth when truth is absent/empty.
 */
export function resolveGoldStandard(
  predictions: Map<string, AlgorithmJudgment>,
  opts: SynthesizeOptions & { truth?: readonly InjectedTruthRow[] },
  env: NodeJS.ProcessEnv = process.env,
): Map<string, GoldStandardJudgment> {
  if (!shouldUseFlipGoldStandard(env) && opts.truth && opts.truth.length > 0) {
    return goldFromInjectedTruth(opts.truth, predictions.keys());
  }
  return synthesizeGoldStandard(predictions, opts);
}

/**
 * Legacy flip-based synthetic gold (algorithm ⊕ seeded flips).
 * Prefer `goldFromInjectedTruth` / `resolveGoldStandard` for injected datasets.
 */
export function synthesizeGoldStandard(
  predictions: Map<string, AlgorithmJudgment>,
  opts: SynthesizeOptions,
): Map<string, GoldStandardJudgment> {
  const flipOnPositive = opts.flipOnPositive ?? 0.1;
  const flipOnNegative = opts.flipOnNegative ?? 0.1;
  const seed = hashStr(
    [opts.goldStandardSetVersion, opts.variableDefinitionId, opts.algorithmId, opts.algorithmVersion, opts.salt ?? '']
      .join('|'),
  );
  const rng = mulberry32(seed);

  const out = new Map<string, GoldStandardJudgment>();
  // Sort subjectKeys so seed→annotation is deterministic across iteration order.
  const keys = [...predictions.keys()].sort();
  for (const k of keys) {
    const predicted = predictions.get(k)!;
    const flipRate = predicted ? flipOnPositive : flipOnNegative;
    const flipped = rng() < flipRate;
    const goldPositive = predicted !== flipped; // XOR
    out.set(k, goldPositive ? 'positive' : 'negative');
  }
  return out;
}

/**
 * Sanity helper: compute the implied Se/Sp of a synthesized gold standard
 * against the predictions that generated it. Useful for asserting fixture
 * behavior (e.g. "flip rate 0 → Se = Sp = 1").
 */
export function impliedSeSp(
  predictions: Map<string, AlgorithmJudgment>,
  gold: Map<string, GoldStandardJudgment>,
): { se: number; sp: number } {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const [k, predicted] of predictions) {
    const actual = gold.get(k);
    if (actual === undefined) continue;
    const actualPositive = actual === 'positive';
    if (predicted && actualPositive) tp++;
    else if (predicted && !actualPositive) fp++;
    else if (!predicted && actualPositive) fn++;
    else tn++;
  }
  return {
    se: tp + fn > 0 ? tp / (tp + fn) : 0,
    sp: tn + fp > 0 ? tn / (tn + fp) : 0,
  };
}
