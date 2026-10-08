#!/usr/bin/env node
/**
 * Synthea 合成人群 → 跨院去重的发病率与罕见病登记演示的两院数据 + 真实值。
 *
 *   node scripts/build-dedup-records.mjs --synthea <synthea csv 目录> [--out data/demo/dedup]
 *
 * 产物：
 *   <out>/hospital-a/records.json   甲院队列（观察期 + 事件 + 罕见病）
 *   <out>/hospital-b/records.json   乙院队列（同一患者可能两院都有）
 *   <out>/answer-key.json           注入参数 + 去重后期望值 + 「各院直接相加」对比值 + 虚增比例
 *
 * 哪些来自 Synthea、哪些是注入的（物料里必须如实说明）：
 *  - 人群、出生日期、性别：Synthea 生成；
 *  - **跨院分布、观察期、常见事件、罕见病**：全部为注入的**合成信号**。
 *    - **跨院重复比例是注入的**（不代表真实人群的跨院就诊比例）；
 *    - **罕见病患病率已放大**（为统计功效），不代表任何真实罕见病发病率；
 *    - 结果只能读作「在本合成队列上，直接相加会虚增多少」，**不得**读作任何地区/人群的发病率。
 *
 * 注入模型（确定性，固定种子）：
 *  - 跨院分布：`both`（两院都有）/ `aOnly` / `bOnly` / 都不去，四个桶按比例抽；
 *  - 观察期：每人每院一段，长度在 `observationLengthDays` 内均匀；
 *    `both` 的人一半让两院观察期**部分重叠**（考验人时并集），一半让两院观察期**中间空 1 天**
 *    （考验「填补 1 天边界空隙」开关）；
 *  - 常见事件：按年龄分层的年发生率 × 观察年数做 Poisson 抽样；`both` 的人有一部分事件
 *    会被**两院各记一次**（同编码同日期）——考验事件去重；
 *  - 罕见病：按年龄分层的年发生率（已放大量）× 观察年数抽样；`both` 的人两院各记一次
 *    （日期可不同）——考验「首次诊断取最早 + 按人去重」。
 *
 * 关联假名：`linkKey = sha256(共享盐 ‖ Synthea 患者 Id)` 前 20 位（同 AEFI / VE 口径）。
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
const OUT = flag('--out', 'data/demo/dedup');
if (!SYN) {
  console.error('用法：node scripts/build-dedup-records.mjs --synthea <csv 目录> [--out data/demo/dedup]');
  process.exit(2);
}

let dedupIncidenceCount;
try {
  ({ dedupIncidenceCount } = await import(join(HERE, '..', 'packages', 'wasm-algorithms', 'dist', 'index.js')));
} catch (e) {
  console.error('需要先构建算子包：pnpm --filter @medtrust/wasm-algorithms build:ts');
  console.error(String(e));
  process.exit(2);
}

const PARAMS = {
  seed: 20261004,
  salt: 'medtrust-dedup-demo-salt-v1',
  period: ['2021-01-01', '2023-12-31'],
  refDate: '2022-06-01',
  split: { both: 0.2, aOnly: 0.4, bOnly: 0.35 }, // 余下 5% 不去医院
  observationLengthDays: [180, 730],
  overlapAmongBoth: 0.5, // 另一半为「空 1 天」
  eventCodes: ['I21.9'], // 急性心肌梗死（常见结局，注入）
  rareCodes: ['E76.0'], // 黏多糖贮积症 I 型（罕见病，注入且放大）
  duplicateEventRate: 0.25, // 被两院各记一次的事件比例
  /**
   * 事件发生率放大倍数：真实急性心梗年发生率约 0.2%–1%，这里按分层放大 10 倍
   * （为让每层事件数与 Poisson 区间有统计功效）。**远高于真实水平**，物料必须如实标注。
   */
  eventRateAmplification: 10,
  eventRatePerYear: { '18-39': 0.04, '40-64': 0.12, '65+': 0.3 }, // 已放大 10 倍（真实约 0.004/0.012/0.03）
  rareRatePerYear: { '18-39': 0.0002, '40-64': 0.004, '65+': 0.05 }, // 已放大（真实约 1/10 万量级）
  minCell: 5,
  minCellRare: 10,
  ageBands: [
    { key: '18-39', max: 39 },
    { key: '40-64', max: 64 },
    { key: '65+', max: 200 },
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
const poisson = (mean) => {
  if (mean <= 0) return 0;
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

// ── 读 Synthea + 分桶 ────────────────────────────────────────────────────
const patients = parseCsv(readFileSync(join(SYN, 'patients.csv'), 'utf8'));
const [p0, p1] = PARAMS.period.map(dayNum);
const refDay = dayNum(PARAMS.refDate);
const bandOf = (ageYears) => PARAMS.ageBands.find((b) => ageYears <= b.max)?.key ?? '65+';

const people = [];
for (const p of patients) {
  const ageYears = (refDay - dayNum(p.BIRTHDATE)) / 365.25;
  if (ageYears < 18) continue;
  const u = rand();
  const bucket =
    u < PARAMS.split.both ? 'both'
      : u < PARAMS.split.both + PARAMS.split.aOnly ? 'aOnly'
        : u < PARAMS.split.both + PARAMS.split.aOnly + PARAMS.split.bOnly ? 'bOnly'
          : 'neither';
  people.push({
    id: p.Id,
    sex: p.GENDER === 'M' ? 'M' : 'F',
    ageBand: bandOf(ageYears),
    linkKey: `lk-${sha(`${PARAMS.salt}:${p.Id}`).slice(0, 20)}`,
    bucket,
  });
}

// ── 两院数据 + 注入 ──────────────────────────────────────────────────────
const hospitalA = [];
const hospitalB = [];
const answerRows = { observations: [], events: [], rareDiseases: [], strataKeys: [] };
const injected = {
  both: 0, aOnly: 0, bOnly: 0, neither: 0,
  overlappingWindows: 0, oneDayGapWindows: 0,
  events: 0, duplicatedEvents: 0, rareCases: 0, duplicatedRare: 0,
};

const windowFor = (startFloor) => {
  const len = PARAMS.observationLengthDays[0] +
    Math.floor(rand() * (PARAMS.observationLengthDays[1] - PARAMS.observationLengthDays[0] + 1));
  const start = startFloor + Math.floor(rand() * Math.max(1, p1 - len - startFloor));
  return { start, end: start + len };
};

for (const who of people) {
  injected[who.bucket]++;
  const inA = who.bucket === 'both' || who.bucket === 'aOnly';
  const inB = who.bucket === 'both' || who.bucket === 'bOnly';

  const windows = {};
  if (inA) windows.A = windowFor(p0);
  if (inB) {
    if (who.bucket === 'both' && windows.A) {
      if (rand() < PARAMS.overlapAmongBoth) {
        // 与 A 部分重叠：B 从 A 的中段开始
        const mid = windows.A.start + Math.floor((windows.A.end - windows.A.start) * 0.4);
        const len = PARAMS.observationLengthDays[0] +
          Math.floor(rand() * (PARAMS.observationLengthDays[1] - PARAMS.observationLengthDays[0] + 1));
        windows.B = { start: mid, end: Math.min(p1, mid + len) };
        injected.overlappingWindows++;
      } else {
        // 空 1 天（A 结束后的第 2 天开始）——考验「填补 1 天边界空隙」开关
        const start = windows.A.end + 2;
        const len = PARAMS.observationLengthDays[0] +
          Math.floor(rand() * (PARAMS.observationLengthDays[1] - PARAMS.observationLengthDays[0] + 1));
        windows.B = { start, end: Math.min(p1, start + len) };
        if (windows.B.start <= windows.B.end) injected.oneDayGapWindows++;
        else delete windows.B;
      }
    } else {
      windows.B = windowFor(p0);
    }
  }

  const eventRate = PARAMS.eventRatePerYear[who.ageBand];
  const rareRate = PARAMS.rareRatePerYear[who.ageBand];
  const eventsByHospital = { A: [], B: [] };
  let rare = null;

  for (const [tag, w] of Object.entries(windows)) {
    if (!w || w.start > w.end) continue;
    const years = (w.end - w.start + 1) / 365.25;
    const n = poisson(eventRate * years);
    for (let i = 0; i < n; i++) {
      const day = w.start + Math.floor(rand() * (w.end - w.start + 1));
      eventsByHospital[tag].push({ code: PARAMS.eventCodes[0], day });
      injected.events++;
    }
    if (!rare && rand() < Math.min(1, rareRate * years)) {
      rare = { code: PARAMS.rareCodes[0], day: w.start + Math.floor(rand() * (w.end - w.start + 1)) };
      injected.rareCases++;
    }
  }

  // 同一事件被两院各记一次（同编码同日期）：把 A 院事件复制到 B 院，前提是该日落在 B 院观察期内
  if (who.bucket === 'both' && windows.B && eventsByHospital.A.length) {
    for (const e of eventsByHospital.A) {
      if (e.day < windows.B.start || e.day > windows.B.end) continue;
      if (rand() < PARAMS.duplicateEventRate) {
        eventsByHospital.B.push({ code: e.code, day: e.day });
        injected.duplicatedEvents++;
      }
    }
  }
  // 罕见病两院各记一次（日期可不同）——去重后仍只算 1 例、取最早
  if (who.bucket === 'both' && rare) {
    injected.duplicatedRare++;
  }

  const emit = (tag, list, records) => {
    const w = windows[tag];
    if (!w || w.start > w.end) return;
    const events = [...eventsByHospital[tag]]
      .sort((a, b) => a.day - b.day)
      .map((e) => ({ code: e.code, date: isoOf(e.day) }));
    const rareOut = rare
      ? {
          code: rare.code,
          // 两院各记一次时给不同日期（B 院晚 3 天），验证「首次诊断取最早」
          firstDate: isoOf(rare.day + (tag === 'B' && who.bucket === 'both' ? 3 : 0)),
        }
      : null;
    records.push({
      synthetic: true,
      dataSource: 'synthea-base+injected-crosssite',
      subjectKey: `${tag.toLowerCase()}-${sha(`${tag}:${who.id}`).slice(0, 16)}`,
      linkKey: who.linkKey,
      ageBand: who.ageBand,
      sex: who.sex,
      conditions: [],
      medications: [],
      adverseEvents: [],
      observation: { start: isoOf(w.start), end: isoOf(w.end) },
      events,
      rareDisease: rareOut,
    });
    answerRows.observations.push({
      subjectKey: who.linkKey, ageBand: who.ageBand, sex: who.sex,
      start: isoOf(w.start), end: isoOf(w.end),
    });
    for (const e of events)
      answerRows.events.push({ subjectKey: who.linkKey, ageBand: who.ageBand, sex: who.sex, code: e.code, date: e.date });
    if (rareOut)
      answerRows.rareDiseases.push({
        subjectKey: who.linkKey, ageBand: who.ageBand, sex: who.sex,
        code: rareOut.code, firstDate: rareOut.firstDate,
      });
  };

  emit('A', windows.A, hospitalA);
  emit('B', windows.B, hospitalB);
}

answerRows.strataKeys = [...new Set(people.map((p) => `${p.ageBand}|${p.sex}`))].sort();

// ── 期望值：去重后（调算子参考模型）与「各院直接相加」 ─────────────────────
const expected = dedupIncidenceCount({ ...answerRows, mergeAdjacent: true });

// 各院直接相加：每院自己算一份「本院聚合」，然后相加（这正是重复计数的来源）
const naive = new Map();
for (const [tag, records] of [['A', hospitalA], ['B', hospitalB]]) {
  const perStratum = new Map();
  for (const r of records) {
    const key = `${r.ageBand}|${r.sex}`;
    const cell = perStratum.get(key) ?? { subjects: new Set(), days: 0, events: 0, rare: 0 };
    cell.subjects.add(r.linkKey);
    cell.days += dayNum(r.observation.end) - dayNum(r.observation.start) + 1;
    cell.events += r.events.length;
    if (r.rareDisease) cell.rare++;
    perStratum.set(key, cell);
  }
  for (const [key, cell] of perStratum) {
    const acc = naive.get(key) ?? { key, uniqueSubjects: 0, personDays: 0, events: 0, rareCases: 0 };
    acc.uniqueSubjects += cell.subjects.size;
    acc.personDays += cell.days;
    acc.events += cell.events;
    acc.rareCases += cell.rare;
    naive.set(key, acc);
  }
}

const comparison = expected.strata.map((s) => {
  const n = naive.get(s.key) ?? { uniqueSubjects: 0, personDays: 0, events: 0, rareCases: 0 };
  const inflation = (naiveV, dedupV) => (dedupV > 0 ? Number((naiveV / dedupV - 1).toFixed(4)) : null);
  return {
    key: s.key,
    deduped: s,
    naiveSum: { uniqueSubjects: n.uniqueSubjects, personDays: n.personDays, events: n.events, rareCases: n.rareCases },
    inflation: {
      uniqueSubjects: inflation(n.uniqueSubjects, s.uniqueSubjects),
      personDays: inflation(n.personDays, s.personDaysUnion),
      events: inflation(n.events, s.eventsDeduped),
      rareCases: inflation(n.rareCases, s.rareCases),
    },
  };
});

// ── 自检（design 1.2 / 4.2 的边界要求）────────────────────────────────────
const checks = {
  rareAtLeastMinCellRare: comparison.filter((c) => c.deduped.rareCases >= PARAMS.minCellRare).length,
  rareBelowMinCellRare: comparison.filter((c) => c.deduped.rareCases > 0 && c.deduped.rareCases < PARAMS.minCellRare).length,
  strataWithAllCellsAtLeastMinCell: comparison.filter((c) => {
    const d = c.deduped;
    return d.uniqueSubjects >= PARAMS.minCell && d.eventsDeduped >= PARAMS.minCell && d.rareCases >= PARAMS.minCell;
  }).length,
  overlappingWindows: injected.overlappingWindows,
  oneDayGapWindows: injected.oneDayGapWindows,
  duplicatedEvents: injected.duplicatedEvents,
};
const selfCheckPass =
  checks.rareAtLeastMinCellRare >= 1 &&
  checks.rareBelowMinCellRare >= 1 &&
  checks.overlappingWindows >= 1 &&
  checks.oneDayGapWindows >= 1 &&
  checks.duplicatedEvents >= 1;

// ── 落盘 ─────────────────────────────────────────────────────────────────
mkdirSync(join(OUT, 'hospital-a'), { recursive: true });
mkdirSync(join(OUT, 'hospital-b'), { recursive: true });
writeFileSync(join(OUT, 'hospital-a', 'records.json'), JSON.stringify(hospitalA));
writeFileSync(join(OUT, 'hospital-b', 'records.json'), JSON.stringify(hospitalB));
const answer = {
  generatedAt: new Date().toISOString(),
  source: 'Synthea 合成人群（人口基座）+ 注入的跨院分布、观察期、常见事件与罕见病',
  disclaimer:
    '合成数据：跨院重复比例与罕见病患病率均为注入（后者已放大），不代表任何真实人群的发病率或跨院就诊比例；不可用于监管申报。',
  params: PARAMS,
  counts: {
    syntheaPatients: patients.length,
    adultsInStudy: people.length,
    hospitalAPersons: hospitalA.length,
    hospitalBPersons: hospitalB.length,
    dedupedSubjects: expected.strata.reduce((s, x) => s + x.uniqueSubjects, 0),
    injected,
  },
  selfCheck: { ...checks, pass: selfCheckPass },
  expected: { analysisType: 'dedup-incidence', mergeAdjacent: true, strata: expected.strata },
  comparison,
};
writeFileSync(join(OUT, 'answer-key.json'), JSON.stringify(answer, null, 2));
console.log(JSON.stringify({ counts: answer.counts, selfCheck: answer.selfCheck, comparison }, null, 2));
