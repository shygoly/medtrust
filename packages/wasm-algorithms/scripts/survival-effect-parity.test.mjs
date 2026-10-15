// 站内 Cox / 分箱 KM 定点模块 vs TS 参考。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { BUILD_DIR, readManifest } from "./wasm-utils.mjs";
import {
  SURVIVAL_EFFECT_Q,
  decodeSurvivalEffect,
  encodeSurvivalEffect,
  survivalEffectQ16,
} from "../dist/index.js";

function runModule(encoded) {
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === "causal-survival");
  assert.ok(entry, "清单里没有 causal-survival");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const pages = Math.max(1, Math.ceil(encoded.requiredBytes / 65536));
  const memory = new WebAssembly.Memory({ initial: pages, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
  assert.equal(instance.exports.abi_version.value, 1);
  new Uint8Array(memory.buffer).set(encoded.input, 0);
  const code = instance.exports.run(0, encoded.n, encoded.k, encoded.outOff);
  assert.equal(code, 0);
  return decodeSurvivalEffect(new Uint8Array(memory.buffer, encoded.outOff, encoded.outBytes));
}

function rows(spec) {
  const treated = [];
  const event = [];
  const duration = [];
  for (const row of spec) {
    for (let i = 0; i < row.n; i++) {
      treated.push(row.treated);
      event.push(row.event);
      duration.push(row.day);
    }
  }
  return { treated, event, duration };
}

test("平衡事件的 log HR 为 0，箱内生存率等于 (7/8)^4", () => {
  const input = {
    minCell: 1,
    binWidth: 30,
    ...rows([
      { n: 2, treated: 1, event: 1, day: 10 },
      { n: 2, treated: 0, event: 1, day: 10 },
      { n: 2, treated: 1, event: 0, day: 30 },
      { n: 2, treated: 0, event: 0, day: 30 },
    ]),
  };
  const fitted = survivalEffectQ16(input);
  assert.deepEqual(runModule(encodeSurvivalEffect(input)), fitted);
  assert.equal(fitted.suppressed, 0);
  assert.equal(fitted.logHrQ, 0);
  assert.equal(fitted.seQ, SURVIVAL_EFFECT_Q);
  assert.deepEqual(fitted.bins, [
    { t: 0, survQ: SURVIVAL_EFFECT_Q, atRisk: 8, suppressed: 0 },
    { t: 30, survQ: 38416, atRisk: 4, suppressed: 0 },
  ]);
});

test("一步 Newton 贴近闭式 log HR = 2", () => {
  const input = {
    minCell: 1,
    binWidth: 30,
    ...rows([
      { n: 2, treated: 1, event: 1, day: 5 },
      { n: 2, treated: 0, event: 0, day: 40 },
    ]),
  };
  const fitted = survivalEffectQ16(input);
  assert.deepEqual(runModule(encodeSurvivalEffect(input)), fitted);
  const logHr = fitted.logHrQ / SURVIVAL_EFFECT_Q;
  const se = fitted.seQ / SURVIVAL_EFFECT_Q;
  assert.ok(Math.abs(logHr - 2) < 0.001);
  assert.ok(Math.abs(se - Math.sqrt(2)) < 0.001);
});

test("尾箱在险人数低于阈值时抑制，不交出真实人数", () => {
  const input = {
    minCell: 5,
    binWidth: 30,
    ...rows([
      { n: 6, treated: 1, event: 1, day: 10 },
      { n: 6, treated: 0, event: 1, day: 10 },
      { n: 1, treated: 1, event: 0, day: 30 },
      { n: 1, treated: 0, event: 0, day: 30 },
    ]),
  };
  const fitted = survivalEffectQ16(input);
  assert.deepEqual(runModule(encodeSurvivalEffect(input)), fitted);
  assert.equal(fitted.suppressed, 0);
  const tail = fitted.bins.find((bin) => bin.t === 30);
  assert.ok(tail);
  assert.equal(tail.suppressed, 1);
  assert.equal(tail.atRisk, 0);
  assert.equal(tail.survQ, 0);
  assert.equal(fitted.bins[0].atRisk, 14);
});
