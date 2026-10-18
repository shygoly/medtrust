// 需求响应潜力模块 vs TS 参考语义 —— 对拍（逐字段相等）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { BUILD_DIR, readManifest } from "./wasm-utils.mjs";
import {
  decodePowerDrPotentialOutput,
  encodePowerDrPotential,
  powerDrPotentialFixed,
} from "../dist/index.js";

const INDUSTRIAL = {
  curtailPermille: 250,
  shiftPermille: 200,
  offPeakPermille: 300,
  comfortPermille: 1000,
  ratedCapUnits: -1,
  curtailDeviceCapUnits: -1,
  shiftDeviceCapUnits: -1,
};

function instantiate() {
  const entry = readManifest().modules.find((m) => m.analysisType === "power-dr-potential");
  assert.ok(entry, "清单里必须有 power-dr-potential 模块");
  return readFileSync(join(BUILD_DIR, entry.file));
}

function runModule(series, params) {
  const bytes = instantiate();
  const enc = encodePowerDrPotential(series, params);
  const memory = new WebAssembly.Memory({
    initial: Math.ceil(enc.requiredBytes / 65536),
    maximum: 1024,
  });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
  assert.equal(instance.exports.abi_version.value, 1);
  new Uint8Array(memory.buffer).set(enc.bytes, 0);
  const code = instance.exports.run(0, enc.m, 24, enc.outOff);
  return { code, out: new Uint8Array(memory.buffer, enc.outOff, enc.outBytes).slice(), m: enc.m };
}

function compare(series, params, label) {
  const wasm = runModule(series, params);
  assert.equal(wasm.code, 0, `${label}：模块应返回 0`);
  const got = decodePowerDrPotentialOutput(wasm.out, wasm.m);
  assert.deepEqual(got, powerDrPotentialFixed(series, params), `${label}：逐字段必须相等`);
  return got;
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
}

function dailyShape(days, base, jitter) {
  const rnd = lcg(base);
  return Array.from({ length: days * 24 }, (_, i) => {
    const h = i % 24;
    const shape = h >= 9 && h <= 17 ? 1.3 : h <= 5 ? 0.6 : 1;
    return Math.round(base * shape) + (rnd() % jitter);
  });
}

test("power-dr-potential：工业负荷逐字段一致且峰时有可削减容量", () => {
  const got = compare([dailyShape(14, 80_000, 5_000)], INDUSTRIAL, "工业");
  assert.equal(got[0].fullLoad, false);
  assert.ok(got[0].peakCap[12] > got[0].peakCap[3], "峰时削减容量应大于谷时");
  assert.ok(got[0].valleyCap[3] > got[0].valleyCap[12], "谷时转移容量应大于峰时");
});

test("power-dr-potential：多表 + 设备/额定/舒适度截断逐字段一致", () => {
  const series = [dailyShape(7, 20_000, 3_000), dailyShape(30, 1_000_000, 50_000), dailyShape(8, 500, 7)];
  compare(
    series,
    {
      ...INDUSTRIAL,
      comfortPermille: 625,
      ratedCapUnits: 150_000,
      curtailDeviceCapUnits: 9_000,
      shiftDeviceCapUnits: 120_000,
    },
    "截断",
  );
});

test("power-dr-potential：满负荷时削减容量全 0", () => {
  const flat = new Array(7 * 24).fill(100_000);
  const got = compare([flat], INDUSTRIAL, "满负荷");
  assert.equal(got[0].fullLoad, true);
  assert.ok(got[0].peakCap.every((v) => v === 0));
});

test("power-dr-potential：非法输入返回错误码", () => {
  const bytes = instantiate();
  const memory = new WebAssembly.Memory({ initial: 2, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
  const view = new DataView(memory.buffer);
  const write = (header, series) => {
    const enc = encodePowerDrPotential(series, header);
    new Uint8Array(memory.buffer).fill(0);
    new Uint8Array(memory.buffer).set(enc.bytes, 0);
    return enc;
  };
  let enc = write(INDUSTRIAL, [new Array(7 * 24).fill(1)]);
  assert.equal(instance.exports.run(0, 1, 23, enc.outOff), 2);
  assert.equal(instance.exports.run(0, 1, 24, 16), 6);
  view.setInt32(0, 1001, true);
  assert.equal(instance.exports.run(0, 1, 24, enc.outOff), 7);
  enc = write(INDUSTRIAL, [new Array(7 * 24).fill(1)]);
  view.setUint32(36, 100, true); // offsets[1] = 100 < 168
  assert.equal(instance.exports.run(0, 1, 24, enc.outOff), 3);
  enc = write(INDUSTRIAL, [new Array(7 * 24).fill(1)]);
  view.setInt32(40, -1, true); // 首个样本为负
  assert.equal(instance.exports.run(0, 1, 24, enc.outOff), 4);
});
