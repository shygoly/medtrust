#!/usr/bin/env node
/**
 * Synthea 合成人群 → 疫苗真实世界保护效果（检测阴性设计 TND）演示的两方数据 + 真实值。
 *
 *   node scripts/build-ve-records.mjs --synthea <synthea csv 目录> [--out data/demo/ve]
 *
 * 产物：
 *   <out>/cdc/records.json        区疾控（免疫规划）：受种者的接种史（CVX + 剂次 + 日期）
 *   <out>/hospital/records.json   医院：受检者的检测记录（病原码 + 日期 + 阳性/阴性）
 *   <out>/answer-key.json         注入参数 + 按 ve-tnd 口径算出的期望计数与 VE（真跑结果对拍用）
 *
 * 哪些来自 Synthea、哪些是注入的（物料里必须如实说明）：
 *  - 人群、出生日期、性别、**接种史（疫苗种类与接种日期）**：Synthea 生成；
 *  - **检测记录与检测结果**：Synthea 不模拟「因该病就诊并检测」的研究队列，按下方参数注入的
 *    **合成信号**；注入的真保护效果（VE_true）是**人为设定**，未接种阳性率 π0 为统计功效放大，
 *    二者都**不代表任何疫苗的真实保护效果**。
 *
 * 注入模型（确定性，固定种子；TND 惯例：同一人多次检测各次独立计入）：
 *  - 逐分层（年龄段 × 性别）按计划生成检测：`tests` 条；
 *  - 免疫状态按 Synthea 的真实接种史判定（宿主/节点口径）：
 *    检测日前 ≥ immuneDays 完成末剂 = 已接种；0–13 天 = 部分免疫（单列、不入主分析）；无记录 = 未接种；
 *  - 结果：`P(阳性 | 未接种) = π0`；`P(阳性 | 已接种) = π0 × (1 − VE_true)`；
 *    `P(阳性 | 部分免疫) = π0`（不入主分析，仅用于覆盖纳入条件判定）；
 *  - 负例层：`65-79 / 80+` 的 `VE_true = 0`（无保护），用于验证「分层可分辨」；
 *  - **故意不可估层**：`80+|F` 强制「已接种者一律阴性」（`vaccPos = 0`），用于验证
 *    「不可估层必须显示不可估计、不得显示 0 / 100%」；
 *  - 重复检测注入：约 2% 的检测会被**再写一条同人同日**记录（模拟同次就诊重复检测），
 *    节点内按 `(linkKey, 检测日期)` 去重 —— 期望计数 MUST 不受影响。
 *
 * 关联假名：`linkKey = sha256(共享盐 ‖ Synthea 患者 Id)` 前 20 位（同 AEFI 口径）；
 * `subjectKey` 是各机构自己的院内假名，彼此不同、不出院。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const SYN = flag('--synthea');
const OUT = flag('--out', 'data/demo/ve');
if (!SYN) {
  console.error('用法：node scripts/build-ve-records.mjs --synthea <csv 目录> [--out data/demo/ve]');
  process.exit(2);
}

let veTndCount;
let estimateVe;
try {
  ({ veTndCount, estimateVe } = await import(join(HERE, '..', 'packages', 'wasm-algorithms', 'dist', 'index.js')));
} catch (e) {
  console.error('需要先构建算子包：pnpm --filter @medtrust/wasm-algorithms build:ts');
  console.error(String(e));
  process.exit(2);
}

const PARAMS = {
  seed: 20261004,
  salt: 'medtrust-ve-demo-salt-v1',
  period: ['2021-01-01', '2023-12-31'],
  refDate: '2022-06-01',
  vaccineCodes: ['207', '208'], // mRNA（与 AEFI 场景同一疫苗口径）
  pathogenCode: '94500-6', // LOINC：SARS-CoV-2 RNA NAA
  immuneDays: 14,
  pi0: 0.35, // 未接种者阳性率（为统计功效放大，远高于真实）
  duplicateRate: 0.02,
  minCell: 5,
  ageBands: [
    { key: '18-39', max: 39 },
    { key: '40-64', max: 64 },
    { key: '65-79', max: 79 },
    { key: '80+', max: 200 },
  ],
  plan: [
    { key: '18-39|M', ve: 0.6, tests: 340 },
    { key: '18-39|F', ve: 0.6, tests: 320 },
    { key: '40-64|M', ve: 0.6, tests: 340 },
    { key: '40-64|F', ve: 0.6, tests: 320 },
    { key: '65-79|M', ve: 0.0, tests: 300 }, // 负例层：无保护
    { key: '65-79|F', ve: 0.0, tests: 280 },
    { key: '80+|F', ve: 0.0, tests: 12, forceNonEstimable: true }, // 故意不可估层
  ],
};

// ── 小工具 ──────────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(PARAMS.seed);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const DAY = 86_400_000;
const dayNum = (iso) => Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / DAY);
const isoOf = (day) => new Date(day * DAY).toISOString().slice(0, 10);

// ── 读 Synthea ───────────────────────────────────────────────────────────
const patients = parseCsv(readFileSync(join(SYN, 'patients.csv'), 'utf8'));
const immunizations = parseCsv(readFileSync(join(SYN, 'immunizations.csv'), 'utf8'));
const [p0, p1] = PARAMS.period.map(dayNum);
const refDay = dayNum(PARAMS.refDate);

const bandOf = (ageYears) => PARAMS.ageBands.find((b) => ageYears <= b.max)?.key ?? '80+';

const person = new Map();
for (const p of patients) {
  const ageYears = (refDay - dayNum(p.BIRTHDATE)) / 365.25;
  if (ageYears < 18) continue; // 本场景只纳入成人
  person.set(p.Id, {
    id: p.Id,
    sex: p.GENDER === 'M' ? 'M' : 'F',
    ageBand: bandOf(ageYears),
    linkKey: `lk-${sha(`${PARAMS.salt}:${p.Id}`).slice(0, 20)}`,
    doses: [],
  });
}
for (const im of immunizations) {
  const who = person.get(im.PATIENT);
  if (!who) continue;
  if (!PARAMS.vaccineCodes.includes(String(im.CODE))) continue;
  const day = dayNum(im.DATE);
  if (day < p0 || day > p1) continue;
  who.doses.push({ code: String(im.CODE), day });
}
for (const who of person.values()) who.doses.sort((a, b) => a.day - b.day);

const pool = new Map(); // `${ageBand}|${sex}` → persons
for (const who of person.values()) {
  const k = `${who.ageBand}|${who.sex}`;
  pool.set(k, [...(pool.get(k) ?? []), who]);
}

// ── 两方数据 + 注入 ──────────────────────────────────────────────────────
const registry = [];
const hospitalRecords = new Map(); // linkKey → 记录（含 tests 数组）
const flatTests = []; // 供答案键按算子口径计算
const flatDoses = [];
const injected = { positives: 0, negatives: 0, vaccinated: 0, unvaccinated: 0, partial: 0, duplicates: 0, forcedNonEstimable: 0 };
const skippedStrata = [];

for (const plan of PARAMS.plan) {
  const candidates = pool.get(plan.key) ?? [];
  if (candidates.length === 0) {
    // 小基座下某些分层可能没有候选者：跳过并如实记录（不静默忽略）
    skippedStrata.push({ key: plan.key, reason: 'Synthea 人群中该分层无候选者' });
    console.warn(`[warn] 跳过分层 ${plan.key}：候选者为 0`);
    continue;
  }
  for (let i = 0; i < plan.tests; i++) {
    const who = candidates[Math.floor(rand() * candidates.length)];
    const testDay = p0 + Math.floor(rand() * (p1 - p0 + 1));

    // 免疫状态（与算子宿主编码同一口径）：检测日当天或之前最后一剂
    let gap = null;
    for (const d of who.doses) if (d.day <= testDay) gap = testDay - d.day;
    const status = gap === null ? 'unvaccinated' : gap >= PARAMS.immuneDays ? 'vaccinated' : 'partial';

    const pPos =
      status === 'vaccinated' && !plan.forceNonEstimable ? PARAMS.pi0 * (1 - plan.ve) : PARAMS.pi0;
    let result = rand() < pPos ? 'pos' : 'neg';
    if (plan.forceNonEstimable && status === 'vaccinated') {
      result = 'neg'; // 强制 vaccPos = 0 → 该层不可估
      injected.forcedNonEstimable++;
    }

    injected[status === 'vaccinated' ? 'vaccinated' : status === 'unvaccinated' ? 'unvaccinated' : 'partial']++;
    injected[result === 'pos' ? 'positives' : 'negatives']++;

    const test = {
      subjectKey: `hosp-${sha(`hosp:${who.id}`).slice(0, 16)}`,
      linkKey: who.linkKey,
      ageBand: who.ageBand,
      sex: who.sex,
      pathogenCode: PARAMS.pathogenCode,
      date: isoOf(testDay),
      result,
    };
    flatTests.push(test);
    if (!hospitalRecords.has(who.linkKey))
      hospitalRecords.set(who.linkKey, {
        synthetic: true,
        dataSource: 'synthea-base+injected-tests',
        subjectKey: test.subjectKey,
        linkKey: who.linkKey,
        ageBand: who.ageBand,
        sex: who.sex,
        conditions: [],
        medications: [],
        adverseEvents: [],
        tests: [],
      });
    hospitalRecords.get(who.linkKey).tests.push({ code: test.pathogenCode, date: test.date, result: test.result });

    // 重复检测注入（同人同日再写一条）——节点内必须去重
    if (rand() < PARAMS.duplicateRate) {
      const dup = { ...test, result: result === 'pos' ? 'neg' : 'pos' }; // 故意与首条冲突，证明去重不是「随便留一条」
      flatTests.push(dup);
      hospitalRecords.get(who.linkKey).tests.push({ code: dup.pathogenCode, date: dup.date, result: dup.result });
      injected.duplicates++;
    }
  }
}

// 疾控侧：有目标疫苗接种史的受种者（一剂一行，带剂次序号）
for (const who of person.values()) {
  const target = who.doses.filter((d) => PARAMS.vaccineCodes.includes(d.code));
  if (target.length === 0) continue;
  const immunizationsOut = target.map((d, i) => ({ code: d.code, doseNo: i + 1, date: isoOf(d.day) }));
  registry.push({
    synthetic: true,
    dataSource: 'synthea-base+injected-tests',
    subjectKey: `cdc-${sha(`cdc:${who.id}`).slice(0, 16)}`,
    linkKey: who.linkKey,
    ageBand: who.ageBand,
    sex: who.sex,
    conditions: [],
    medications: [],
    adverseEvents: [],
    immunizations: immunizationsOut,
  });
  for (const d of immunizationsOut)
    flatDoses.push({ subjectKey: who.linkKey, vaccinationDate: d.date, vaccineCode: d.code, doseNo: d.doseNo });
}

// ── 期望值：直接调算子的 TS 参考模型（同一口径，避免漂移）────────────────────
const input = {
  immuneDays: PARAMS.immuneDays,
  vaccineCodes: PARAMS.vaccineCodes,
  pathogenCodes: [PARAMS.pathogenCode],
  doses: flatDoses,
  tests: flatTests.map((t) => ({
    subjectKey: t.linkKey,
    testDate: t.date,
    pathogenCode: t.pathogenCode,
    result: t.result,
    ageBand: t.ageBand,
    sex: t.sex,
  })),
};
const expected = veTndCount(input);
const expectedWithVe = expected.strata.map((s) => {
  const est = estimateVe(s);
  return {
    ...s,
    ve: est ? Number(est.ve.toFixed(6)) : null,
    veCi: est ? [Number(est.ciLow.toFixed(6)), Number(est.ciHigh.toFixed(6))] : null,
    corrected: est ? est.corrected : null,
  };
});

// ── 自检（design 1.2：够格的层数与「故意不可估层」都要在）──────────────────
const minCell = PARAMS.minCell;
const veChecks = {
  minCell,
  strataWithAllCellsAtLeastMinCell: expected.strata.filter(
    (s) => Math.min(s.vaccPos, s.vaccNeg, s.unvaccPos, s.unvaccNeg) >= minCell,
  ).length,
  nonEstimableStrata: expected.strata.filter((s) => s.vaccPos === 0 || s.unvaccPos === 0).length,
  duplicatesInjected: injected.duplicates,
  partialImmuneTests: injected.partial,
};
veChecks.pass =
  veChecks.strataWithAllCellsAtLeastMinCell >= 2 &&
  veChecks.nonEstimableStrata >= 1 &&
  veChecks.duplicatesInjected >= 1;
if (!veChecks.pass) console.warn('[warn] VE 自检未通过：', JSON.stringify(veChecks));

// ── 落盘 ─────────────────────────────────────────────────────────────────
mkdirSync(join(OUT, 'cdc'), { recursive: true });
mkdirSync(join(OUT, 'hospital'), { recursive: true });
writeFileSync(join(OUT, 'cdc', 'records.json'), JSON.stringify(registry));
writeFileSync(join(OUT, 'hospital', 'records.json'), JSON.stringify([...hospitalRecords.values()]));
const answer = {
  generatedAt: new Date().toISOString(),
  source: 'Synthea 合成人群（接种史）+ 注入的检测记录与检测结果',
  disclaimer:
    '合成数据：检测记录与 VE 真值均为注入，不代表任何疫苗的真实保护效果；不可用于监管申报。',
  params: PARAMS,
  counts: {
    syntheaPatients: patients.length,
    adultsInStudy: person.size,
    registryPersons: registry.length,
    registryDoses: registry.reduce((s, r) => s + r.immunizations.length, 0),
    hospitalPersons: hospitalRecords.size,
    tests: flatTests.length,
    injected,
    skippedStrata,
  },
  selfCheck: veChecks,
  expected: { analysisType: 'vaccine-tnd', immuneDays: PARAMS.immuneDays, strata: expectedWithVe },
};
writeFileSync(join(OUT, 'answer-key.json'), JSON.stringify(answer, null, 2));
console.log(JSON.stringify({ counts: answer.counts, expected: expectedWithVe }, null, 2));
