// external-control 模块 vs TS 参考语义 —— 对拍（同一组夹具，逐字段比每层六格）。
//
// 夹具刻意覆盖：caliper 边界（|Δ|=10 命中、|Δ|=11 不命中）、ratioK 上限与对照消耗
//（被取走的对照不会给后来者复用）、跨层不串、无可用对照 → 未匹配、
// 排序契约破坏 → 拒绝（返回 6）、越界分层（3）、非法参数（5）、不可估层语义。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { BUILD_DIR, readManifest } from "./wasm-utils.mjs";
import { encodeExternalControl, externalControlCount, estimateExternalControl } from "../dist/index.js";

const ANALYSIS_TYPE = "external-control";
const CELL_NAMES = ["mExpPos", "mExpNeg", "ctlPos", "ctlNeg", "matched", "unmatched"];

function instantiate() {
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === ANALYSIS_TYPE);
  assert.ok(entry, "清单里必须有 external-control 模块（先跑 node scripts/build.mjs）");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
  assert.equal(instance.exports.abi_version.value, 1);
  return { instance, memory };
}

function runModule(input) {
  const enc = encodeExternalControl(input);
  const { instance, memory } = instantiate();
  const nT = enc.nTrial, nC = enc.nCtrl;
  const S = enc.strataKeys.length;
  const inOff = 1024;
  const bytes = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);
  view.setInt32(inOff, nT, true);
  view.setInt32(inOff + 4, nC, true);
  view.setInt32(inOff + 8, enc.caliperDays, true);
  view.setInt32(inOff + 12, enc.ratioK, true);
  bytes.set(new Uint8Array(enc.trialDay.buffer), inOff + 16);
  bytes.set(enc.trialOutcome, inOff + 16 + nT * 4);
  bytes.set(enc.trialStratum, inOff + 16 + nT * 5);
  bytes.set(new Uint8Array(enc.ctrlDay.buffer), inOff + 16 + nT * 6);
  bytes.set(enc.ctrlOutcome, inOff + 16 + nT * 6 + nC * 4);
  bytes.set(enc.ctrlStratum, inOff + 16 + nT * 6 + nC * 5);
  const outOff = (inOff + 16 + nT * 6 + nC * 6 + 7) & ~7;
  const code = instance.exports.run(inOff, nT + nC, S, outOff);
  const strata = enc.strataKeys.map((key, s) => {
    const row = { key };
    CELL_NAMES.forEach((name, c) => { row[name] = view.getUint32(outOff + s * 24 + c * 4, true); });
    return row;
  });
  return { code, strata };
}

const D = (s) => s; // 可读性
function fixture() {
  return {
    strataKeys: ["30-49|M", "50-64|F"],
    caliperDays: 10,
    ratioK: 2,
    trialRows: [
      { subjectKey: "t1", ageBand: "30-49", sex: "M", indexDate: D("2024-01-10"), outcome: "pos" },
      { subjectKey: "t2", ageBand: "30-49", sex: "M", indexDate: D("2024-01-15"), outcome: "neg" },
      { subjectKey: "t3", ageBand: "50-64", sex: "F", indexDate: D("2024-02-01"), outcome: "pos" },
      { subjectKey: "t4", ageBand: "50-64", sex: "F", indexDate: D("2024-06-01"), outcome: "neg" }, // 无可用对照
    ],
    controlRows: [
      { subjectKey: "c1", ageBand: "30-49", sex: "M", indexDate: D("2024-01-12"), outcome: "pos" },
      { subjectKey: "c3", ageBand: "30-49", sex: "M", indexDate: D("2024-01-17"), outcome: "neg" },
      { subjectKey: "c2", ageBand: "30-49", sex: "M", indexDate: D("2024-01-20"), outcome: "neg" },
      { subjectKey: "c4", ageBand: "50-64", sex: "F", indexDate: D("2024-01-25"), outcome: "pos" },
      { subjectKey: "c5", ageBand: "50-64", sex: "F", indexDate: D("2024-02-10"), outcome: "neg" },
      { subjectKey: "c6", ageBand: "50-64", sex: "F", indexDate: D("2024-02-28"), outcome: "pos" },
    ],
  };
}

test("模块与参考语义逐字段一致（含 caliper 边界 / 消耗 / 跨层 / 未匹配）", () => {
  const input = fixture();
  const ref = externalControlCount(input);
  const mod = runModule(input);
  assert.equal(mod.code, 0);
  assert.deepEqual(mod.strata, ref.strata);
  assert.deepEqual(ref.strata, [
    { key: "30-49|M", mExpPos: 1, mExpNeg: 1, ctlPos: 1, ctlNeg: 2, matched: 2, unmatched: 0 },
    { key: "50-64|F", mExpPos: 1, mExpNeg: 0, ctlPos: 1, ctlNeg: 1, matched: 1, unmatched: 1 },
  ]);
});

test("caliper 边界：|Δ| = caliper 命中，|Δ| = caliper + 1 不命中", () => {
  const base = { strataKeys: ["30-49|M"], caliperDays: 10, ratioK: 1,
    trialRows: [{ subjectKey: "t", ageBand: "30-49", sex: "M", indexDate: "2024-03-10", outcome: "pos" }] };
  const hit = externalControlCount({ ...base, controlRows: [{ subjectKey: "c", ageBand: "30-49", sex: "M", indexDate: "2024-03-20", outcome: "neg" }] });
  assert.equal(hit.strata[0].matched, 1);
  const miss = externalControlCount({ ...base, controlRows: [{ subjectKey: "c", ageBand: "30-49", sex: "M", indexDate: "2024-03-21", outcome: "neg" }] });
  assert.equal(miss.strata[0].matched, 0);
  assert.equal(miss.strata[0].unmatched, 1);
});

test("ratioK 上限与对照消耗：3 个可用对照只取 2 个，且不复用", () => {
  const r = externalControlCount({
    strataKeys: ["30-49|M"], caliperDays: 30, ratioK: 2,
    trialRows: [
      { subjectKey: "t1", ageBand: "30-49", sex: "M", indexDate: "2024-01-10", outcome: "pos" },
      { subjectKey: "t2", ageBand: "30-49", sex: "M", indexDate: "2024-01-11", outcome: "neg" },
    ],
    controlRows: [
      { subjectKey: "c1", ageBand: "30-49", sex: "M", indexDate: "2024-01-10", outcome: "pos" },
      { subjectKey: "c2", ageBand: "30-49", sex: "M", indexDate: "2024-01-10", outcome: "neg" },
      { subjectKey: "c3", ageBand: "30-49", sex: "M", indexDate: "2024-01-10", outcome: "neg" },
    ],
  });
  const s = r.strata[0];
  assert.equal(s.matched, 2);           // 两位受试者都匹配
  assert.equal(s.ctlPos + s.ctlNeg, 3); // 恰好用掉 3 个对照（2 + 1），无复用、无超额
});

test("模块拒绝排序契约破坏（返回 6，宁可拒绝也不悄悄算错）", () => {
  const input = fixture();
  const enc = encodeExternalControl(input);
  const { instance, memory } = instantiate();
  const nT = enc.nTrial, nC = enc.nCtrl;
  const inOff = 1024;
  const bytes = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);
  view.setInt32(inOff, nT, true); view.setInt32(inOff + 4, nC, true);
  view.setInt32(inOff + 8, enc.caliperDays, true); view.setInt32(inOff + 12, enc.ratioK, true);
  bytes.set(new Uint8Array(enc.trialDay.buffer), inOff + 16);
  bytes.set(enc.trialOutcome, inOff + 16 + nT * 4);
  bytes.set(enc.trialStratum, inOff + 16 + nT * 5);
  bytes.set(new Uint8Array(enc.ctrlDay.buffer), inOff + 16 + nT * 6);
  bytes.set(enc.ctrlOutcome, inOff + 16 + nT * 6 + nC * 4);
  bytes.set(enc.ctrlStratum, inOff + 16 + nT * 6 + nC * 5);
  // 打乱对照首两行的日序（同层内倒序）→ 排序契约破坏
  const a = inOff + 16 + nT * 6, b = a + 4;
  const tmp = view.getInt32(a, true);
  view.setInt32(a, view.getInt32(b, true), true);
  view.setInt32(b, tmp, true);
  assert.equal(instance.exports.run(inOff, nT + nC, 2, 8192), 6);
});

test("模块拒绝越界分层（3）与非法参数（5）", () => {
  const input = fixture();
  const enc = encodeExternalControl(input);
  const { instance, memory } = instantiate();
  const nT = enc.nTrial, nC = enc.nCtrl;
  const inOff = 1024;
  const bytes = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);
  view.setInt32(inOff, nT, true); view.setInt32(inOff + 4, nC, true);
  view.setInt32(inOff + 8, enc.caliperDays, true); view.setInt32(inOff + 12, enc.ratioK, true);
  bytes.set(new Uint8Array(enc.trialDay.buffer), inOff + 16);
  bytes.set(enc.trialOutcome, inOff + 16 + nT * 4);
  bytes.set(enc.trialStratum, inOff + 16 + nT * 5);
  bytes.set(new Uint8Array(enc.ctrlDay.buffer), inOff + 16 + nT * 6);
  bytes.set(enc.ctrlOutcome, inOff + 16 + nT * 6 + nC * 4);
  bytes.set(enc.ctrlStratum, inOff + 16 + nT * 6 + nC * 5);
  // 试验组「最后一行」分层越界（保持排序契约成立，才能测到 3 而不是 6）
  bytes[inOff + 16 + nT * 5 + (nT - 1)] = 9;
  assert.equal(instance.exports.run(inOff, nT + nC, 2, 8192), 3);
  // ratioK = 0 → 参数非法
  view.setInt32(inOff + 12, 0, true);
  bytes[inOff + 16 + nT * 5 + (nT - 1)] = 1; // 还原（原值：50-64|F = 1）
  assert.equal(instance.exports.run(inOff, nT + nC, 2, 8192), 5);
});

test("不可估语义：matched=0 或任一侧零事件 → null（不得显示 0 / ∞）", () => {
  assert.equal(estimateExternalControl({ key: "x", mExpPos: 0, mExpNeg: 0, ctlPos: 3, ctlNeg: 3, matched: 0, unmatched: 5 }), null);
  assert.equal(estimateExternalControl({ key: "x", mExpPos: 0, mExpNeg: 10, ctlPos: 4, ctlNeg: 6, matched: 10, unmatched: 0 }), null);
  assert.equal(estimateExternalControl({ key: "x", mExpPos: 6, mExpNeg: 10, ctlPos: 0, ctlNeg: 12, matched: 16, unmatched: 0 }), null);
});

test("日期：完整 ISO 时间与 YYYY-MM-DD 等价；解析不了即拒（不写成第 0 天）", () => {
  const iso = fixture();
  for (const row of [...iso.trialRows, ...iso.controlRows]) row.indexDate = `${row.indexDate}T00:00:00Z`;
  assert.deepEqual(runModule(iso).strata, runModule(fixture()).strata);

  const bad = fixture();
  bad.controlRows[0].indexDate = "2024/13/45";
  assert.throws(() => encodeExternalControl(bad), /日期不可解析/);
});

test("RR/RD 估计：方向、区间与零格校正", () => {
  // 匹配试验组 10 人 2 阳性；对照 20 人 10 阳性 → RR = 0.2/0.5 = 0.4
  const est = estimateExternalControl({ key: "x", mExpPos: 2, mExpNeg: 8, ctlPos: 10, ctlNeg: 10, matched: 10, unmatched: 0 });
  assert.ok(est);
  assert.ok(Math.abs(est.rr - 0.4) < 1e-12);
  assert.ok(est.rrCi.low < est.rr && est.rr < est.rrCi.high);
  assert.ok(Math.abs(est.rd - (-0.3)) < 1e-12);
  // 对照无事件但试验组有 → 不可估（上一测试覆盖）；对照「无阴性」（d=0）→ 校正路径
  const cor = estimateExternalControl({ key: "x", mExpPos: 3, mExpNeg: 7, ctlPos: 12, ctlNeg: 0, matched: 10, unmatched: 0 });
  assert.ok(cor);
  assert.equal(cor.corrected, true);
});
