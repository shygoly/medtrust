import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { BUILD_DIR, readManifest } from "./wasm-utils.mjs";
import {
  decodeRegistrationKernel,
  encodeRegistrationKernel,
  externalControlRegistrationReference,
  prepareExternalControlRegistration,
  registrationKernel,
} from "../dist/index.js";

const ANALYSIS_TYPE = "external-control-registration";

function row(i, control) {
  const age = 30 + ((i * 17) % 50);
  const severity = 1 + ((i * 7) % 5);
  const marker = 1 + ((i * 13) % 9);
  const risk = (control ? 0.2 : 0.14) + severity * 0.018 + (age >= 65 ? 0.02 : 0);
  const timeZero = `202${1 + (i % 4)}-0${1 + (i % 9)}-15`;
  const outcomeDate = new Date(
    Date.parse(`${timeZero}T00:00:00Z`) + 90 * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  return {
    subjectKey: `${control ? "c" : "t"}-${i}`,
    linkKey: `lk-${control ? "c" : "t"}-${i}`,
    sourceId: control ? "external-primary" : "sponsor-trial",
    age,
    sex: i % 2 ? "M" : "F",
    calendarYear: 2021 + (i % 4),
    timeZero,
    eligibleAtTimeZero: true,
    treatmentStrategy: control ? "historical-standard-care" : "investigational-regimen",
    severity,
    diseaseDuration: i % 15,
    comorbidityIndex: i % 7,
    priorTreatment: i % 3 === 0 ? 1 : 0,
    keyBiomarker: marker,
    outcome: i % 19 === 0 ? "neg" : "pos",
    outcomeDate: i % 19 === 0 ? null : outcomeDate,
    followUpDays: 180,
    censorDate: null,
    intercurrentEvents: [],
  };
}

function fixture() {
  return {
    trialRows: Array.from({ length: 80 }, (_, i) => row(i, false)),
    controlRows: Array.from({ length: 120 }, (_, i) => row(i + 1000, true)),
    covariates: [
      "age",
      "severity",
      "diseaseDuration",
      "comorbidityIndex",
      "priorTreatment",
      "keyBiomarker",
      "calendarYear",
    ],
    effectMeasure: "risk-ratio",
    missingness: "MAR",
    synthetic: true,
    truthRr: 0.65,
    trimLow: 0.05,
    trimHigh: 0.95,
    study: {
      profileVersion: "registration-eca/1.0.0",
      timeZero: "treatment-start",
      estimandSapVersion: "sap-1",
    },
  };
}

function runModule(encoded) {
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === ANALYSIS_TYPE);
  assert.ok(entry, "registration wasm must be built");
  const memory = new WebAssembly.Memory({ initial: 2, maximum: 1024 });
  const instance = new WebAssembly.Instance(
    new WebAssembly.Module(readFileSync(join(BUILD_DIR, entry.file))),
    { env: { memory } },
  );
  new Uint8Array(memory.buffer).set(encoded.input);
  const rc = instance.exports.run(0, encoded.n, 1, encoded.outOff);
  assert.equal(rc, 0);
  return decodeRegistrationKernel(
    new Uint8Array(memory.buffer, encoded.outOff, encoded.outBytes),
  );
}

test("registration ATT kernel matches TypeScript reference", () => {
  const prepared = prepareExternalControlRegistration(fixture());
  const reference = registrationKernel(
    prepared.rows.map((row) => ({
      treated: row.treated,
      outcome: row.outcome,
      weight: row.weightQ / 65536,
    })),
  );
  const module = runModule(encodeRegistrationKernel(prepared.rows));
  const tolerance = 2 / 65536;
  for (const key of [
    "riskTreated",
    "riskControl",
    "riskDifference",
    "riskRatio",
  ])
    assert.ok(Math.abs(module[key] - reference[key]) <= tolerance, key);
  for (const [moduleValues, referenceValues] of [
    [module.riskDifferenceCi, reference.riskDifferenceCi],
    [module.riskRatioCi, reference.riskRatioCi],
  ]) {
    assert.ok(Math.abs(moduleValues[0] - referenceValues[0]) <= tolerance);
    assert.ok(Math.abs(moduleValues[1] - referenceValues[1]) <= tolerance);
  }
  assert.ok(Math.abs(module.effectiveSampleSize - reference.effectiveSampleSize) < 1e-6);
  assert.equal(module.nTreated, prepared.rows.filter((row) => row.treated === 1).length);
  assert.equal(module.nControl, prepared.rows.filter((row) => row.treated === 0).length);
});

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function conformanceRows(trueRr) {
  const draw = seeded(20261017);
  const trialRows = [];
  const controlRows = [];
  for (let index = 0; index < 30_000; index++) {
    const age = 25 + Math.floor(draw() * 55);
    const severity = 1 + Math.floor(draw() * 5);
    const priorTreatment = draw() < 0.4 ? 1 : 0;
    const keyBiomarker = draw() * 10;
    const propensity =
      1 /
      (1 +
        Math.exp(
          -(
            -1.4 +
            0.015 * (age - 50) +
            0.15 * (severity - 3) -
            0.1 * priorTreatment
          ),
        ));
    const treated = draw() < propensity;
    const baseline =
      1 /
      (1 +
        Math.exp(
          -(
            -2 +
            0.03 * (age - 50) +
            0.4 * (severity - 3) +
            0.012 * keyBiomarker -
            0.2 * priorTreatment
          ),
        ));
    const observedRisk = treated ? baseline * trueRr : baseline;
    const positive = draw() < observedRisk;
    const row = {
      subjectKey: `${treated ? "t" : "c"}-${index}`,
      linkKey: `lk-${treated ? "t" : "c"}-${index}`,
      sourceId: treated ? "sponsor-trial" : "external-primary",
      age,
      sex: index % 2 === 0 ? "F" : "M",
      calendarYear: 2023,
      timeZero: "2023-01-01",
      eligibleAtTimeZero: true,
      treatmentStrategy: treated
        ? "investigational-regimen"
        : "historical-standard-care",
      severity,
      diseaseDuration: index % 15,
      comorbidityIndex: index % 7,
      priorTreatment,
      keyBiomarker,
      outcome: positive ? "pos" : "neg",
      outcomeDate: positive ? "2023-04-01" : null,
      censorDate: null,
      followUpDays: 365,
      intercurrentEvents: [],
    };
    (treated ? trialRows : controlRows).push(row);
  }
  return {
    trialRows,
    controlRows,
    covariates: [
      "age",
      "sex",
      "severity",
      "priorTreatment",
      "keyBiomarker",
    ],
    effectMeasure: "risk-ratio",
    missingness: "MCAR",
    synthetic: true,
    truthRr: trueRr,
    study: {
      profileVersion: "registration-eca/1.0.0",
      timeZero: "treatment-or-index-date",
      estimandSapVersion: "reference-sap-1",
    },
  };
}

test("IPTW-ATT recovers the known effect while the unadjusted contrast is biased", () => {
  const input = conformanceRows(0.65);
  const result = externalControlRegistrationReference(input);
  const rawTrialRisk =
    input.trialRows.filter((row) => row.outcome === "pos").length /
    input.trialRows.length;
  const rawControlRisk =
    input.controlRows.filter((row) => row.outcome === "pos").length /
    input.controlRows.length;
  const unadjusted = rawTrialRisk / rawControlRisk;

  assert.ok(
    unadjusted > 0.72,
    `unadjusted RR ${unadjusted} must be visibly biased`,
  );
  assert.ok(
    Math.abs(result.effect.estimate - 0.65) < 0.05,
    `adjusted RR ${result.effect.estimate} must recover truth 0.65`,
  );
  assert.ok(result.effect.ciLow <= 0.65 && 0.65 <= result.effect.ciHigh);
  assert.ok(Math.max(...result.balance.map((row) => row.smdAfter)) <= 0.05);
});

test("negative-control-like no-effect scenario has an interval covering the null", () => {
  const result = externalControlRegistrationReference(conformanceRows(1));
  assert.ok(result.effect.ciLow <= 1 && 1 <= result.effect.ciHigh);
  assert.equal(result.effect.estimate > 0, true);
});

test("registration input integrity failures are explicit and auditable", () => {
  const duplicate = fixture();
  duplicate.controlRows[1] = {
    ...duplicate.controlRows[1],
    linkKey: duplicate.controlRows[0].linkKey,
  };
  assert.throws(
    () => prepareExternalControlRegistration(duplicate),
    /linkKey values must be unique/,
  );

  const strategy = fixture();
  strategy.controlRows = strategy.controlRows.map((row) => ({
    ...row,
    treatmentStrategy: "investigational-regimen",
  }));
  assert.throws(
    () => prepareExternalControlRegistration(strategy),
    /treatment strategies must differ/,
  );

  const censorOrder = fixture();
  censorOrder.controlRows[0] = {
    ...censorOrder.controlRows[0],
    outcome: "pos",
    outcomeDate: "2024-04-01",
    timeZero: "2024-01-01",
    censorDate: "2024-03-01",
  };
  assert.throws(
    () => prepareExternalControlRegistration(censorOrder),
    /outcome follows censorDate/,
  );

  const exclusions = fixture();
  exclusions.trialRows[0] = {
    ...exclusions.trialRows[0],
    eligibleAtTimeZero: false,
  };
  const prepared = prepareExternalControlRegistration(exclusions);
  assert.equal(prepared.diagnostics.cohort.excluded.trialIneligibleAtTimeZero, 1);
  assert.equal(prepared.diagnostics.cohort.excluded.controlIneligibleAtTimeZero, 0);
});
