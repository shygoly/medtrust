// 站点校验指标定点模块 vs TS 参考。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { BUILD_DIR, readManifest } from "./wasm-utils.mjs";
import {
  VALIDATION_Q,
  decodeValidationMetrics,
  encodeValidationMetrics,
  validationMetricsQ16,
} from "../dist/index.js";

function runModule(encoded) {
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === "algorithm-validation");
  assert.ok(entry, "清单里没有 algorithm-validation");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const pages = Math.max(1, Math.ceil(encoded.requiredBytes / 65536));
  const memory = new WebAssembly.Memory({ initial: pages, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
  assert.equal(instance.exports.abi_version.value, 1);
  new Uint8Array(memory.buffer).set(encoded.input, 0);
  const code = instance.exports.run(0, encoded.n, encoded.k, encoded.outOff);
  assert.equal(code, 0);
  return decodeValidationMetrics(new Uint8Array(memory.buffer, encoded.outOff, encoded.outBytes));
}

function hanley(auc, nPos, nNeg) {
  const q1 = auc / (2 - auc);
  const q2 = (2 * auc * auc) / (1 + auc);
  const factor = 1 + (nPos - 1) * q1 + (nNeg - 1) * q2;
  return Math.sqrt((auc * (1 - auc) * factor) / (nPos * nNeg));
}

test("两对分数的 AUC 是 0.75，标准误贴近 Hanley", () => {
  const q = VALIDATION_Q;
  const input = {
    minCell: 1,
    label: [1, 1, 0, 0],
    score: [3 * (q / 4), q / 4, q / 2, 0],
  };
  const fitted = validationMetricsQ16(input);
  assert.deepEqual(runModule(encodeValidationMetrics(input)), fitted);
  assert.equal(fitted.suppressed, 0);
  assert.equal(fitted.aucQ, (3 * q) / 4);
  const se = fitted.seQ / q;
  assert.ok(Math.abs(se - hanley(0.75, 2, 2)) < 0.001);
});

test("样本量低于阈值时不交出 AUC，小校准箱不交出人数", () => {
  const q = VALIDATION_Q;
  const input = {
    minCell: 5,
    label: [1, 1, 0, 0],
    score: [q, q, 0, 0],
  };
  const fitted = validationMetricsQ16(input);
  assert.deepEqual(runModule(encodeValidationMetrics(input)), fitted);
  assert.equal(fitted.suppressed, 1);
  assert.equal(fitted.aucQ, 0);
  assert.equal(fitted.seQ, 0);
  assert.ok(fitted.calibration.every((bin) => bin.suppressed === 1 && bin.n === 0));
  assert.ok(fitted.decision.every((point) => point.suppressed === 1 && point.netBenefitQ === 0));
});
