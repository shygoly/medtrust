#!/usr/bin/env node
/**
 * Build deterministic synthetic registration-ECA fixtures from Synthea CSV.
 *
 * Synthetic only. The treatment/outcome parameters are injected for method
 * testing and do not describe any real product.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};

const SYNTHEA_DIR = resolve(flag("--synthea", ""));
const OUT = resolve(flag("--out", "data/synthea/registration-20261017/fixtures"));
const SEED = Number(flag("--seed", "20261017"));
const AGE = String(flag("--age", "18-80"));
const REFERENCE_DATE = String(flag("--reference-date", "20261001"));
const STATE = String(flag("--state", "Massachusetts"));
const MISSINGNESS = String(flag("--missingness", "MAR"));
const CALIPER_DAYS = Number(flag("--caliper-days", "30"));
const PINS = resolve(flag("--pins", join(ROOT, "data/synthea/registration-inputs.json")));
const STUDY_CONFIG = resolve(
  flag("--study-config", join(ROOT, "data/synthea/registration-reference-study.json")),
);
const KEEP_MODULE = resolve(
  flag("--keep-module", join(ROOT, "data/synthea/modules/keep_registration_indication.json")),
);
const JAR = resolve(
  flag("--jar", join(ROOT, "data/synthea/synthea-with-dependencies.jar")),
);

if (!existsSync(join(SYNTHEA_DIR, "patients.csv")))
  throw new Error(`patients.csv not found under ${SYNTHEA_DIR}`);
if (!existsSync(join(SYNTHEA_DIR, "conditions.csv")))
  throw new Error(`conditions.csv not found under ${SYNTHEA_DIR}`);
if (!["MCAR", "MAR", "MNAR"].includes(MISSINGNESS))
  throw new Error("--missingness must be MCAR, MAR, or MNAR");

const [ageMin, ageMax] = AGE.split("-").map(Number);
if (!Number.isInteger(ageMin) || !Number.isInteger(ageMax) || ageMin < 0 || ageMax < ageMin)
  throw new Error("--age must have the form MIN-MAX");
if (!Number.isInteger(SEED) || SEED < 0) throw new Error("--seed must be a non-negative integer");

const pins = JSON.parse(readFileSync(PINS, "utf8"));
const studyConfig = JSON.parse(readFileSync(STUDY_CONFIG, "utf8"));
if (studyConfig.syntheticOnly !== true)
  throw new Error("registration study config must declare syntheticOnly=true");
if (studyConfig.estimand !== "ATT" || studyConfig.primaryEstimator !== "IPTW-ATT")
  throw new Error("reference registration fixture requires ATT with IPTW-ATT");
if (!Array.isArray(studyConfig.confounders) || studyConfig.confounders.length === 0)
  throw new Error("study config must predeclare confounders");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileSha = (path) => sha256(readFileSync(path));

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body
    .filter((values) => values.length === header.length)
    .map((values) => Object.fromEntries(header.map((key, i) => [key, values[i]])));
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashUnit(value) {
  return parseInt(sha256(String(value)).slice(0, 13), 16) / 0x10000000000000;
}

const rng = mulberry32(SEED);
const dayMs = 86_400_000;
const dayNumber = (value) => {
  const text = String(value);
  const date =
    /^\d{8}$/.test(text)
      ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
      : text.slice(0, 10);
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / dayMs);
};
const isoDay = (day) => new Date(day * dayMs).toISOString().slice(0, 10);
const referenceDay = dayNumber(REFERENCE_DATE);
if (!Number.isFinite(referenceDay)) throw new Error("--reference-date is invalid");

const patients = parseCsv(readFileSync(join(SYNTHEA_DIR, "patients.csv"), "utf8"));
const conditions = parseCsv(readFileSync(join(SYNTHEA_DIR, "conditions.csv"), "utf8"));
const targetCode = pins.keepModule?.indicationCode?.split(":")[1] ?? "44054006";
const activeDiagnosis = new Set(
  conditions
    .filter(
      (condition) =>
        condition.CODE === targetCode &&
        (!condition.STOP || condition.STOP >= isoDay(referenceDay - 365)),
    )
    .map((condition) => condition.PATIENT),
);

const excluded = {
  missingBirthDate: 0,
  outsideAgeRange: 0,
  noTargetDiagnosis: 0,
};
const eligible = [];
for (const patient of patients) {
  if (!patient.BIRTHDATE) {
    excluded.missingBirthDate++;
    continue;
  }
  const age = Math.floor((referenceDay - dayNumber(patient.BIRTHDATE)) / 365.25);
  if (age < ageMin || age > ageMax) {
    excluded.outsideAgeRange++;
    continue;
  }
  if (!activeDiagnosis.has(patient.Id)) {
    excluded.noTargetDiagnosis++;
    continue;
  }
  eligible.push({ patient, age });
}

const roles = ["trial", "control-primary", "control-secondary"];
const records = Object.fromEntries(roles.map((role) => [role, []]));
const injectedRisk = Object.fromEntries(
  roles.map((role) => [role, { treated: [], controlStrategy: [] }]),
);
const trialTruthSubjects = [];
const usedLinks = new Set();
const linkOf = (patientId) =>
  `lk-${sha256(`medtrust-registration:${patientId}`).slice(0, 24)}`;

function pickRole(age, severity, sex) {
  const trialProbability =
    0.18 +
    0.018 * severity +
    (sex === "F" ? 0.004 : 0) +
    (age >= 65 ? 0.006 : 0);
  const externalSplit = hashUnit(`${SEED}:${age}:${severity}:secondary`);
  const draw = rng();
  if (draw < trialProbability) return "trial";
  return externalSplit < 0.62 ? "control-primary" : "control-secondary";
}

function missingFor(role, severity) {
  if (MISSINGNESS === "MCAR") return rng() < 0.04;
  if (MISSINGNESS === "MAR") return rng() < 0.025 + severity * 0.06;
  return rng() < 0.015 + (role === "trial" ? 0 : 0.045) + severity * 0.05;
}

for (const [index, { patient, age }] of eligible.entries()) {
  const linkKey = linkOf(patient.Id);
  if (usedLinks.has(linkKey)) continue;
  usedLinks.add(linkKey);
  const sex = patient.GENDER === "M" ? "M" : "F";
  const severity = Math.floor(rng() * 5) + 1;
  const diseaseDuration = Math.floor(rng() * 15);
  const comorbidityIndex = Math.floor(rng() * 7);
  const priorTreatment = rng() < 0.55 ? 1 : 0;
  const keyBiomarker = Number((rng() * 9 + 1).toFixed(2));
  const role =
    index === 0
      ? "trial"
      : index === 1
        ? "control-primary"
        : index === 2
          ? "control-secondary"
          : pickRole(age, severity, sex);
  const sourceId =
    role === "trial"
      ? "sponsor-trial"
      : role === "control-primary"
        ? "external-primary"
        : "external-secondary";
  const timeZeroDay = referenceDay - 365 * 5 + Math.floor(rng() * 365 * 4);
  const baselineRisk =
    (role === "trial" ? 0.17 : role === "control-primary" ? 0.19 : 0.22) +
    severity * 0.012 +
    (age >= 65 ? 0.025 : 0);
  const rrTrue = role === "trial" ? 0.65 : 1;
  const eventProbability = Math.min(0.95, baselineRisk * rrTrue);
  let outcome = rng() < eventProbability ? "pos" : "neg";
  const followUpDays = 90 + Math.floor(rng() * 640);
  const censored = rng() < 0.08;
  const competingRisk = !censored && rng() < 0.015;
  let outcomeDay = timeZeroDay + Math.min(
    followUpDays,
    20 + Math.floor(rng() * 240),
  );
  const censorDay = censored
    ? timeZeroDay + Math.max(1, Math.floor(followUpDays * 0.65))
    : null;
  if (censorDay !== null && outcomeDay > censorDay) {
    outcome = "neg";
    outcomeDay = null;
  }
  if (role === "trial") {
    injectedRisk.trial.treated.push(eventProbability);
    injectedRisk.trial.controlStrategy.push(Math.min(0.95, baselineRisk));
    trialTruthSubjects.push({
      age,
      sex,
      treatedRisk: eventProbability,
      controlRisk: Math.min(0.95, baselineRisk),
    });
  }
  const missing = missingFor(role, severity);
  const record = {
    synthetic: true,
    subjectKey: `${role === "trial" ? "sp" : "ext"}-${sha256(`${role}:${index}`).slice(0, 16)}`,
    linkKey,
    sourceId,
    age,
    sex,
    calendarYear: new Date(timeZeroDay * dayMs).getUTCFullYear(),
    timeZero: isoDay(timeZeroDay),
    eligibleAtTimeZero: true,
    treatmentStrategy: role === "trial" ? "investigational-regimen" : "historical-standard-care",
    severity: missing && rng() < 0.5 ? null : severity,
    diseaseDuration,
    comorbidityIndex,
    priorTreatment,
    keyBiomarker,
    outcome,
    outcomeDate: outcome === "pos" && outcomeDay !== null ? isoDay(outcomeDay) : null,
    censorDate: censorDay === null ? null : isoDay(censorDay),
    followUpDays,
    intercurrentEvents: competingRisk ? ["competing-risk-event"] : [],
    missingFields: missing ? ["severity"] : [],
  };
  if (
    (outcomeDay !== null && outcomeDay < timeZeroDay) ||
    (censorDay !== null && censorDay < timeZeroDay)
  )
    throw new Error(`date logic failed for synthetic subject ${record.subjectKey}`);
  records[role].push(record);
}

const allLinks = roles.flatMap((role) => records[role].map((record) => record.linkKey));
const disjointLinkKeys = new Set(allLinks).size === allLinks.length;
if (!disjointLinkKeys)
  throw new Error("trial/control linkKey partitions overlap");
const targetDiagnosisCount = activeDiagnosis.size;
if (targetDiagnosisCount === 0)
  throw new Error("no active target diagnosis found; refusing to emit empty fixtures");
if (records.trial.length === 0 || records["control-primary"].length === 0)
  throw new Error("trial or primary external control cohort is empty");

const requiredKeys = [
  "subjectKey",
  "linkKey",
  "sourceId",
  "timeZero",
  "eligibleAtTimeZero",
  "treatmentStrategy",
  "outcome",
  "followUpDays",
];
const allRecords = roles.flatMap((role) => records[role]);
const requiredFieldsPresent = allRecords.every((record) =>
  requiredKeys.every(
    (key) => record[key] !== null && record[key] !== undefined && record[key] !== "",
  ),
);
const dateOrdering = allRecords.every((record) => {
  const zero = dayNumber(record.timeZero);
  if (record.outcome === "pos") {
    if (!record.outcomeDate) return false;
    const eventDay = dayNumber(record.outcomeDate);
    if (eventDay < zero) return false;
    if (record.censorDate && eventDay > dayNumber(record.censorDate)) return false;
  }
  return !record.censorDate || dayNumber(record.censorDate) >= zero;
});
const allSourcePartitionsNonEmpty = roles.every((role) => records[role].length > 0);
const eventRateConsistent = allRecords.every(
  (record) =>
    ["pos", "neg"].includes(record.outcome) &&
    Number.isInteger(record.followUpDays) &&
    record.followUpDays >= 0,
);

const bySex = Object.fromEntries(
  ["M", "F"].map((sex) => [sex, eligible.filter(({ patient }) => patient.GENDER === "M" ? sex === "M" : sex === "F").length]),
);
const byAgeBand = Object.fromEntries(
  [
    ["18-39", 18, 39],
    ["40-64", 40, 64],
    ["65-80", 65, 80],
  ].map(([label, min, max]) => [
    label,
    eligible.filter(({ age }) => age >= Number(min) && age <= Number(max)).length,
  ]),
);
const dataQuality = {
  schema: "medtrust.registration-data-quality/v1",
  syntheticOnly: true,
  pass: false,
  inputPatients: patients.length,
  targetDiagnosisPatients: targetDiagnosisCount,
  eligiblePatients: eligible.length,
  excluded,
  partitions: Object.fromEntries(
    roles.map((role) => [
      role,
      {
        n: records[role].length,
        outcomePositive: records[role].filter((record) => record.outcome === "pos").length,
        observedEventRate:
          records[role].length === 0
            ? null
            : Number(
                (
                  records[role].filter((record) => record.outcome === "pos").length /
                  records[role].length
                ).toFixed(6),
              ),
        missingSeverity: records[role].filter((record) => record.severity === null).length,
        censored: records[role].filter((record) => record.censorDate !== null).length,
      },
    ]),
  ),
  distributions: {
    sex: bySex,
    ageBand: byAgeBand,
    source: Object.fromEntries(roles.map((role) => [role, records[role].length])),
  },
  checks: {
    disjointLinkKeys,
    dateOrdering,
    requiredFieldsPresent,
    eventRateConsistent,
    allSourcePartitionsNonEmpty,
  },
};
dataQuality.pass = Object.values(dataQuality.checks).every(Boolean);
if (!dataQuality.pass)
  throw new Error("registration data-quality checks failed");

const average = (values) =>
  values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
const trialTreatedRisk = average(
  trialTruthSubjects.map((subject) => subject.treatedRisk),
);
const trialControlRisk = average(
  trialTruthSubjects.map((subject) => subject.controlRisk),
);
const truthStrata = Object.fromEntries(
  [
    ["sex:F", (subject) => subject.sex === "F"],
    ["sex:M", (subject) => subject.sex === "M"],
    ["age:18-39", (subject) => subject.age >= 18 && subject.age <= 39],
    ["age:40-64", (subject) => subject.age >= 40 && subject.age <= 64],
    ["age:65-80", (subject) => subject.age >= 65 && subject.age <= 80],
  ].map(([key, predicate]) => {
    const subjects = trialTruthSubjects.filter(predicate);
    const treatedRisk = average(subjects.map((subject) => subject.treatedRisk));
    const controlRisk = average(subjects.map((subject) => subject.controlRisk));
    return [
      key,
      {
        n: subjects.length,
        treatedRisk,
        controlStrategyRisk: controlRisk,
        rr:
          treatedRisk === null || controlRisk === null || controlRisk === 0
            ? null
            : treatedRisk / controlRisk,
        riskDifference:
          treatedRisk === null || controlRisk === null
            ? null
            : treatedRisk - controlRisk,
      },
    ];
  }),
);
const confounderSummary = (key) => {
  const values = allRecords
    .map((record) => record[key])
    .filter((value) => value !== null && value !== undefined);
  const numeric = values.filter((value) => typeof value === "number");
  if (numeric.length === values.length) {
    return {
      type: "numeric",
      n: numeric.length,
      missing: allRecords.length - numeric.length,
      min: Math.min(...numeric),
      max: Math.max(...numeric),
      mean: Number(average(numeric).toFixed(6)),
    };
  }
  return {
    type: "categorical",
    n: values.length,
    missing: allRecords.length - values.length,
    distribution: Object.fromEntries(
      [...new Set(values)].sort().map((value) => [
        String(value),
        values.filter((candidate) => candidate === value).length,
      ]),
    ),
  };
};

const answerKey = {
  schema: "medtrust.registration-answer-key/v1",
  syntheticOnly: true,
  disclaimer:
    "Synthetic method-validation fixture only; no clinical efficacy, safety, or regulatory conclusion.",
  design: {
    studyId: "REG-ECA-001",
    estimand: "ATT",
    estimator: "IPTW-ATT",
    timeZero: "treatment-or-index-date",
    outcome: "90-day-or-longer composite event",
    caliperDays: CALIPER_DAYS,
    missingness: MISSINGNESS,
  },
  truth: {
    rr: 0.65,
    treatedRisk: Number(trialTreatedRisk.toFixed(6)),
    controlStrategyRisk: Number(trialControlRisk.toFixed(6)),
    riskDifference: Number((trialTreatedRisk - trialControlRisk).toFixed(6)),
    expectedDirection: "protective-in-synthetic-scenario",
    expectedRecoveryRange: { rrLow: 0.5, rrHigh: 0.8 },
    strata: truthStrata,
  },
  generatedDistribution: Object.fromEntries(
    studyConfig.confounders.map((confounder) => [
      confounder,
      confounderSummary(confounder),
    ]),
  ),
  sourceAllocation: {
    model:
      "probability varies with severity, sex and age; external sources split by deterministic hash",
    observed: Object.fromEntries(
      roles.map((role) => [role, records[role].length]),
    ),
    externalSplitPrimary: 0.62,
  },
  baselineRiskModel: {
    trial: 0.17,
    "control-primary": 0.19,
    "control-secondary": 0.22,
    severityCoefficient: 0.012,
    age65Plus: 0.025,
    treatmentRiskRatio: 0.65,
  },
  exclusionCounts: excluded,
  partitionCounts: dataQuality.partitions,
};

const manifest = {
  schema: "medtrust.synthea-registration-generation/v1",
  syntheticOnly: true,
  generatedAt: isoDay(referenceDay),
  inputs: {
    seed: SEED,
    populationArgument: flag("--population", null),
    age: AGE,
    state: STATE,
    referenceDate: REFERENCE_DATE,
    missingness: MISSINGNESS,
    pins: { path: PINS, sha256: fileSha(PINS) },
    studyConfig: { path: STUDY_CONFIG, sha256: fileSha(STUDY_CONFIG) },
    keepModule: { path: KEEP_MODULE, sha256: fileSha(KEEP_MODULE) },
    jar: { path: JAR, sha256: existsSync(JAR) ? fileSha(JAR) : null },
    syntheaCsv: Object.fromEntries(
      ["patients.csv", "conditions.csv"]
        .filter((name) => existsSync(join(SYNTHEA_DIR, name)))
        .map((name) => [name, fileSha(join(SYNTHEA_DIR, name))]),
    ),
  },
  outputs: Object.fromEntries(
    roles.map((role) => [`${role}/records.json`, null]),
  ),
  executable: "scripts/build-registration-eca-fixtures.mjs",
};

mkdirSync(OUT, { recursive: true });
for (const role of roles) {
  mkdirSync(join(OUT, role), { recursive: true });
  const path = join(OUT, role, "records.json");
  const text = JSON.stringify(records[role], null, 2) + "\n";
  writeFileSync(path, text);
  manifest.outputs[`${role}/records.json`] = sha256(text);
}
for (const [name, value] of [
  ["answer-key.json", answerKey],
  ["data-quality-report.json", dataQuality],
]) {
  const text = JSON.stringify(value, null, 2) + "\n";
  writeFileSync(join(OUT, name), text);
  manifest.outputs[name] = sha256(text);
}
manifest.outputDigest = sha256(JSON.stringify(manifest.outputs));
writeFileSync(join(OUT, "generation-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log(
  `synthetic fixtures: eligible=${eligible.length} trial=${records.trial.length} ` +
    `primary=${records["control-primary"].length} secondary=${records["control-secondary"].length}`,
);
console.log(`output: ${OUT}`);
