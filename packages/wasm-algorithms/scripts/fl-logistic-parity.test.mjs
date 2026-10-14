// 定点 LR 模块 vs TS 参考语义 —— **对拍**（不是各测各的）。
//
// 为什么必须对拍：这条语义有两份实现（Wasm 模块与连接器侧的 TS 调用路径），
// 任一份改了而另一份没改，「院内定点训练」的结果就说不清。夹具同一组，
// **逐字段**比 thetaQ / interceptQ / nSamples / positives。
//
// 标准：这里是「同一算法两份实现」→ **逐字段相等**（不是容差）。
// 定点 vs 浮点 IRLS 的容差证据在 apps/connector（local-logistic-fixedpoint.proto.spec.ts）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { BUILD_DIR, readManifest } from "./wasm-utils.mjs";
import {
  FL_LOGISTIC_Q,
  buildFlLogisticLut,
  decodeFlLogisticOutput,
  encodeFlLogistic,
  trainFlLogisticQ16,
} from "../dist/index.js";

function align8(off) {
  return (off + 7) & ~7;
}

/** 在宿主内存上跑模块（与沙箱里的调用形状一致：只给 env.memory）。 */
function runModule(input) {
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === "fl-logistic");
  assert.ok(entry, "清单里必须有 fl-logistic 模块");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { memory },
  });
  assert.equal(instance.exports.abi_version.value, 1);

  const enc = encodeFlLogistic(input);
  const inOff = 1024;
  const gradOff = align8(inOff + enc.bytes.length);
  const outOff = gradOff + enc.d * 8 + 64; // 工作区与输出区不重叠
  new Uint8Array(memory.buffer).set(enc.bytes, inOff);
  const code = instance.exports.run(inOff, enc.n, enc.d, outOff);
  const out = new Uint8Array(memory.buffer, outOff, enc.d * 4 + 12);
  return { code, out, d: enc.d };
}

function compare(input, label) {
  const wasm = runModule(input);
  assert.equal(wasm.code, 0, label + "：模块应返回 0");
  const got = decodeFlLogisticOutput(wasm.out, wasm.d);
  const ref = trainFlLogisticQ16(input);
  assert.deepEqual(got.thetaQ, ref.thetaQ, label + "：thetaQ 必须逐字段相等");
  assert.equal(got.interceptQ, ref.interceptQ, label + "：interceptQ 必须相等");
  assert.equal(got.nSamples, ref.nSamples, label + "：nSamples 必须相等");
  assert.equal(got.positives, ref.positives, label + "：positives 必须相等");
  return { got, ref };
}

test("fl-logistic：可分数据逐字段一致", () => {
  const XQ = [];
  const y = [];
  for (let i = 0; i < 40; i++) {
    const pos = i % 2 === 0;
    XQ.push([pos ? 3 * FL_LOGISTIC_Q : 0, FL_LOGISTIC_Q]);
    y.push(pos ? 1 : 0);
  }
  const { got } = compare({ XQ, y, epochs: 300 }, "可分");
  assert.ok(got.interceptQ !== 0, "截距应当被训练动过");
});

test("fl-logistic：非可分/带噪数据（产生负梯度）逐字段一致", () => {
  const XQ = [];
  const y = [];
  for (let i = 0; i < 60; i++) {
    const v = (i % 3) - 1;
    XQ.push([v * FL_LOGISTIC_Q, ((i * 7) % 5) * Math.floor(FL_LOGISTIC_Q / 4)]);
    y.push(i % 4 === 0 || i % 7 === 0 ? 1 : 0);
  }
  compare({ XQ, y, epochs: 200 }, "带噪");
});

test("fl-logistic：单特征 + 全正标签（退化但合法）逐字段一致", () => {
  const XQ = [];
  const y = [];
  for (let i = 0; i < 12; i++) {
    XQ.push([i % 2 === 0 ? FL_LOGISTIC_Q : 0]);
    y.push(1);
  }
  compare({ XQ, y, epochs: 50 }, "单特征");
});

test("fl-logistic：自定义查表（宿主提供）也逐字段一致", () => {
  const lut = buildFlLogisticLut().map((v, i) => (i < 4 ? 0 : v)); // 故意改前缀，验证明细确实来自宿主
  const XQ = [[FL_LOGISTIC_Q], [0], [FL_LOGISTIC_Q], [0]];
  const y = [1, 0, 1, 0];
  compare({ XQ, y, epochs: 20, lut }, "自定义表");
});

test("fl-logistic：非法入参返回错误码（fail-closed，不越界写）", () => {
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === "fl-logistic");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { memory },
  });
  // n = 0 → 1；d = 0 → 2
  assert.equal(instance.exports.run(1024, 0, 2, 8192), 1);
  assert.equal(instance.exports.run(1024, 4, 0, 8192), 2);
  // 未初始化内存里 zMin/zMax 都是 0 → 先命中「查表/域非法」= 3（fail-closed 顺序：n、d、域、越界）
  assert.equal(instance.exports.run(1024, 4, 2, 8192), 3);
  // 写一份合法头部（域 + 2 条查表），再让 outOff 落在工作区内 → 4
  const view = new DataView(memory.buffer);
  view.setInt32(1024, -8 * FL_LOGISTIC_Q, true);
  view.setInt32(1024 + 4, 8 * FL_LOGISTIC_Q, true);
  view.setUint32(1024 + 8, 10, true);
  view.setInt32(1024 + 12, Math.round(0.5 * FL_LOGISTIC_Q), true);
  view.setInt32(1024 + 16, Math.round(0.01 * FL_LOGISTIC_Q), true);
  view.setUint32(1024 + 20, 2, true);
  view.setInt32(1024 + 32, 0, true);
  view.setInt32(1024 + 36, FL_LOGISTIC_Q, true);
  assert.equal(instance.exports.run(1024, 4, 2, 1024), 4);
});
