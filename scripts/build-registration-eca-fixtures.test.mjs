import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts/build-registration-eca-fixtures.mjs");
const FIXTURE = join(ROOT, "scripts/test/fixtures/registration-synthea");

function build(out, missingness = "MAR") {
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--synthea",
      FIXTURE,
      "--out",
      out,
      "--seed",
      "20261017",
      "--reference-date",
      "20261001",
      "--missingness",
      missingness,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return out;
}

test("registration fixtures are deterministic and source partitions are disjoint", () => {
  const temp = mkdtempSync(join(tmpdir(), "medtrust-registration-fixture-"));
  try {
    const a = build(join(temp, "a"));
    const b = build(join(temp, "b"));
    const files = [
      "trial/records.json",
      "control-primary/records.json",
      "control-secondary/records.json",
      "answer-key.json",
      "generation-manifest.json",
      "data-quality-report.json",
    ];
    for (const file of files)
      assert.equal(
        readFileSync(join(a, file), "utf8"),
        readFileSync(join(b, file), "utf8"),
        `${file} must be byte-identical across runs`,
      );

    const trial = JSON.parse(readFileSync(join(a, "trial/records.json"), "utf8"));
    const primary = JSON.parse(
      readFileSync(join(a, "control-primary/records.json"), "utf8"),
    );
    const secondary = JSON.parse(
      readFileSync(join(a, "control-secondary/records.json"), "utf8"),
    );
    const links = [...trial, ...primary, ...secondary].map((row) => row.linkKey);
    assert.equal(new Set(links).size, links.length);
    assert.ok(trial.length > 0);
    assert.ok(primary.length > 0);
    assert.ok(secondary.length > 0);
    assert.deepEqual(readdirSync(a).sort(), [
      "answer-key.json",
      "control-primary",
      "control-secondary",
      "data-quality-report.json",
      "generation-manifest.json",
      "trial",
    ]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("missingness modes are declared and answer key keeps the synthetic boundary", () => {
  const temp = mkdtempSync(join(tmpdir(), "medtrust-registration-missing-"));
  try {
    for (const mode of ["MCAR", "MAR", "MNAR"]) {
      const out = build(join(temp, mode), mode);
      const answer = JSON.parse(readFileSync(join(out, "answer-key.json"), "utf8"));
      const quality = JSON.parse(
        readFileSync(join(out, "data-quality-report.json"), "utf8"),
      );
      assert.equal(answer.syntheticOnly, true);
      assert.equal(answer.design.missingness, mode);
      assert.match(answer.disclaimer, /no clinical efficacy/i);
      assert.ok(answer.truth.riskDifference < 0);
      assert.equal(typeof answer.truth.controlStrategyRisk, "number");
      assert.equal(Object.keys(answer.truth.strata).length, 5);
      assert.equal(
        Object.keys(answer.generatedDistribution).length,
        8,
      );
      assert.equal(quality.pass, true);
      assert.equal(quality.checks.disjointLinkKeys, true);
      assert.equal(quality.checks.dateOrdering, true);
      assert.equal(quality.checks.requiredFieldsPresent, true);
      assert.equal(quality.checks.eventRateConsistent, true);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("positive outcomes never follow censoring and quality checks are derived", () => {
  const temp = mkdtempSync(join(tmpdir(), "medtrust-registration-dates-"));
  try {
    const out = build(join(temp, "MAR"), "MAR");
    for (const role of ["trial", "control-primary", "control-secondary"]) {
      const rows = JSON.parse(
        readFileSync(join(out, role, "records.json"), "utf8"),
      );
      for (const row of rows) {
        if (row.outcome === "pos") {
          assert.ok(row.outcomeDate);
          assert.ok(row.outcomeDate >= row.timeZero);
          if (row.censorDate) assert.ok(row.outcomeDate <= row.censorDate);
        }
        if (row.censorDate) assert.ok(row.censorDate >= row.timeZero);
      }
    }
    const quality = JSON.parse(
      readFileSync(join(out, "data-quality-report.json"), "utf8"),
    );
    assert.equal(
      quality.pass,
      Object.values(quality.checks).every(Boolean),
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
