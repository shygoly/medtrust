// dedup-incidence 模块 vs TS 参考语义 —— 对拍（同一组夹具，逐字段比每层四个计数）。
//
// 夹具刻意覆盖：同一人两院**部分重叠**观察期、**空 1 天**的相邻段（合并开关生效点）、
// 同院重复导出的同一条、同一事件两院各记一次、罕见病同一人两条记录（取最早只计 1 例）、
// 白名单外编码、固定分层之外的记录、多分层。
// 另测：排序契约被破坏 → 返回 6（宁可拒绝，不给悄悄算错的结果）、越界分层 3、非法参数 5。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { BUILD_DIR, readManifest } from "./wasm-utils.mjs";
import {
  dedupIncidenceCount,
  encodeDedupIncidence,
  incidenceRateCiPer100k,
  incidenceRatePer100k,
  poissonExactCi,
} from "../dist/index.js";

const ANALYSIS_TYPE = "dedup-incidence";
const CELL_NAMES = ["uniqueSubjects", "personDaysUnion", "eventsDeduped", "rareCases"];

const DAY = 86_400_000;
/** 以 2024-01-01（第 19723 天）为基准的 ISO 日期。 */
const d = (offset) => new Date((19723 + offset) * DAY).toISOString().slice(0, 10);

function instantiate() {
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === ANALYSIS_TYPE);
  assert.ok(entry, "清单里必须有 dedup-incidence 模块（先跑 node scripts/build.mjs）");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
  assert.equal(instance.exports.abi_version.value, 1);
  return { instance, memory };
}

function clone(enc) {
  return {
    ...enc,
    subjectObs: Uint32Array.from(enc.subjectObs),
    stratumObs: Uint8Array.from(enc.stratumObs),
    startDay: Int32Array.from(enc.startDay),
    endDay: Int32Array.from(enc.endDay),
    subjectEv: Uint32Array.from(enc.subjectEv),
    stratumEv: Uint8Array.from(enc.stratumEv),
    eventKey: Uint32Array.from(enc.eventKey),
    subjectRare: Uint32Array.from(enc.subjectRare),
    stratumRare: Uint8Array.from(enc.stratumRare),
  };
}

function runModule(input, patch = {}) {
  const enc = clone(encodeDedupIncidence(input));
  if (patch.mergeAdjacent !== undefined) enc.mergeAdjacent = patch.mergeAdjacent;
  if (patch.mutate) patch.mutate(enc);

  const { instance, memory } = instantiate();
  const n = patch.n ?? enc.nObs + enc.nEvents + enc.nRare;
  const k = enc.strataKeys.length;
  const inOff = 1024;
  const base = inOff + 16;
  const L = enc.layout;
  const view = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  view.setInt32(inOff, enc.nObs, true);
  view.setInt32(inOff + 4, enc.nEvents, true);
  view.setInt32(inOff + 8, enc.nRare, true);
  view.setInt32(inOff + 12, enc.mergeAdjacent, true);
  const put = (typed, rel) => {
    bytes.set(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength), base + rel);
  };
  put(enc.subjectObs, L.subjectObs);
  put(enc.stratumObs, L.stratumObs);
  put(enc.startDay, L.startDay);
  put(enc.endDay, L.endDay);
  put(enc.subjectEv, L.subjectEv);
  put(enc.stratumEv, L.stratumEv);
  put(enc.eventKey, L.eventKey);
  put(enc.subjectRare, L.subjectRare);
  put(enc.stratumRare, L.stratumRare);

  const outOff = (base + L.bytes + 7) & ~7;
  const code = instance.exports.run(inOff, n, k, outOff);
  const strata = enc.strataKeys.map((key, s) => {
    const row = { key };
    CELL_NAMES.forEach((name, c) => {
      row[name] = view.getUint32(outOff + s * 16 + c * 4, true);
    });
    return row;
  });
  return { code, strata };
}

function fixture() {
  return {
    // 相邻合并默认开（填 1 天边界空隙）
    eventCodes: ["E11"],
    rareCodes: ["R1"],
    strataKeys: ["30-49|M", "50-64|F"],
    observations: [
      // a：两院各一段，部分重叠 → 并集 100..250 = 151 天
      { subjectKey: "a", ageBand: "30-49", sex: "M", start: d(100), end: d(200) },
      { subjectKey: "a", ageBand: "30-49", sex: "M", start: d(150), end: d(250) },
      // b：两段之间空 1 天 → 合并 151 天 / 不合并 150 天
      { subjectKey: "b", ageBand: "30-49", sex: "M", start: d(100), end: d(200) },
      { subjectKey: "b", ageBand: "30-49", sex: "M", start: d(202), end: d(250) },
      // c：两段相距很远 → 各算各的（101 + 50 = 151）
      { subjectKey: "c", ageBand: "50-64", sex: "F", start: d(10), end: d(110) },
      { subjectKey: "c", ageBand: "50-64", sex: "F", start: d(300), end: d(349) },
      // d：同院重复导出的同一条 → 只算一段
      { subjectKey: "d", ageBand: "50-64", sex: "F", start: d(10), end: d(40) },
      { subjectKey: "d", ageBand: "50-64", sex: "F", start: d(10), end: d(40) },
    ],
    events: [
      { subjectKey: "a", ageBand: "30-49", sex: "M", code: "E11", date: d(160) },
      // 同一事件被另一家医院又记了一次（同码同日）→ 去重
      { subjectKey: "a", ageBand: "30-49", sex: "M", code: "E11", date: d(160) },
      { subjectKey: "a", ageBand: "30-49", sex: "M", code: "E11", date: d(170) },
      { subjectKey: "b", ageBand: "30-49", sex: "M", code: "E11", date: d(210) },
      { subjectKey: "c", ageBand: "50-64", sex: "F", code: "E11", date: d(50) },
      // 白名单外编码 → 不纳入
      { subjectKey: "c", ageBand: "50-64", sex: "F", code: "E12", date: d(60) },
    ],
    rareDiseases: [
      // 同一人在两院各有一次罕见病诊断记录 → 只计 1 例（取最早）
      { subjectKey: "a", ageBand: "30-49", sex: "M", code: "R1", firstDate: d(199) },
      { subjectKey: "a", ageBand: "30-49", sex: "M", code: "R1", firstDate: d(120) },
      { subjectKey: "c", ageBand: "50-64", sex: "F", code: "R1", firstDate: d(20) },
      // 固定分层之外 → 不计
      { subjectKey: "z", ageBand: "70+", sex: "F", code: "R1", firstDate: d(20) },
    ],
  };
}

test("dedup-incidence 模块与参考语义逐字段一致（合并相邻=开）", () => {
  const input = fixture();
  const ref = dedupIncidenceCount(input);
  const mod = runModule(input);
  assert.equal(mod.code, 0);
  assert.deepEqual(mod.strata, ref.strata);
  assert.deepEqual(ref.strata, [
    { key: "30-49|M", uniqueSubjects: 2, personDaysUnion: 302, eventsDeduped: 3, rareCases: 1 },
    { key: "50-64|F", uniqueSubjects: 2, personDaysUnion: 182, eventsDeduped: 1, rareCases: 1 },
  ]);
});

test("关闭相邻合并 → 保留 1 天边界空隙（人日 302 → 301）", () => {
  const input = { ...fixture(), mergeAdjacent: false };
  const ref = dedupIncidenceCount(input);
  const mod = runModule(input);
  assert.equal(mod.code, 0);
  assert.deepEqual(mod.strata, ref.strata);
  assert.equal(ref.strata[0].personDaysUnion, 301);
  assert.equal(ref.strata[1].personDaysUnion, 182);
});

test("排序契约被破坏（同一主体观察期起点回退）→ 模块返回 6 拒绝", () => {
  const out = runModule(fixture(), {
    mutate(enc) {
      // 交换同一（层, 主体）的前两行：起点从 100,150 变成 150,100 —— 非降序被破坏
      const swap = (arr) => {
        const t = arr[0];
        arr[0] = arr[1];
        arr[1] = t;
      };
      swap(enc.stratumObs);
      swap(enc.subjectObs);
      swap(enc.startDay);
      swap(enc.endDay);
    },
  });
  assert.equal(out.code, 6);
});

test("观察期起点晚于终点 → 模块返回 5", () => {
  const out = runModule(fixture(), {
    mutate(enc) {
      enc.endDay[0] = enc.startDay[0] - 1;
    },
  });
  assert.equal(out.code, 5);
});

test("分层编号越界 → 模块返回 3", () => {
  const out = runModule(fixture(), {
    mutate(enc) {
      enc.stratumObs[0] = 9;
    },
  });
  assert.equal(out.code, 3);
});

test("头部计数与 n 不一致 → 模块返回 5", () => {
  const out = runModule(fixture(), { n: 999 });
  assert.equal(out.code, 5);
});

test("研究窗口裁剪：窗口外的观察期/事件/罕见病不计（且与参考一致）", () => {
  const input = { ...fixture(), window: { start: d(150), end: d(260) } };
  const ref = dedupIncidenceCount(input);
  const mod = runModule(input);
  assert.equal(mod.code, 0);
  assert.deepEqual(mod.strata, ref.strata);
  assert.deepEqual(ref.strata, [
    // a：两段都被裁到 [150,250]；b：裁后仍能被「填 1 天空隙」并成一段 → 101 + 101
    { key: "30-49|M", uniqueSubjects: 2, personDaysUnion: 202, eventsDeduped: 3, rareCases: 1 },
    // c/d 的观察期、事件与罕见病全在窗口外 → 该层全零（不是被悄悄漏掉）
    { key: "50-64|F", uniqueSubjects: 0, personDaysUnion: 0, eventsDeduped: 0, rareCases: 0 },
  ]);
});

test("同一主体跨层：逐层各计一次（Σ_k uniqueSubjects > 全量去重主体数）", () => {
  const input = {
    strataKeys: ["30-49|M", "50-64|F"],
    observations: [
      { subjectKey: "a", ageBand: "30-49", sex: "M", start: d(10), end: d(20) },
      { subjectKey: "a", ageBand: "50-64", sex: "F", start: d(30), end: d(40) },
    ],
    events: [],
    rareDiseases: [],
  };
  const ref = dedupIncidenceCount(input);
  const mod = runModule(input);
  assert.equal(mod.code, 0);
  assert.deepEqual(mod.strata, ref.strata);
  assert.equal(ref.strata[0].uniqueSubjects, 1);
  assert.equal(ref.strata[1].uniqueSubjects, 1);
});

test("Poisson 精确区间：与参考值一致（k = 0 / 1 / 10）", () => {
  const c0 = poissonExactCi(0);
  assert.equal(c0.low, 0);
  assert.ok(Math.abs(c0.high - 3.6889) < 1e-3, `期望约 3.6889，实际 ${c0.high}`);
  const c1 = poissonExactCi(1);
  assert.ok(Math.abs(c1.low - 0.0253) < 2e-3, `下界期望约 0.0253，实际 ${c1.low}`);
  assert.ok(Math.abs(c1.high - 5.5716) < 2e-3, `上界期望约 5.5716，实际 ${c1.high}`);
  const c10 = poissonExactCi(10);
  assert.ok(Math.abs(c10.low - 4.795) < 5e-2, `下界期望约 4.795，实际 ${c10.low}`);
  assert.ok(Math.abs(c10.high - 18.39) < 5e-2, `上界期望约 18.39，实际 ${c10.high}`);
});

test("发病率与区间：每人日为 0 时返回 null（率不可估）", () => {
  assert.equal(incidenceRatePer100k(5, 0), null);
  assert.equal(incidenceRateCiPer100k(5, 0), null);
  const rate = incidenceRatePer100k(10, 1000);
  assert.ok(rate !== null && Math.abs(rate - (10 / (1000 / 365.25)) * 100000) < 1e-6);
  const ci = incidenceRateCiPer100k(10, 1000);
  assert.ok(ci !== null && ci.low < rate && rate < ci.high);
});
