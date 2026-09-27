// 去重人数模块 vs TS 参考语义 —— **对拍**（不是各测各的）。
//
// 为什么必须对拍：这条语义有两份实现（Wasm 模块与节点里的 TS 调用路径），
// 任一份改了而另一份没改，「节点内去重」的结果就说不清。夹具同一组，
// 逐字段比 totalDistinct 与每个分层的 distinct。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { BUILD_DIR, MANIFEST_PATH, readManifest } from "./wasm-utils.mjs";
import { distinctCount, encodeDistinctCount } from "../dist/index.js";

function align8(n) {
  return (n + 7) & ~7;
}

/** 在宿主内存上跑去重模块（与沙箱里的调用形状一致：只给 env.memory）。 */
function runModule(encoded) {
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === "distinct-count");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { memory },
  });
  assert.equal(instance.exports.abi_version.value, 1);

  const n = encoded.subjects;
  const k = encoded.strataKeys.length;
  const inOff = 1024;
  const inputBytes = n * 4 + n;
  const scratchOff = align8(inOff + inputBytes);
  const outOff = align8(scratchOff + n * 8);
  const view = new Uint8Array(memory.buffer);
  const subjects = new Uint8Array(encoded.subjectIds.buffer);
  view.set(subjects, inOff);
  view.set(encoded.stratum, inOff + n * 4);

  const code = instance.exports.run(inOff, n, k, outOff);
  assert.equal(code, 0);
  const u32 = new Uint32Array(memory.buffer);
  const base = outOff / 4;
  return {
    totalDistinct: u32[base],
    strata: Array.from({ length: k }, (_, s) => u32[base + 1 + s]),
  };
}

function fixture() {
  const rows = [
    { subjectKey: "s1", ageBand: "60-69", sex: "F" },
    { subjectKey: "s1", ageBand: "60-69", sex: "F" }, // 同层重复
    { subjectKey: "s2", ageBand: "60-69", sex: "F" },
    { subjectKey: "s3", ageBand: "70-79", sex: "M" },
    { subjectKey: "s2", ageBand: "70-79", sex: "M" }, // 同一人跨层
    { subjectKey: "s4", ageBand: "70-79", sex: "M" },
  ];
  const strataKeys = ["60-69|F", "70-79|M"];
  return { rows, strataKeys };
}

test("去重人数模块与 TS 参考语义逐字段一致（全体 / 每个分层）", () => {
  const { rows, strataKeys } = fixture();
  const reference = distinctCount({ rows, strataKeys });
  const moduleOut = runModule(encodeDistinctCount({ rows, strataKeys }));

  // s1..s4 四人；s1 同层重复不计，s2 跨两层但全体只计一次
  assert.equal(reference.totalDistinct, 4);
  assert.equal(moduleOut.totalDistinct, reference.totalDistinct);
  assert.deepEqual(
    reference.strata.map((s) => s.distinct),
    moduleOut.strata,
  );
  assert.equal(reference.strata[0].distinct, 2); // s1, s2
  assert.equal(reference.strata[1].distinct, 3); // s3, s2, s4
});

test("空输入：全体与各层都是 0", () => {
  const strataKeys = ["60-69|F"];
  const reference = distinctCount({ rows: [], strataKeys });
  const moduleOut = runModule(encodeDistinctCount({ rows: [], strataKeys }));
  assert.equal(reference.totalDistinct, 0);
  assert.equal(moduleOut.totalDistinct, 0);
  assert.deepEqual(moduleOut.strata, [0]);
});

test("参数越界即拒（不越界读写宿主内存）", () => {
  const { rows, strataKeys } = fixture();
  const encoded = encodeDistinctCount({ rows, strataKeys });
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === "distinct-count");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { memory },
  });
  assert.notEqual(instance.exports.run(1024, encoded.subjects, 65, 8192), 0);
  assert.notEqual(instance.exports.run(-1, encoded.subjects, strataKeys.length, 8192), 0);
  assert.notEqual(instance.exports.run(1024, encoded.subjects, strataKeys.length, 16), 0);
});

test("清单里的去重人数模块摘要与实际产物一致（清单不是摆设）", () => {
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === "distinct-count");
  assert.ok(entry, "清单里必须有 distinct-count 模块");
  const onDisk = readFileSync(join(BUILD_DIR, entry.file));
  assert.equal(onDisk.length, entry.sizeBytes);
  assert.equal(entry.abiVersion, 1);
  assert.equal(entry.imports.length, 1);
  assert.equal(entry.imports[0].module, "env");
  assert.equal(entry.operator.id, "rws.distinct-count");
  assert.equal(MANIFEST_PATH.endsWith("manifest.json"), true);
});
