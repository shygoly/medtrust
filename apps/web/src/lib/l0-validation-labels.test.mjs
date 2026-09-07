// rws-algorithm-validation §7.3: labeling contract tests.
//
// The frontend page is deferred, but these helpers and their wording are
// the canonical labeling surface — locked in now so the follow-up UI cannot
// silently drift.
import test from "node:test";
import assert from "node:assert/strict";

import {
  provenanceLabel,
  submissionWarning,
  suppressionExplanation,
  l0ResultFootnote,
} from "./l0-validation-labels.mjs";

test("provenanceLabel labels synthetic results as Synthea", () => {
  assert.equal(provenanceLabel("synthetic"), "合成数据（Synthea）");
});

test("provenanceLabel labels real hospital gold standard", () => {
  assert.equal(provenanceLabel("real"), "院端金标准");
});

test("provenanceLabel handles missing provenance", () => {
  assert.equal(provenanceLabel(undefined), "未标注来源");
});

test("submissionWarning returns the MUST NOT warning for synthetic results (§7.3)", () => {
  const warn = submissionWarning("synthetic");
  assert.ok(warn, "expected a warning string");
  assert.match(warn, /MUST NOT.*监管申报/);
});

test("submissionWarning returns null for real results", () => {
  assert.equal(submissionWarning("real"), null);
});

test("submissionWarning returns null when provenance is missing", () => {
  assert.equal(submissionWarning(undefined), null);
});

test("suppressionExplanation explains insufficient_sample suppression (D3)", () => {
  const r = { suppressed: true, suppressionReason: "insufficient_sample" };
  assert.match(suppressionExplanation(r), /样本量不足/);
});

test("suppressionExplanation returns null when not suppressed", () => {
  const r = { suppressed: false };
  assert.equal(suppressionExplanation(r), null);
});

test("l0ResultFootnote emits both synthetic warning AND suppression explanation", () => {
  const r = {
    suppressed: true,
    suppressionReason: "insufficient_sample",
    goldStandardProvenance: "synthetic",
  };
  const note = l0ResultFootnote(r);
  assert.match(note, /MUST NOT.*监管申报/);
  assert.match(note, /样本量不足/);
});

test("l0ResultFootnote emits only the synthetic warning when not suppressed", () => {
  const r = { suppressed: false, goldStandardProvenance: "synthetic" };
  const note = l0ResultFootnote(r);
  assert.match(note, /MUST NOT.*监管申报/);
  assert.doesNotMatch(note, /样本量不足/);
});

test("l0ResultFootnote emits nothing for a real, non-suppressed result", () => {
  const r = { suppressed: false, goldStandardProvenance: "real" };
  assert.equal(l0ResultFootnote(r), "");
});
