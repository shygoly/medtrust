// rws-algorithm-validation §7.3: shared labeling helpers for L0 results.
//
// The frontend page itself is deferred (§6), but the labeling contract is
// fixed now: synthetic results MUST be visually flagged "MUST NOT be used
// for regulatory submission" wherever they appear. Putting these helpers in
// the web package means the follow-up UI work can import them directly
// instead of re-deriving the wording (which would risk drift across
// surfaces — DataGrid cell, report header, tooltip, footnote).

/**
 * Human-readable label for the data source of an L0 result.
 */
export function provenanceLabel(provenance) {
  switch (provenance) {
    case "synthetic":
      return "合成数据（Synthea）";
    case "real":
      return "院端金标准";
    default:
      return "未标注来源";
  }
}

/**
 * §7.3 hard rule: synthetic results MUST NOT be used for regulatory
 * submission. Returns the canonical warning string, or null when the result
 * is real. The UI surfaces this verbatim wherever a synthetic result appears.
 */
export function submissionWarning(provenance) {
  if (provenance === "synthetic") {
    return "本结果基于合成数据（Synthea），MUST NOT 用于监管申报。";
  }
  return null;
}

/**
 * Distinguishes "suppressed for insufficient sample" from "poor accuracy"
 * in the UI (D3 risk mitigation). When suppressed, the UI MUST NOT display
 * numeric metrics; this helper returns the explanation string.
 */
export function suppressionExplanation(result) {
  if (!result || !result.suppressed) return null;
  switch (result.suppressionReason) {
    case "insufficient_sample":
      return "样本量不足：混淆矩阵存在低于抑制阈值的单元格，准确性指标未出域。";
    default:
      return "结果因闸门抑制未出域。";
  }
}

/**
 * One-line summary suitable for a DataGrid cell or a report footnote.
 * Encodes the full labeling contract in a single call so call sites can't
 * accidentally drop one of the flags.
 */
export function l0ResultFootnote(result) {
  const parts = [];
  const warn = submissionWarning(result?.goldStandardProvenance);
  if (warn) parts.push(warn);
  const supp = suppressionExplanation(result);
  if (supp) parts.push(supp);
  return parts.join(" ");
}
