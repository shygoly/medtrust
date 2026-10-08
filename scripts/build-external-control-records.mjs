#!/usr/bin/env node
/**
 * Synthea 合成人群 → 单臂试验真实世界外部对照（D1，乐城主线）演示的两方数据 + 真实值。
 *
 *   node scripts/build-external-control-records.mjs --synthea <synthea csv 目录> [--out data/demo/external-control]
 *
 * 产物：
 *   <out>/sponsor/records.json    申办方：单臂试验受试者（索引日 + 结局）
 *   <out>/hospital/records.json   医院：历史病例对照候选池（索引日 + 结局）
 *   <out>/answer-key.json         注入参数 + 按 external-control 口径算出的期望计数与 RR/RD
 *
 * 哪些来自 Synthea、哪些是注入的（物料里必须如实说明）：
 *  - 人群、出生日期、性别：Synthea 生成；
 *  - 「单臂试验受试者」「历史对照池」「90 天结局事件」均为**注入的合成信号**：
 *    对照事件率 π0 为统计功效放大；试验侧事件率 = π0 × RR_true（人为设定）。
 *    两者都**不代表任何药品/器械的真实疗效**。
 *
 * 注入模型（确定性，固定种子；两侧受试者互斥，模拟「试验人群也来自医院但入组后从对照池剔除」）：
 *  - 逐分层（年龄段 × 性别）注入 plan.n 位试验受试者与 plan.pool 位对照候选；
 *    索引日在研究期内均匀分布（匹配窗口 caliper=30 天，池深足够 → 匹配率高）；
 *  - 结局：P(事件|对照) = π0；P(事件|试验) = π0 × RR_true；
 *  - 负例层：RR_true = 1（无差异），用于验证「分层可分辨、不硬造差异」；
 *  - 期望计数由**参考实现** externalControlCount 计算（与模块逐字节对拍过的同一语义）。
 *
 * 关联假名：linkKey = sha256(共享盐 ‖ Synthea 患者 Id) 前 20 位（与 AEFI/VE 同口径）；
 * subjectKey 是各机构自己的假名，彼此不同、不出院。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const SYN = flag('--synthea');
const OUT = flag('--out', 'data/demo/external-control');
if (!SYN) {
  console.error('用法：node scripts/build-external-control-records.mjs --synthea <csv 目录> [--out data/demo/external-control]');
  process.exit(2);
}

let externalControlCount, estimateExternalControl;
try {
  ({ externalControlCount, estimateExternalControl } = await import(join(HERE, '..', 'packages', 'wasm-algorithms', 'dist', 'index.js')));
} catch (e) {
  console.error('需要先构建算子包：pnpm --filter @medtrust/wasm-algorithms build');
  console.error(String(e));
  process.exit(2);
}

const PARAMS = {
  seed: 20261005,
  salt: 'medtrust-ec-demo-salt-v1',
  period: ['2021-01-01', '2023-12-31'],
  caliperDays: 30,
  ratioK: 2,
  pi0: 0.35, // 对照池 90 天事件率（统计功效放大，远高于真实）
  minCell: 5,
  ageBands: [
    { key: '18-39', max: 39 },
    { key: '40-64', max: 64 },
  ],
  plan: [
    { key: '18-39|M', rr: 0.55, n: 130, pool: 1400 },
    { key: '18-39|F', rr: 0.55, n: 110, pool: 1400 },
    { key: '40-64|M', rr: 0.55, n: 110, pool: 1400 },
    { key: '40-64|F', rr: 1.0, n: 110, pool: 1400 }, // 负例层：无差异
  ],
};

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

const patients = parseCsv(readFileSync(join(SYN, 'patients.csv'), 'utf8'));
const [p0, p1] = PARAMS.period.map(dayNum);
const refDay = dayNum('2022-06-01');
const bandOf = (ageYears) => PARAMS.ageBands.find((b) => ageYears <= b.max)?.key ?? '40-64';

const pool = new Map();
for (const p of patients) {
  const ageYears = (refDay - dayNum(p.BIRTHDATE)) / 365.25;
  if (ageYears < 18 || ageYears > 64) continue; // 本场景只纳入 18–64 岁成人
  const who = {
    id: p.Id,
    sex: p.GENDER === 'M' ? 'M' : 'F',
    ageBand: bandOf(ageYears),
    linkKey: `lk-${sha(`${PARAMS.salt}:${p.Id}`).slice(0, 20)}`,
  };
  const k = `${who.ageBand}|${who.sex}`;
  pool.set(k, [...(pool.get(k) ?? []), who]);
}

const sponsorRows = [];
const hospitalRows = [];
const usedLinkKeys = new Set();
const skipped = [];
for (const plan of PARAMS.plan) {
  const candidates = pool.get(plan.key) ?? [];
  if (candidates.length < plan.n + 50) {
    skipped.push({ key: plan.key, reason: `候选者不足（${candidates.length}）` });
    console.warn(`[warn] 跳过分层 ${plan.key}：候选者不足`);
    continue;
  }
  const pick = () => {
    let w = candidates[Math.floor(rand() * candidates.length)];
    let guard = 0;
    while (usedLinkKeys.has(w.linkKey) && guard++ < 200) w = candidates[Math.floor(rand() * candidates.length)];
    usedLinkKeys.add(w.linkKey);
    return w;
  };
  for (let i = 0; i < plan.n; i++) {
    const w = pick();
    const day = p0 + Math.floor(rand() * (p1 - p0 + 1));
    const outcome = rand() < PARAMS.pi0 * plan.rr ? 'pos' : 'neg';
    sponsorRows.push({
      synthetic: true,
      dataSource: 'sponsor-single-arm-trial',
      subjectKey: `sp-${sha(`sp:${w.id}`).slice(0, 16)}`,
      linkKey: w.linkKey,
      ageBand: w.ageBand,
      sex: w.sex,
      indexDate: isoOf(day),
      outcome,
    });
  }
  for (let i = 0; i < plan.pool; i++) {
    const w = pick();
    const day = p0 + Math.floor(rand() * (p1 - p0 + 1));
    const outcome = rand() < PARAMS.pi0 ? 'pos' : 'neg';
    hospitalRows.push({
      synthetic: true,
      dataSource: 'hospital-historical-ehr',
      subjectKey: `hos-${sha(`hos:${w.id}`).slice(0, 16)}`,
      linkKey: w.linkKey,
      ageBand: w.ageBand,
      sex: w.sex,
      indexDate: isoOf(day),
      outcome,
    });
  }
}

const strataKeys = PARAMS.plan.filter((p) => !skipped.some((s) => s.key === p.key)).map((p) => p.key);
// 期望计数按**封存投影后的形状**计算（subjectKey := linkKey）：同日并列对照的排序决胜
// 依赖 subjectKey，两侧与参考必须在同一形状上对拍，否则贪心会取到不同的对照。
const toProjectionShape = (r) => ({ ...r, subjectKey: r.linkKey });
const result = externalControlCount({
  trialRows: sponsorRows.map(toProjectionShape),
  controlRows: hospitalRows.map(toProjectionShape),
  strataKeys,
  caliperDays: PARAMS.caliperDays,
  ratioK: PARAMS.ratioK,
});
const expected = result.strata.map((s) => ({
  key: s.key,
  ...s,
  estimate: estimateExternalControl(s),
}));

// ── 自检（不通过即退出非零，不产出可用的答案键）─────────────────────────
const selfCheck = { pass: true, items: [] };
for (const s of expected) {
  const matchRate = s.matched / (s.matched + s.unmatched || 1);
  const item = { key: s.key, matchRate: Number(matchRate.toFixed(3)) };
  if (matchRate < 0.8) { selfCheck.pass = false; item.problem = '匹配率 < 0.8'; }
  const plan = PARAMS.plan.find((p) => p.key === s.key);
  if (plan.rr < 1 && !(s.estimate && s.estimate.rr < 1)) { selfCheck.pass = false; item.problem = '治疗层 RR 方向不符'; }
  if (plan.rr === 1 && !(s.estimate && s.estimate.rrCi.low <= 1 && s.estimate.rrCi.high >= 1)) { selfCheck.pass = false; item.problem = '负例层 95% CI 未覆盖 1'; }
  selfCheck.items.push(item);
}

const answerKey = {
  source: 'external-control-arm-demo',
  disclaimer: '合成数据；试验/对照/结局均为注入，RR_true 为人为设定，不代表任何药品或器械的真实疗效',
  params: {
    seed: PARAMS.seed,
    period: PARAMS.period,
    caliperDays: PARAMS.caliperDays,
    ratioK: PARAMS.ratioK,
    pi0: PARAMS.pi0,
    minCell: PARAMS.minCell,
    strata: PARAMS.plan.map((p) => ({ key: p.key, rr_true: p.rr, trial: p.n, pool: p.pool })),
  },
  counts: {
    syntheaPatients: patients.length,
    trialSubjects: sponsorRows.length,
    controlPool: hospitalRows.length,
    trialPositives: sponsorRows.filter((r) => r.outcome === 'pos').length,
    controlPositives: hospitalRows.filter((r) => r.outcome === 'pos').length,
  },
  skipped,
  expected: { strata: expected },
  selfCheck,
};

mkdirSync(join(OUT, 'sponsor'), { recursive: true });
mkdirSync(join(OUT, 'hospital'), { recursive: true });
writeFileSync(join(OUT, 'sponsor', 'records.json'), JSON.stringify(sponsorRows, null, 1) + '\n');
writeFileSync(join(OUT, 'hospital', 'records.json'), JSON.stringify(hospitalRows, null, 1) + '\n');
writeFileSync(join(OUT, 'answer-key.json'), JSON.stringify(answerKey, null, 2) + '\n');

console.log(`试验受试者 ${sponsorRows.length}（阳性 ${answerKey.counts.trialPositives}）· 对照池 ${hospitalRows.length}（阳性 ${answerKey.counts.controlPositives}）`);
for (const s of expected) {
  const est = s.estimate;
  console.log(
    `  ${s.key.padEnd(9)} 匹配 ${String(s.matched).padStart(3)}/${s.matched + s.unmatched} · 事件 ${s.mExpPos}/${s.matched} vs ${s.ctlPos}/${s.ctlPos + s.ctlNeg}` +
    (est ? ` · RR ${est.rr.toFixed(2)}（${est.rrCi.low.toFixed(2)}–${est.rrCi.high.toFixed(2)}）· RD ${(est.rd * 100).toFixed(1)}%` : ' · 不可估'),
  );
}
console.log(`selfCheck ${selfCheck.pass ? 'pass' : 'FAIL'}：${JSON.stringify(selfCheck.items)}`);
process.exit(selfCheck.pass ? 0 : 1);
