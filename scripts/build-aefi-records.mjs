#!/usr/bin/env node
/**
 * Synthea 合成人群 → 疫苗接种后不良事件主动监测（SCRI）演示的两方数据 + 真实值。
 *
 *   node scripts/build-aefi-records.mjs --synthea <synthea 输出的 csv 目录> [--out data/demo/aefi]
 *
 * 产物：
 *   <out>/cdc/records.json      区疾控（免疫规划）：全部受种者的接种史（CVX + 日期）
 *   <out>/ruijin/records.json   瑞金医院：本院就诊人群的心肌炎 / 心包炎就诊事件（日期 + ICD-10）
 *   <out>/answer-key.json       注入参数与按 SCRI 口径算出的期望计数（真跑结果对拍用）
 *
 * 哪些来自 Synthea、哪些是注入的（物料里必须如实说明）：
 *  - 人群、出生日期、性别、**接种史（疫苗种类与接种日期）**：Synthea 生成（6000+ 人）；
 *  - **心肌炎 / 心包炎就诊**：Synthea 不模拟疫苗不良反应，按下方参数注入的**合成信号**，
 *    基线发生率为演示统计功效而放大，**远高于真实水平，不代表任何疫苗的真实风险**。
 *
 * 注入模型（确定性，固定种子）：
 *  - 医院覆盖：每人按假名哈希以 70% 概率在瑞金有就诊记录（只有这些人可能出现事件）；
 *  - 基线：对覆盖人群，在每个 mRNA 剂次前后各 60 天的时段内，按恒定日发生率 λ0 生成事件
 *    （等价于恒定基线风险；只模拟分析会用到的时间段，避免产生无意义的海量记录）；
 *  - 信号：仅「<40 岁男性」的 mRNA 剂次，在接种后第 1–7 天额外以概率 (RI−1)·7·λ0 产生一次事件
 *    （真实相对发生率 RI 设为 4；其余分层 RI = 1，即无信号）。
 *
 * 窗口：风险期 = 接种后第 1–7 天；对照期 = **接种前**第 42–22 天。mRNA 疫苗两剂间隔约 21 天，
 * 若把对照期放在接种后第 22–42 天，会与下一剂的风险期重叠、同一事件被重复计入；接种前对照期避开了这一点
 * （代价：受种者在接种前可能因身体不适推迟接种，即「健康受种者效应」，会让对照期事件偏少、RI 偏高）。
 *
 * 关联假名：`linkKey = sha256(共享盐 ‖ Synthea 患者 Id)` 前 20 位，模拟各机构用同一把盐从身份证号
 * 派生的跨机构假名；`subjectKey` 是各机构自己的院内假名，彼此不同。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const SYN = flag('--synthea');
const OUT = flag('--out', 'data/demo/aefi');
if (!SYN) {
  console.error('用法：node scripts/build-aefi-records.mjs --synthea <csv 目录> [--out data/demo/aefi]');
  process.exit(2);
}

const PARAMS = {
  seed: 20261003,
  salt: 'medtrust-aefi-demo-salt-v1',
  period: ['2020-12-01', '2023-12-31'],
  mrnaCodes: ['207', '208'],
  eventCodes: { 'I40.9': 0.6, 'I30.9': 0.4 },
  hospitalCoverage: 0.7,
  lambda0PerDay: 1e-3,
  signalStratum: '<40|M',
  trueRI: 4,
  windows: { risk: [1, 7], control: [-42, -22] },
  backgroundSpan: [-60, 60],
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
const poisson = (mean) => {
  let k = 0;
  let p = Math.exp(-mean);
  let s = p;
  const u = rand();
  while (u > s) { k++; p *= mean / k; s += p; }
  return k;
};
const sha = (s) => createHash('sha256').update(s).digest('hex');
const DAY = 86_400_000;
const dayNum = (iso) => Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / DAY);
const isoOf = (day) => new Date(day * DAY).toISOString().slice(0, 10);
const pick = (weights) => {
  const u = rand();
  let acc = 0;
  for (const [k, w] of Object.entries(weights)) { acc += w; if (u < acc) return k; }
  return Object.keys(weights).at(-1);
};

// ── 读 Synthea ───────────────────────────────────────────────────────────
const patients = parseCsv(readFileSync(join(SYN, 'patients.csv'), 'utf8'));
const immunizations = parseCsv(readFileSync(join(SYN, 'immunizations.csv'), 'utf8'));
const [p0, p1] = PARAMS.period.map(dayNum);
const refAgeDay = dayNum('2021-06-01');

const person = new Map();
for (const p of patients) {
  const ageYears = (refAgeDay - dayNum(p.BIRTHDATE)) / 365.25;
  person.set(p.Id, {
    id: p.Id,
    sex: p.GENDER === 'M' ? 'M' : 'F',
    ageBand: ageYears < 40 ? '<40' : '40+',
    linkKey: `lk-${sha(`${PARAMS.salt}:${p.Id}`).slice(0, 20)}`,
    doses: [],
  });
}
for (const im of immunizations) {
  const who = person.get(im.PATIENT);
  const day = dayNum(im.DATE);
  if (!who || day < p0 || day > p1) continue;
  who.doses.push({ code: String(im.CODE), day });
}
for (const who of person.values()) who.doses.sort((a, b) => a.day - b.day);

// ── 两方数据 + 注入 ──────────────────────────────────────────────────────
const registry = [];
const hospital = [];
const isMrna = (code) => PARAMS.mrnaCodes.includes(code);
let injectedSignal = 0;
let background = 0;

for (const who of person.values()) {
  if (who.doses.length) {
    registry.push({
      subjectKey: `cdc-${sha(`cdc:${who.id}`).slice(0, 16)}`,
      linkKey: who.linkKey,
      ageBand: who.ageBand,
      sex: who.sex,
      conditions: [],
      medications: [],
      adverseEvents: [],
      immunizations: who.doses.map((d) => ({ code: d.code, date: isoOf(d.day) })),
    });
  }
  const covered = parseInt(sha(`cover:${who.id}`).slice(0, 8), 16) / 0xffffffff < PARAMS.hospitalCoverage;
  if (!covered) continue;

  const mrna = who.doses.filter((d) => isMrna(d.code));
  const eventDays = new Set();
  // 基线：各剂次 [-30, +60] 区间的并集上按 λ0 生成
  const covered_days = new Set();
  for (const d of mrna)
    for (let k = PARAMS.backgroundSpan[0]; k <= PARAMS.backgroundSpan[1]; k++) covered_days.add(d.day + k);
  const span = [...covered_days].sort((a, b) => a - b);
  const n = poisson(span.length * PARAMS.lambda0PerDay);
  for (let i = 0; i < n; i++) { eventDays.add(span[Math.floor(rand() * span.length)]); background++; }
  // 信号：<40 岁男性的 mRNA 剂次，接种后第 1–7 天
  if (`${who.ageBand}|${who.sex}` === PARAMS.signalStratum)
    for (const d of mrna)
      if (rand() < (PARAMS.trueRI - 1) * 7 * PARAMS.lambda0PerDay) {
        eventDays.add(d.day + 1 + Math.floor(rand() * 7));
        injectedSignal++;
      }

  hospital.push({
    subjectKey: `ruijin-${sha(`ruijin:${who.id}`).slice(0, 16)}`,
    linkKey: who.linkKey,
    ageBand: who.ageBand,
    sex: who.sex,
    conditions: [],
    medications: [],
    adverseEvents: [],
    datedEvents: [...eventDays].sort((a, b) => a - b).map((day) => ({ code: pick(PARAMS.eventCodes), date: isoOf(day) })),
  });
}

// ── 期望值（与节点内算子同一口径：一剂一行 × 同人每次事件；按接种侧分层）──────────
const eventsByLink = new Map(hospital.map((h) => [h.linkKey, h.datedEvents.map((e) => dayNum(e.date))]));
const strata = new Map();
for (const r of registry)
  for (const dose of r.immunizations) {
    if (!isMrna(dose.code)) continue;
    const key = `${r.ageBand}|${r.sex}`;
    const cell = strata.get(key) ?? { key, doses: 0, riskEvents: 0, controlEvents: 0 };
    cell.doses++;
    for (const e of eventsByLink.get(r.linkKey) ?? []) {
      const d = e - dayNum(dose.date);
      if (d >= PARAMS.windows.risk[0] && d <= PARAMS.windows.risk[1]) cell.riskEvents++;
      else if (d >= PARAMS.windows.control[0] && d <= PARAMS.windows.control[1]) cell.controlEvents++;
    }
    strata.set(key, cell);
  }

mkdirSync(join(OUT, 'cdc'), { recursive: true });
mkdirSync(join(OUT, 'ruijin'), { recursive: true });
writeFileSync(join(OUT, 'cdc', 'records.json'), JSON.stringify(registry));
writeFileSync(join(OUT, 'ruijin', 'records.json'), JSON.stringify(hospital));
const answer = {
  generatedAt: new Date().toISOString(),
  source: 'Synthea 合成人群（接种史）+ 注入的心肌炎/心包炎合成信号',
  params: PARAMS,
  counts: {
    syntheaPatients: patients.length,
    registryPersons: registry.length,
    registryDoses: registry.reduce((s, r) => s + r.immunizations.length, 0),
    mrnaDoses: registry.reduce((s, r) => s + r.immunizations.filter((d) => isMrna(d.code)).length, 0),
    hospitalPersons: hospital.length,
    hospitalEvents: hospital.reduce((s, h) => s + h.datedEvents.length, 0),
    injectedBackground: background,
    injectedSignal,
  },
  expected: { analysisType: 'vaccine-scri', windows: PARAMS.windows, strata: [...strata.values()].sort((a, b) => (a.key < b.key ? -1 : 1)) },
};
writeFileSync(join(OUT, 'answer-key.json'), JSON.stringify(answer, null, 2));
console.log(JSON.stringify({ counts: answer.counts, expected: answer.expected.strata }, null, 2));
