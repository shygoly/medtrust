/**
 * Crosswalk between catalog / e2e query labels (中文) and Synthea FHIR display strings.
 * Used for drug exposure and condition-outcome matching — never emits row-level data.
 */

const DRUG_ALIASES: Array<{ pattern: RegExp; canonical: string }> = [
  { pattern: /metformin|二甲双胍/i, canonical: '二甲双胍' },
  { pattern: /insulin|胰岛素/i, canonical: '胰岛素' },
  { pattern: /paclitaxel|紫杉醇/i, canonical: '注射用紫杉醇' },
];

const OUTCOME_CROSSWALK: Array<{ query: RegExp; record: RegExp }> = [
  {
    query: /chronic kidney disease stage 3|慢性肾病.*3期|ckd\s*stage\s*3/i,
    record: /慢性肾病|chronic kidney|ckd|kidney disease stage 3|stage 3/i,
  },
  {
    query: /^renal_failure$/i,
    record: /终末期肾病|renal failure|end-stage renal|esrd/i,
  },
];

/** Add canonical Chinese (and e2e-friendly) labels alongside raw Synthea strings. */
export function enrichMedications(medications: readonly string[]): string[] {
  const out = new Set(medications);
  for (const m of medications) {
    for (const { pattern, canonical } of DRUG_ALIASES) {
      if (pattern.test(m)) out.add(canonical);
    }
  }
  return [...out];
}

/** Preserve stage-specific and normalized CKD labels for comparative-effect queries. */
export function enrichConditions(conditions: readonly string[]): string[] {
  const out = new Set(conditions);
  for (const c of conditions) {
    const lower = c.toLowerCase();
    if (/chronic kidney disease stage 3/.test(lower)) {
      out.add('Chronic kidney disease stage 3');
      out.add('慢性肾病');
    } else if (/chronic kidney|ckd|kidney disease|nephropathy|renal/.test(lower)) {
      out.add('慢性肾病');
    }
    if (/renal failure|end-stage renal|esrd|dialysis/.test(lower)) {
      out.add('renal_failure');
      out.add('终末期肾病');
    }
  }
  return [...out];
}

export function matchesMedication(
  medications: readonly string[],
  drug: string,
): boolean {
  if (!drug) return false;
  const enriched = enrichMedications(medications);
  if (enriched.includes(drug)) return true;
  const drugLower = drug.toLowerCase();
  for (const m of enriched) {
    const ml = m.toLowerCase();
    if (ml.includes(drugLower) || drugLower.includes(ml)) return true;
  }
  for (const { pattern, canonical } of DRUG_ALIASES) {
    if (canonical === drug || pattern.test(drug)) {
      return enriched.some((m) => pattern.test(m));
    }
  }
  return false;
}

export function matchesCondition(
  conditions: readonly string[],
  outcome: string,
): boolean {
  if (!outcome) return false;
  const enriched = enrichConditions(conditions);
  if (enriched.includes(outcome)) return true;
  const outLower = outcome.toLowerCase();
  for (const c of enriched) {
    const cl = c.toLowerCase();
    if (cl.includes(outLower) || outLower.includes(cl)) return true;
  }
  for (const { query, record } of OUTCOME_CROSSWALK) {
    if (query.test(outcome)) {
      return enriched.some((c) => record.test(c));
    }
  }
  return false;
}

export function matchesAdverseEvent(
  adverseEvents: readonly { term: string }[],
  outcome: string,
): boolean {
  if (!outcome) return false;
  return adverseEvents.some(
    (e) => e.term === outcome || e.term.includes(outcome) || outcome.includes(e.term),
  );
}
