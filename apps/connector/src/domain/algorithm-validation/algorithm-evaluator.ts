import { AlgorithmExpression, CodeSet, IdentificationAlgorithm, InternalRecord } from '../types';

// L0 algorithm evaluator. Runs INSIDE the TEE (the caller seals the rows,
// this function runs in-enclave). For each subject it produces a boolean
// judgment: did this subject match the operational definition expressed by
// the IdentificationAlgorithm? The caller then compares these judgments to
// the gold standard to build the confusion matrix.
//
// Current record model: InternalRecord has flat `conditions[]` / `medications[]`
// arrays of normalized strings. The FHIR gateway in production would
// distinguish outpatient vs discharge diagnoses; in the Synthea-backed dev
// model they share the same list and `valueSource` only routes between
// conditions (outpatient_dx / discharge_dx / lab proxy) and medications.
// `diagnosisOrder` constrains WHICH positions of the list may match.

/** Extract the candidate string list a code set should be matched against. */
function candidateValues(record: InternalRecord, cs: CodeSet): string[] {
  switch (cs.valueSource) {
    case 'medication':
      return record.medications;
    case 'outpatient_dx':
    case 'discharge_dx':
    case 'lab':
      // Dev/demo InternalRecord: conditions + coded AE terms (rws-injected
      // pancreatitis lives in adverseEvents.term, not ICD in conditions).
      // Production FHIR ingest would populate dx lists separately.
      return [
        ...record.conditions,
        ...record.adverseEvents.map((e) => e.term).filter(Boolean),
      ];
    default:
      // unreachable — validateCodeSet already rejected unknown valueSource
      return [];
  }
}

/** Apply the diagnosisOrder constraint (§2.7.4 示例) to a candidate list. */
function restrictByOrder(values: string[], order: CodeSet['diagnosisOrder']): string[] {
  switch (order) {
    case 'primary_only':
      return values.slice(0, 1);
    case 'top3_discharge':
      return values.slice(0, 3);
    case 'any':
      return values;
    default:
      return [];
  }
}

/** Does `record` satisfy a single CodeSet? */
function matchesCodeSet(record: InternalRecord, cs: CodeSet): boolean {
  const values = restrictByOrder(candidateValues(record, cs), cs.diagnosisOrder);
  return cs.codes.some((code) => values.includes(code));
}

/** Evaluate the AST against one record. */
function evaluateExpression(record: InternalRecord, node: AlgorithmExpression): boolean {
  switch (node.kind) {
    case 'codeset':
      return matchesCodeSet(record, node.codeset);
    case 'and':
      return node.children.every((c) => evaluateExpression(record, c));
    case 'or':
      return node.children.some((c) => evaluateExpression(record, c));
    case 'not':
      return !evaluateExpression(record, node.child);
    case 'window':
      // Time-window constraint: in the dev record model we treat it as
      // "the inner predicate holds at some point within `days` of follow-up",
      // which collapses to the inner predicate when followUpDays ≥ days.
      // Production would consult encounter timestamps; here we evaluate the
      // child directly. The grammar validator already enforced days > 0.
      if (record.followUpDays !== undefined && record.followUpDays < node.days) {
        return false;
      }
      return evaluateExpression(record, node.child);
    default:
      // unreachable — grammar validator rejects unknown kinds before we get here
      throw new Error(`algorithm-evaluator: unreachable node kind`);
  }
}

/**
 * Evaluate the algorithm against every subject. Returns a subjectKey → judgment
 * map. The caller (in-TEE) compares this to the gold standard.
 *
 * Precondition: `validateAlgorithmGrammar(algo)` has already been called.
 */
export function evaluateAlgorithm(
  algo: IdentificationAlgorithm,
  records: readonly InternalRecord[],
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const r of records) {
    out.set(r.subjectKey, evaluateExpression(r, algo.expression));
  }
  return out;
}
