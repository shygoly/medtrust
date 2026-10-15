// 比较效果定点模块 vs TS 参考：同一组 0/1 列，输出逐字段相等。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { BUILD_DIR, readManifest } from "./wasm-utils.mjs";
import { decodeSiteEffect, encodeSiteEffect, siteEffectQ16 } from "../dist/index.js";

function runModule(encoded) {
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === "comparative-effect");
  assert.ok(entry, "清单里没有 comparative-effect");
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
  return decodeSiteEffect(
    new Uint8Array(memory.buffer, encoded.outOff, encoded.outBytes),
    encoded.k,
  );
}

function column(rows) {
  return {
    exposed: rows.map((r) => r.exposed),
    event: rows.map((r) => r.event),
    stratum: rows.map((r) => r.stratum),
    k: 1 + Math.max(...rows.map((r) => r.stratum)),
  };
}

test("良态四格：模块与参考逐字段一致，且 logOR 靠近粗 OR", () => {
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push({ exposed: 1, event: 1, stratum: 0 });
  for (let i = 0; i < 12; i++) rows.push({ exposed: 1, event: 0, stratum: 0 });
  for (let i = 0; i < 4; i++) rows.push({ exposed: 0, event: 1, stratum: 0 });
  for (let i = 0; i < 16; i++) rows.push({ exposed: 0, event: 0, stratum: 0 });
  const cols = column(rows);
  const encoded = encodeSiteEffect(cols);
  const wasm = runModule(encoded);
  const ref = siteEffectQ16(cols);
  assert.deepEqual(wasm, ref);
  assert.equal(wasm.method, 0);
  assert.deepEqual(wasm.cells, [{ a: 8, b: 12, c: 4, d: 16 }]);
  const logOr = wasm.logOrQ / 65536;
  const crude = Math.log((8 * 16) / (12 * 4));
  assert.ok(Math.abs(logOr - crude) < 0.05, `logOR ${logOr} vs crude ${crude}`);
});

test("两层计数：模块按分层下标累加，不把层序吃进回归", () => {
  const rows = [
    { exposed: 1, event: 1, stratum: 0 },
    { exposed: 1, event: 1, stratum: 0 },
    { exposed: 1, event: 0, stratum: 0 },
    { exposed: 0, event: 1, stratum: 0 },
    { exposed: 0, event: 0, stratum: 0 },
    { exposed: 1, event: 1, stratum: 1 },
    { exposed: 1, event: 0, stratum: 1 },
    { exposed: 0, event: 0, stratum: 1 },
  ];
  const cols = column(rows);
  const encoded = encodeSiteEffect(cols);
  const wasm = runModule(encoded);
  const ref = siteEffectQ16(cols);
  assert.deepEqual(wasm, ref);
  assert.deepEqual(wasm.cells, [
    { a: 2, b: 1, c: 1, d: 1 },
    { a: 1, b: 1, c: 0, d: 1 },
  ]);
});

test("完全分离：回退 Firth，估计仍有限且为正", () => {
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push({ exposed: 1, event: 1, stratum: 0 });
  for (let i = 0; i < 12; i++) rows.push({ exposed: 0, event: 0, stratum: 0 });
  const cols = column(rows);
  const encoded = encodeSiteEffect(cols);
  const wasm = runModule(encoded);
  const ref = siteEffectQ16(cols);
  assert.deepEqual(wasm, ref);
  assert.equal(wasm.method, 1);
  assert.ok(wasm.logOrQ > 0);
  assert.ok(wasm.seQ > 0);
});
