// 站内 PSM/IPTW 定点模块 vs TS 参考：同一组 0/1 列，输出逐字段相等。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { BUILD_DIR, readManifest } from "./wasm-utils.mjs";
import { CAUSAL_ATE_Q, causalAteQ16, decodeCausalAte, encodeCausalAte } from "../dist/index.js";

function runModule(encoded) {
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === "causal-psm");
  assert.ok(entry, "清单里没有 causal-psm");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const pages = Math.max(1, Math.ceil(encoded.requiredBytes / 65536));
  const memory = new WebAssembly.Memory({ initial: pages, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { memory },
  });
  assert.equal(instance.exports.abi_version.value, 1);
  new Uint8Array(memory.buffer).set(encoded.input, 0);
  const code = instance.exports.run(0, encoded.n, encoded.k, encoded.outOff);
  assert.equal(code, 0);
  return decodeCausalAte(new Uint8Array(memory.buffer, encoded.outOff, encoded.outBytes));
}

function column(spec) {
  return {
    method: spec.method,
    minCell: spec.minCell,
    treated: spec.rows.map((row) => row[0]),
    outcome: spec.rows.map((row) => row[1]),
    stratum: spec.rows.map((row) => row[2]),
    k: spec.k,
  };
}

test("IPTW 与 TS 逐字段相等，且贴近饱和风险差", () => {
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push([1, 1, 0]);
  for (let i = 0; i < 4; i++) rows.push([1, 0, 0]);
  for (let i = 0; i < 4; i++) rows.push([0, 1, 0]);
  for (let i = 0; i < 12; i++) rows.push([0, 0, 0]);
  const input = column({ method: 0, minCell: 1, k: 1, rows });
  const fitted = causalAteQ16(input);
  const got = runModule(encodeCausalAte(input));
  assert.deepEqual(got, fitted);
  assert.equal(fitted.suppressed, 0);
  const ate = fitted.ateQ / CAUSAL_ATE_Q;
  const se = fitted.seQ / CAUSAL_ATE_Q;
  assert.ok(Math.abs(ate - (8 / 12 - 4 / 16)) < 0.001);
  const floatSe = Math.sqrt((8 / 12) * (4 / 12) / 12 + (4 / 16) * (12 / 16) / 16);
  assert.ok(Math.abs(se - floatSe) < 0.001);
});

test("PSM 层内按出现顺序配对，标准误贴近样本公式", () => {
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push([1, 1, 0]);
  for (let i = 0; i < 4; i++) rows.push([1, 0, 0]);
  for (let i = 0; i < 4; i++) rows.push([0, 1, 0]);
  for (let i = 0; i < 12; i++) rows.push([0, 0, 0]);
  const input = column({ method: 1, minCell: 1, k: 1, rows });
  const fitted = causalAteQ16(input);
  assert.deepEqual(runModule(encodeCausalAte(input)), fitted);
  assert.equal(fitted.nUsed, 24);
  const ate = fitted.ateQ / CAUSAL_ATE_Q;
  const se = fitted.seQ / CAUSAL_ATE_Q;
  assert.ok(Math.abs(ate - 4 / 12) < 0.001);
  assert.ok(Math.abs(se - Math.sqrt(2 / 99)) < 0.001);
});

test("层内样本量低于阈值则整站抑制，不交出 0 效应冒充结果", () => {
  const rows = [
    [1, 1, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ];
  const input = column({ method: 0, minCell: 5, k: 1, rows });
  const fitted = causalAteQ16(input);
  assert.deepEqual(runModule(encodeCausalAte(input)), fitted);
  assert.equal(fitted.suppressed, 1);
  assert.equal(fitted.ateQ, 0);
  assert.equal(fitted.seQ, 0);
});
