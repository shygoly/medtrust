// 分类计数模块 vs TS 参考语义  **对拍**（不是各测各的）。
//
// 为什么必须对拍：旧链 L0/L1 三型的口径是「按分类字段计数出现次数」（不是去重主体），
// 这一口径现在有两份实现（Wasm 模块与节点里的 TS 调用路径），任一份改了而另一份没改，
// 迁移前后的数就说不清。夹具同一组，逐字段比 cohortSize 与每个分类的 count。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { BUILD_DIR, readManifest } from "./wasm-utils.mjs";
import { categoricalCount, encodeCategoricalCount } from "../dist/index.js";

/** 在宿主内存上跑模块（与沙箱里的调用形状一致：只给 env.memory）。 */
function runModule(encoded) {
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === "categorical-count");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { memory },
  });
  assert.equal(instance.exports.abi_version.value, 1);
  const { n, k, categories } = encoded;
  const inOff = 1024;
  const outOff = (inOff + n + 7) & ~7;
  new Uint8Array(memory.buffer).set(categories, inOff);
  const code = instance.exports.run(inOff, n, k, outOff);
  assert.equal(code, 0);
  const u32 = new Uint32Array(memory.buffer);
  const base = outOff / 4;
  return {
    cohortSize: u32[base],
    counts: Array.from({ length: k }, (_, i) => u32[base + 1 + i]),
  };
}

test("分类计数：与 TS 参考逐字段一致（含重复行与多值行）", () => {
  const rows = [
    { category: "60-69" },
    { category: "60-69" }, // 重复：计 2（不是去重）
    { category: "70-79" },
    { category: "60-69" },
    { category: "40-49" },
  ];
  const encoded = encodeCategoricalCount({ rows });
  const wasm = runModule(encoded);
  const ref = categoricalCount({
    categoryKeys: encoded.categoryKeys,
    categories: [...encoded.categories],
  });
  assert.equal(wasm.cohortSize, ref.cohortSize);
  assert.equal(ref.cohortSize, rows.length);
  assert.deepEqual(
    wasm.counts,
    ref.buckets.map((b) => b.count),
  );
  assert.deepEqual(encoded.categoryKeys, ["40-49", "60-69", "70-79"]);
  assert.deepEqual(ref.buckets.map((b) => b.key), encoded.categoryKeys);
});

test("全同分类：单桶计数等于行数", () => {
  const rows = Array.from({ length: 7 }, () => ({ category: "Nervous" }));
  const encoded = encodeCategoricalCount({ rows });
  const wasm = runModule(encoded);
  assert.equal(wasm.cohortSize, 7);
  assert.deepEqual(wasm.counts, [7]);
});

test("空输入：cohortSize 0、各桶 0（调用方给的键列表仍被尊重）", () => {
  const encoded = encodeCategoricalCount({ rows: [], categoryKeys: ["a", "b"] });
  const wasm = runModule(encoded);
  assert.equal(wasm.cohortSize, 0);
  assert.deepEqual(wasm.counts, [0, 0]);
});

test("分类键不在列表里 / 列表为空 / 超过 64 个：一律拒（不静默归到 0 号桶）", () => {
  assert.throws(() => encodeCategoricalCount({ rows: [{ category: "x" }], categoryKeys: ["a"] }), /不在给定列表/);
  assert.throws(() => encodeCategoricalCount({ rows: [] }), /分类键列表为空/);
  const many = Array.from({ length: 65 }, (_, i) => `k${i}`);
  assert.throws(() => encodeCategoricalCount({ rows: [{ category: "k0" }], categoryKeys: many }), /超过 64/);
});
