// 电力时序特征模块 vs TS 参考语义 —— 对拍（逐字段相等，不是容差）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { BUILD_DIR, readManifest } from "./wasm-utils.mjs";
import {
  decodePowerFeaturesOutput,
  encodePowerFeatures,
  powerFeaturesFixed,
} from "../dist/index.js";

/** 与沙箱同一调用形状：输入写在偏移 0，只给 env.memory。 */
function runModule(series, period) {
  const entry = readManifest().modules.find((m) => m.analysisType === "power-features");
  assert.ok(entry, "清单里必须有 power-features 模块");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const enc = encodePowerFeatures(series, period);
  const pages = Math.ceil(enc.requiredBytes / 65536);
  const memory = new WebAssembly.Memory({ initial: pages, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
  assert.equal(instance.exports.abi_version.value, 1);
  new Uint8Array(memory.buffer).set(enc.bytes, 0);
  const code = instance.exports.run(0, enc.m, period, enc.outOff);
  const out = new Uint8Array(memory.buffer, enc.outOff, enc.outBytes).slice();
  return { code, out, m: enc.m };
}

function compare(series, period, label) {
  const wasm = runModule(series, period);
  assert.equal(wasm.code, 0, `${label}：模块应返回 0`);
  const got = decodePowerFeaturesOutput(wasm.out, wasm.m, period);
  const ref = powerFeaturesFixed(series, period);
  assert.deepEqual(got, ref, `${label}：逐字段必须相等`);
  return got;
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

test("power-features：日周期负荷逐字段一致", () => {
  const day = Array.from({ length: 24 * 14 }, (_, i) => 40_000 + ((i % 24) - 12) * 1_500 + i * 3);
  const got = compare([day], 24, "日周期");
  assert.equal(got[0].n, 24 * 14);
  assert.ok(got[0].seasonality > 0);
  assert.ok(got[0].trendMilli > 0);
});

test("power-features：多表、含负值与极值逐字段一致", () => {
  const rnd = lcg(7);
  const series = [
    Array.from({ length: 100 }, () => (rnd() % 2_000_000) - 1_000_000),
    Array.from({ length: 3 }, (_, i) => [5_000_000, -5_000_000, 0][i]),
    Array.from({ length: 777 }, () => rnd() % 5_000_001),
  ];
  compare(series, 0, "多表 period=0");
  compare(series.filter((s) => s.length >= 24), 24, "多表 period=24");
  compare(series.filter((s) => s.length >= 168), 168, "周周期");
});

test("power-features：常数序列 std=0、trend=0", () => {
  const got = compare([new Array(50).fill(1234)], 7, "常数");
  assert.equal(got[0].std, 0);
  assert.equal(got[0].trendMilli, 0);
  assert.equal(got[0].seasonality, 0);
});

test("power-features：非法输入返回错误码（不产出部分结果）", () => {
  const entry = readManifest().modules.find((m) => m.analysisType === "power-features");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
  const view = new DataView(memory.buffer);
  // offsets = [0, 2] → 单表 2 个样本 < 3
  view.setUint32(0, 0, true);
  view.setUint32(4, 2, true);
  assert.equal(instance.exports.run(0, 1, 0, 64), 3);
  assert.equal(instance.exports.run(0, 0, 0, 64), 1);
  assert.equal(instance.exports.run(0, 1, 1, 64), 2);
  // 越界数值
  view.setUint32(4, 3, true);
  for (let i = 0; i < 3; i++) view.setInt32(8 + i * 4, i === 1 ? 5_000_001 : 0, true);
  assert.equal(instance.exports.run(0, 1, 0, 64), 4);
  // outOff 与输入重叠
  view.setInt32(12, 0, true);
  assert.equal(instance.exports.run(0, 1, 0, 8), 6);
});
