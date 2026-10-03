// SCRI 模块 vs TS 参考语义 —— 对拍（同一组夹具，逐字段比每个分层的剂次、风险期、对照期计数）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { BUILD_DIR, readManifest } from "./wasm-utils.mjs";
import { encodeScri, scriCount } from "../dist/index.js";

function runModule(input) {
  const enc = encodeScri(input);
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === "vaccine-scri");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
  assert.equal(instance.exports.abi_version.value, 1);

  const n = enc.dayDiff.length;
  const doses = enc.doseStratum.length;
  const k = enc.strataKeys.length;
  const inOff = 1024;
  const view = new DataView(memory.buffer);
  const [r1, r2] = input.windows.risk;
  const [c1, c2] = input.windows.control;
  [r1, r2, c1, c2, doses].forEach((v, i) => view.setInt32(inOff + i * 4, v, true));
  const bytesView = new Uint8Array(memory.buffer);
  bytesView.set(new Uint8Array(enc.dayDiff.buffer), inOff + 20);
  bytesView.set(enc.pairStratum, inOff + 20 + n * 4);
  bytesView.set(enc.doseStratum, inOff + 20 + n * 5);
  const outOff = (inOff + 20 + n * 5 + doses + 7) & ~7;

  const code = instance.exports.run(inOff, n, k, outOff);
  return {
    code,
    strata: enc.strataKeys.map((key, s) => ({
      key,
      riskEvents: view.getUint32(outOff + s * 12, true),
      controlEvents: view.getUint32(outOff + s * 12 + 4, true),
      doses: view.getUint32(outOff + s * 12 + 8, true),
    })),
  };
}

const WINDOWS = { risk: [1, 7], control: [22, 42] };

function fixture() {
  return {
    windows: WINDOWS,
    vaccineCodes: ["208"],
    eventCodes: ["I40.9"],
    registry: [
      { subjectKey: "a", vaccinationDate: "2024-01-01", vaccineCode: "208", ageBand: "12-39", sex: "M" },
      { subjectKey: "a", vaccinationDate: "2024-03-01", vaccineCode: "208", ageBand: "12-39", sex: "M" },
      { subjectKey: "b", vaccinationDate: "2024-01-10", vaccineCode: "208", ageBand: "40-64", sex: "F" },
      { subjectKey: "c", vaccinationDate: "2024-01-10", vaccineCode: "140", ageBand: "40-64", sex: "F" }, // 非目标疫苗
      { subjectKey: "d", vaccinationDate: "2024-02-01", vaccineCode: "208", ageBand: "12-39", sex: "M" },
    ],
    events: [
      { subjectKey: "a", eventDate: "2024-01-03", eventCode: "I40.9" }, // 第 1 剂 +2 天：风险期；第 2 剂 -58：不计
      { subjectKey: "a", eventDate: "2024-03-25", eventCode: "I40.9" }, // 第 2 剂 +24：对照期；第 1 剂 +84：不计
      { subjectKey: "b", eventDate: "2024-01-10", eventCode: "I40.9" }, // +0：两窗之外
      { subjectKey: "b", eventDate: "2024-02-15", eventCode: "I40.9" }, // +36：对照期
      { subjectKey: "c", eventDate: "2024-01-12", eventCode: "I40.9" }, // 非目标疫苗：不计
      { subjectKey: "d", eventDate: "2024-02-05", eventCode: "J10.1" }, // 非目标事件：不计
      { subjectKey: "x", eventDate: "2024-02-05", eventCode: "I40.9" }, // 未接种者：不计
    ],
  };
}

test("SCRI 模块与参考语义逐字段一致", () => {
  const input = fixture();
  const ref = scriCount(input);
  const mod = runModule(input);
  assert.equal(mod.code, 0);
  assert.deepEqual(
    mod.strata,
    ref.strata.map((s) => ({ key: s.key, riskEvents: s.riskEvents, controlEvents: s.controlEvents, doses: s.doses })),
  );
  assert.deepEqual(ref.strata, [
    { key: "12-39|M", doses: 3, riskEvents: 1, controlEvents: 1 },
    { key: "40-64|F", doses: 1, riskEvents: 0, controlEvents: 1 },
  ]);
});

test("风险期与对照期重叠：参考实现抛错，模块返回 5", () => {
  const input = { ...fixture(), windows: { risk: [1, 7], control: [5, 42] } };
  assert.throws(() => scriCount(input), /重叠/);
});

test("模块拒绝越界分层编号", () => {
  const input = fixture();
  const enc = encodeScri(input);
  assert.ok(enc.strataKeys.length === 2);
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === "vaccine-scri");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
  const view = new DataView(memory.buffer);
  [1, 7, 22, 42, 1].forEach((v, i) => view.setInt32(1024 + i * 4, v, true));
  view.setInt32(1044, 3, true); // dayDiff[0]
  new Uint8Array(memory.buffer)[1048] = 9; // 分层编号越界
  assert.equal(instance.exports.run(1024, 1, 2, 2048), 3);
});
