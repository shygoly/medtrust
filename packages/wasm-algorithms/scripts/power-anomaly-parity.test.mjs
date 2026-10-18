// 用电异常检测模块 vs TS 参考语义 —— 对拍（逐字段相等，含整数孤立森林）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { BUILD_DIR, readManifest } from "./wasm-utils.mjs";
import {
  POWER_ANOMALY_TYPES,
  decodePowerAnomalyOutput,
  encodePowerAnomaly,
  powerAnomalyFixed,
  powerAnomalySeed,
} from "../dist/index.js";

function moduleBytes() {
  const entry = readManifest().modules.find((m) => m.analysisType === "power-anomaly");
  assert.ok(entry, "清单里必须有 power-anomaly 模块");
  return readFileSync(join(BUILD_DIR, entry.file));
}

function runModule(inputs, peer) {
  const enc = encodePowerAnomaly(inputs, peer);
  const memory = new WebAssembly.Memory({
    initial: Math.ceil(enc.requiredBytes / 65536),
    maximum: 1024,
  });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(moduleBytes()), {
    env: { memory },
  });
  assert.equal(instance.exports.abi_version.value, 1);
  new Uint8Array(memory.buffer).set(enc.bytes, 0);
  const code = instance.exports.run(0, enc.m, 24, enc.outOff);
  return { code, out: new Uint8Array(memory.buffer, enc.outOff, enc.outBytes).slice(), m: enc.m };
}

function compare(inputs, peer, label) {
  const wasm = runModule(inputs, peer);
  assert.equal(wasm.code, 0, `${label}：模块应返回 0`);
  const got = decodePowerAnomalyOutput(wasm.out, wasm.m);
  assert.deepEqual(got, powerAnomalyFixed(inputs, peer), `${label}：逐字段必须相等`);
  return got;
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
}

function normalLoad(days, base, seed) {
  const rnd = lcg(seed);
  return Array.from({ length: days * 24 }, (_, i) => {
    const h = i % 24;
    return base + (h >= 8 && h <= 20 ? Math.trunc(base / 3) : 0) + (rnd() % Math.max(1, Math.trunc(base / 20)));
  });
}

const typeName = (r) => POWER_ANOMALY_TYPES[r.type];

test("power-anomaly：正常 / 零功率 / 负功率 / 突变 逐字段一致", () => {
  const normal = normalLoad(45, 3_000, 1);
  const zeros = normalLoad(45, 3_000, 2).map((v, i) => (i >= 200 && i < 600 ? 0 : v));
  const negative = normalLoad(45, 3_000, 3).map((v, i) => (i % 97 === 0 ? -1_500 : v));
  const spikes = normalLoad(45, 3_000, 4).map((v, i) => (i % 53 === 0 ? v + 60_000 : v));
  const inputs = [normal, zeros, negative, spikes].map((values, i) => ({
    values,
    seed: powerAnomalySeed(`meter-${i}`),
  }));
  const got = compare(inputs, -1, "四类");
  assert.ok(got[0].scorePermille < got[1].scorePermille, "零功率段应比正常用户更异常");
  assert.equal(typeName(got[1]), "zero_power");
  // 一个大负值同时触发「负功率」与前后两次「突变」，突变计数更高即主导
  assert.ok(["negative_power", "power_spike"].includes(typeName(got[2])));
  assert.ok(got[2].scorePermille > got[0].scorePermille);
});

test("power-anomaly：长序列（> 60 天，步长加倍、12 棵树）逐字段一致", () => {
  const long = normalLoad(90, 10_000, 9).map((v, i) => (i % 24 === 3 ? 0 : v));
  const got = compare([{ values: long, seed: 12345 }], -1, "长序列");
  assert.equal(typeName(got[0]), "periodic");
});

test("power-anomaly：冷启动（< 30 天）有无同类基准两条路径", () => {
  const short = normalLoad(10, 200, 5).map((v, i) => (i < 100 ? 0 : v));
  const withPeer = compare([{ values: short, seed: 1 }], 3_000, "冷启动 + 基准");
  assert.equal(withPeer[0].confidencePermille, 400);
  const noPeer = compare([{ values: short, seed: 1 }], -1, "冷启动无基准");
  assert.equal(typeName(noPeer[0]), "insufficient_data");
  assert.deepEqual(noPeer[0].evidence, [0, short.length]);
});

test("power-anomaly：种子不同 → 结果仍逐字段一致（各自确定）", () => {
  const series = normalLoad(40, 5_000, 11).map((v, i) => (i % 31 === 0 ? 0 : v));
  for (const seed of [0, 1, 0xffffffff, 2_654_435_761]) {
    compare([{ values: series, seed }], -1, `seed=${seed}`);
  }
});

test("power-anomaly：非法输入返回错误码", () => {
  const memory = new WebAssembly.Memory({ initial: 2, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(moduleBytes()), {
    env: { memory },
  });
  const enc = encodePowerAnomaly([{ values: new Array(800).fill(1), seed: 1 }], -1);
  new Uint8Array(memory.buffer).set(enc.bytes, 0);
  assert.equal(instance.exports.run(0, 0, 24, enc.outOff), 1);
  assert.equal(instance.exports.run(0, 1, 12, enc.outOff), 2);
  assert.equal(instance.exports.run(0, 1, 24, 64), 6);
  new DataView(memory.buffer).setInt32(32 + 4 + 8, 5_000_001, true);
  assert.equal(instance.exports.run(0, 1, 24, enc.outOff), 4);
});
