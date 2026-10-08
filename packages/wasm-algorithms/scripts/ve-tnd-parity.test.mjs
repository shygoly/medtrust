// ve-tnd 模块 vs TS 参考语义 —— 对拍（同一组夹具，逐字段比每个分层的六个格）。
//
// 夹具刻意覆盖：免疫建立期边界（gap = 13 部分免疫 / gap = 14 已接种）、同日检测（gap = 0）、
// 检测发生在首剂之前（无接种）、同 (主体, 检测日) 重复检测去重、白名单外疫苗/病原、
// 多剂次取「检测日前最后一剂」、多分层。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { BUILD_DIR, readManifest } from "./wasm-utils.mjs";
import { estimateVe, encodeVeTnd, NO_DOSE, veTndCount } from "../dist/index.js";

const ANALYSIS_TYPE = "ve-tnd";
const CELL_NAMES = ["vaccPos", "vaccNeg", "unvaccPos", "unvaccNeg", "partialPos", "partialNeg"];

function instantiate() {
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === ANALYSIS_TYPE);
  assert.ok(entry, "清单里必须有 ve-tnd 模块（先跑 node scripts/build.mjs）");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
  assert.equal(instance.exports.abi_version.value, 1);
  return { instance, memory };
}

/** 按 ABI 写入数字列并调用模块，读回 k × 6 计数。 */
function runModule(input, patch = {}) {
  const enc = encodeVeTnd(input);
  const { instance, memory } = instantiate();
  const n = enc.gapDays.length;
  const k = enc.strataKeys.length;
  const inOff = 1024;
  const bytes = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);

  view.setInt32(inOff, patch.immuneDays ?? enc.immuneDays, true);
  const gapOff = inOff + 4;
  const resultOff = gapOff + n * 4;
  const stratumOff = resultOff + n;
  bytes.set(new Uint8Array(enc.gapDays.buffer), gapOff);
  bytes.set(enc.result, resultOff);
  bytes.set(enc.testStratum, stratumOff);
  for (const [index, value] of Object.entries(patch.results ?? {}))
    bytes[resultOff + Number(index)] = value;
  const outOff = (stratumOff + n + 7) & ~7;

  const code = instance.exports.run(inOff, n, k, outOff);
  const strata = enc.strataKeys.map((key, s) => {
    const row = { key };
    CELL_NAMES.forEach((name, c) => {
      row[name] = view.getUint32(outOff + s * 24 + c * 4, true);
    });
    return row;
  });
  return { code, strata, strataKeys: enc.strataKeys };
}

function fixture() {
  return {
    immuneDays: 14,
    vaccineCodes: ["208"],
    pathogenCodes: ["SARS2"],
    doses: [
      { subjectKey: "a", vaccinationDate: "2024-01-01", vaccineCode: "208" },
      { subjectKey: "b", vaccinationDate: "2024-01-01", vaccineCode: "208" },
      { subjectKey: "b", vaccinationDate: "2024-02-01", vaccineCode: "208" },
      { subjectKey: "c", vaccinationDate: "2024-01-01", vaccineCode: "140" }, // 白名单外疫苗
      { subjectKey: "d", vaccinationDate: "2024-03-01", vaccineCode: "208" }, // 剂量在检测之后
    ],
    tests: [
      // gap = 14：免疫建立期边界（已接种）
      { subjectKey: "a", testDate: "2024-01-15", pathogenCode: "SARS2", result: "pos", ageBand: "30-49", sex: "M" },
      // gap = 13：部分免疫
      { subjectKey: "a", testDate: "2024-01-14", pathogenCode: "SARS2", result: "neg", ageBand: "30-49", sex: "M" },
      // gap = 0：同日接种并检测 → 部分免疫
      { subjectKey: "a", testDate: "2024-01-01", pathogenCode: "SARS2", result: "neg", ageBand: "30-49", sex: "M" },
      // 同 (主体, 检测日) 重复检测：只取首条（此处结果不同，用于证明去重不是「随便留一条」）
      { subjectKey: "a", testDate: "2024-01-15", pathogenCode: "SARS2", result: "neg", ageBand: "30-49", sex: "M" },
      // 多剂次：取检测日前最后一剂（2024-02-01，gap = 19）
      { subjectKey: "b", testDate: "2024-02-20", pathogenCode: "SARS2", result: "pos", ageBand: "50-64", sex: "F" },
      // 检测发生在首剂之前 → 未接种
      { subjectKey: "d", testDate: "2024-02-01", pathogenCode: "SARS2", result: "pos", ageBand: "30-49", sex: "M" },
      // 无任何目标疫苗接种 → 未接种
      { subjectKey: "e", testDate: "2024-01-10", pathogenCode: "SARS2", result: "neg", ageBand: "50-64", sex: "F" },
      // 只有白名单外疫苗 → 未接种（该疫苗与本分析无关）
      { subjectKey: "c", testDate: "2024-01-10", pathogenCode: "SARS2", result: "pos", ageBand: "30-49", sex: "M" },
      // 白名单外病原 → 不纳入
      { subjectKey: "f", testDate: "2024-01-10", pathogenCode: "FLU", result: "pos", ageBand: "30-49", sex: "M" },
    ],
  };
}

test("ve-tnd 模块与参考语义逐字段一致", () => {
  const input = fixture();
  const ref = veTndCount(input);
  const mod = runModule(input);
  assert.equal(mod.code, 0);
  assert.deepEqual(mod.strata, ref.strata);
  assert.deepEqual(ref.strata, [
    { key: "30-49|M", vaccPos: 1, vaccNeg: 0, unvaccPos: 2, unvaccNeg: 0, partialPos: 0, partialNeg: 2 },
    { key: "50-64|F", vaccPos: 1, vaccNeg: 0, unvaccPos: 0, unvaccNeg: 1, partialPos: 0, partialNeg: 0 },
  ]);
});

test("免疫建立期边界：gap = 13 部分免疫，gap = 14 已接种", () => {
  const input = fixture();
  const enc = encodeVeTnd(input);
  assert.equal(enc.gapDays[0], 14); // a @ 2024-01-15
  assert.equal(enc.gapDays[1], 13); // a @ 2024-01-14
  assert.equal(enc.gapDays[2], 0); // a @ 2024-01-01
  const s = veTndCount(input).strata[0];
  assert.equal(s.vaccPos, 1); // gap 14 归已接种
  assert.equal(s.partialNeg, 2); // gap 13 与 gap 0 归部分免疫
});

test("检测发生在首剂之前 → 未接种（gap 为无接种哨兵）", () => {
  const enc = encodeVeTnd(fixture());
  assert.equal(enc.gapDays[4], NO_DOSE); // d @ 2024-02-01：其目标疫苗首剂在 2024-03-01
  assert.equal(enc.gapDays[6], NO_DOSE); // c：只有白名单外疫苗 → 视为无接种
  const s = veTndCount(fixture()).strata[0];
  assert.equal(s.unvaccPos, 2); // d（首剂在后）与 c（白名单外疫苗）
});

test("模块拒绝越界分层编号（返回 3）", () => {
  const input = fixture();
  const enc = encodeVeTnd(input);
  const { instance, memory } = instantiate();
  const n = enc.gapDays.length;
  const inOff = 1024;
  const view = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  view.setInt32(inOff, 14, true);
  const gapOff = inOff + 4;
  const resultOff = gapOff + n * 4;
  const stratumOff = resultOff + n;
  bytes.set(new Uint8Array(enc.gapDays.buffer), gapOff);
  bytes.set(enc.result, resultOff);
  bytes.set(enc.testStratum, stratumOff);
  bytes[stratumOff] = 9; // 越界
  assert.equal(instance.exports.run(inOff, n, 2, 4096), 3);
});

test("模块拒绝非法参数（result 非 0/1、免疫建立期 < 1）", () => {
  const input = fixture();
  const bad = runModule(input, { results: { 0: 7 } });
  assert.equal(bad.code, 5);
  const badImmune = runModule(input, { immuneDays: 0 });
  assert.equal(badImmune.code, 5);
});

test("VE 估计：不可估层返回 null（不得呈现为 0 或 100%）", () => {
  assert.equal(
    estimateVe({ key: "x", vaccPos: 0, vaccNeg: 10, unvaccPos: 5, unvaccNeg: 10, partialPos: 0, partialNeg: 0 }),
    null,
  );
});

test("VE 估计：非零格 OR/VE 与区间方向正确", () => {
  const est = estimateVe({
    key: "x",
    vaccPos: 10,
    vaccNeg: 90,
    unvaccPos: 40,
    unvaccNeg: 60,
    partialPos: 0,
    partialNeg: 0,
  });
  assert.ok(est);
  assert.equal(est.corrected, false);
  assert.ok(Math.abs(est.oddsRatio - 1 / 6) < 1e-12);
  assert.ok(Math.abs(est.ve - (1 - 1 / 6)) < 1e-12);
  assert.ok(est.ciLow < est.ve && est.ve < est.ciHigh);
  assert.ok(est.ciLow < est.ciHigh);
});

test("VE 估计：零格走 Haldane-Anscombe 并标注已校正", () => {
  const est = estimateVe({
    key: "x",
    vaccPos: 5,
    vaccNeg: 0,
    unvaccPos: 10,
    unvaccNeg: 20,
    partialPos: 0,
    partialNeg: 0,
  });
  assert.ok(est);
  assert.equal(est.corrected, true);
  // (5.5 × 20.5) / (0.5 × 10.5) = 21.476…
  assert.ok(Math.abs(est.oddsRatio - (5.5 * 20.5) / (0.5 * 10.5)) < 1e-12);
});
