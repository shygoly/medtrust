import { AlgorithmExpression, CodeSet, IdentificationAlgorithm } from '../types';

// D4 (rws-algorithm-validation): the algorithm definition is a cross-domain
// inbound payload (control→connector). The connector is the only component
// that touches raw data, so any "algorithm" coming from a consumer is an
// attack surface. We DO NOT eval arbitrary expressions — only a closed
// grammar of boolean combinations over code-set membership and time-window
// constraints. Anything else is rejected BEFORE the evaluator sees it.

export class InvalidAlgorithmGrammar extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAlgorithmGrammar';
  }
}

export class IncompleteCodeSet extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncompleteCodeSet';
  }
}

const VALID_VALUE_SOURCES: readonly string[] = [
  'outpatient_dx',
  'discharge_dx',
  'lab',
  'medication',
];
const VALID_DIAGNOSIS_ORDERS: readonly string[] = [
  'primary_only',
  'top3_discharge',
  'any',
];

/** Validate a single CodeSet's four required elements (§2.7.4 四要素). */
export function validateCodeSet(cs: unknown, path: string): asserts cs is CodeSet {
  if (!cs || typeof cs !== 'object') {
    throw new IncompleteCodeSet(`${path}: code set must be an object`);
  }
  const c = cs as Record<string, unknown>;
  const missing: string[] = [];
  if (typeof c.codeSystem !== 'string' || !c.codeSystem.trim()) missing.push('codeSystem');
  if (typeof c.codeSystemVersion !== 'string' || !c.codeSystemVersion.trim()) {
    missing.push('codeSystemVersion');
  }
  if (!Array.isArray(c.codes) || !c.codes.every((x) => typeof x === 'string')) {
    missing.push('codes');
  }
  if (typeof c.valueSource !== 'string' || !VALID_VALUE_SOURCES.includes(c.valueSource)) {
    missing.push(`valueSource (one of ${VALID_VALUE_SOURCES.join('|')})`);
  }
  if (
    typeof c.diagnosisOrder !== 'string' ||
    !VALID_DIAGNOSIS_ORDERS.includes(c.diagnosisOrder)
  ) {
    missing.push(`diagnosisOrder (one of ${VALID_DIAGNOSIS_ORDERS.join('|')})`);
  }
  if (missing.length) {
    throw new IncompleteCodeSet(`${path}: missing/invalid elements: ${missing.join(', ')}`);
  }
}

/**
 * Walk the AlgorithmExpression AST and reject anything outside the closed
 * grammar. Accepted node shapes:
 *   { kind: 'codeset', codeset: CodeSet }
 *   { kind: 'and' | 'or', children: AlgorithmExpression[] }
 *   { kind: 'not', child: AlgorithmExpression }
 *   { kind: 'window', days: number, child: AlgorithmExpression }
 *
 * Anything else — function-call-shaped nodes, inline scripts, eval strings,
 * unknown `kind` values, extra suspicious keys — is rejected here, before any
 * evaluation runs. This is the security choke point mandated by usage-control
 * spec (CTL-10 in TRUST.md).
 */

// Keys that never appear in the closed grammar; their presence is always an
// injection attempt.
const FORBIDDEN_KEYS = new Set([
  'eval', 'function', 'call', 'apply', 'bind', 'callee',
  'source', 'script', 'body', 'code', 'lambda', 'fn',
  '__proto__', 'constructor', 'prototype',
]);

// Characters that never appear in legitimate identifiers / code values in
// this grammar. If any string LEAF contains one of these, the payload is
// attempting to embed executable code.
const CODE_LIKE_CHARS = /[(){};=>]/;

/**
 * Deep-scan every string leaf AND every key for code-injection indicators
 * BEFORE structural validation. Walking the whole tree once here means the
 * structural walk below can stay shallow and focused on shape.
 *
 * Catches e.g. `{ codeset: { codeSystem: "eval(x)" } }` where the offending
 * string is nested two levels down — the per-node structural walk would only
 * see `codeSystem: <string>` and accept it.
 */
function deepScanForCode(node: unknown, path: string, seen: WeakSet<object>): void {
  if (typeof node === 'string') {
    if (CODE_LIKE_CHARS.test(node)) {
      throw new InvalidAlgorithmGrammar(
        `${path}: string value "${node.slice(0, 40)}" contains code-like characters`,
      );
    }
    return;
  }
  if (node === null || typeof node !== 'object') return;
  if (seen.has(node)) return; // cycle guard
  seen.add(node);
  for (const [k, v] of Object.entries(node)) {
    if (FORBIDDEN_KEYS.has(k)) {
      throw new InvalidAlgorithmGrammar(
        `${path}: forbidden key "${k}" — algorithm grammar does not permit executable constructs`,
      );
    }
    deepScanForCode(v, `${path}.${k}`, seen);
  }
}

export function validateAlgorithmExpression(node: unknown, path = 'expression'): void {
  // 1. Deep string/key scan first — catches code embedded at ANY depth.
  deepScanForCode(node, path, new WeakSet());

  if (!node || typeof node !== 'object') {
    throw new InvalidAlgorithmGrammar(`${path}: must be an object`);
  }
  const n = node as Record<string, unknown>;

  if (typeof n.kind !== 'string') {
    throw new InvalidAlgorithmGrammar(`${path}: missing or non-string "kind"`);
  }

  switch (n.kind) {
    case 'codeset': {
      validateCodeSet(n.codeset, `${path}.codeset`);
      for (const k of Object.keys(n)) {
        if (k !== 'kind' && k !== 'codeset') {
          throw new InvalidAlgorithmGrammar(`${path}: unexpected key "${k}" on codeset node`);
        }
      }
      return;
    }
    case 'and':
    case 'or': {
      if (!Array.isArray(n.children) || n.children.length === 0) {
        throw new InvalidAlgorithmGrammar(`${path}.${n.kind}: children must be a non-empty array`);
      }
      for (const k of Object.keys(n)) {
        if (k !== 'kind' && k !== 'children') {
          throw new InvalidAlgorithmGrammar(`${path}: unexpected key "${k}" on ${n.kind} node`);
        }
      }
      n.children.forEach((child, i) => validateAlgorithmExpression(child, `${path}.children[${i}]`));
      return;
    }
    case 'not': {
      if (!n.child || typeof n.child !== 'object') {
        throw new InvalidAlgorithmGrammar(`${path}.not: child must be an expression`);
      }
      for (const k of Object.keys(n)) {
        if (k !== 'kind' && k !== 'child') {
          throw new InvalidAlgorithmGrammar(`${path}: unexpected key "${k}" on not node`);
        }
      }
      validateAlgorithmExpression(n.child, `${path}.child`);
      return;
    }
    case 'window': {
      if (typeof n.days !== 'number' || !Number.isFinite(n.days) || n.days <= 0) {
        throw new InvalidAlgorithmGrammar(`${path}.window: days must be a positive finite number`);
      }
      if (!n.child || typeof n.child !== 'object') {
        throw new InvalidAlgorithmGrammar(`${path}.window: child must be an expression`);
      }
      for (const k of Object.keys(n)) {
        if (k !== 'kind' && k !== 'days' && k !== 'child') {
          throw new InvalidAlgorithmGrammar(`${path}: unexpected key "${k}" on window node`);
        }
      }
      validateAlgorithmExpression(n.child, `${path}.child`);
      return;
    }
    default:
      throw new InvalidAlgorithmGrammar(
        `${path}: unknown kind "${n.kind}" — only codeset|and|or|not|window allowed`,
      );
  }
}

/** Top-level entry: validate an IdentificationAlgorithm's id/version/expression. */
export function validateAlgorithmGrammar(algo: IdentificationAlgorithm): void {
  if (!algo || typeof algo !== 'object') {
    throw new InvalidAlgorithmGrammar('algorithm must be an object');
  }
  if (typeof algo.id !== 'string' || !algo.id.trim()) {
    throw new InvalidAlgorithmGrammar('algorithm.id must be a non-empty string');
  }
  if (typeof algo.version !== 'string' || !algo.version.trim()) {
    throw new InvalidAlgorithmGrammar('algorithm.version must be a non-empty string');
  }
  if (algo.assessmentWindowDays !== undefined) {
    if (
      typeof algo.assessmentWindowDays !== 'number' ||
      !Number.isFinite(algo.assessmentWindowDays) ||
      algo.assessmentWindowDays <= 0
    ) {
      throw new InvalidAlgorithmGrammar('assessmentWindowDays must be a positive finite number');
    }
  }
  validateAlgorithmExpression(algo.expression, 'expression');
}
