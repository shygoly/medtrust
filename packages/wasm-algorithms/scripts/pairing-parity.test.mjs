// 配对模块 vs TS 参考语义 —— **对拍**（不是各测各的）。
//
// 为什么必须对拍：这条语义有两份实现（Wasm 模块与节点里的 TS 调用路径），
// 任一份改了而另一份没改，「节点内配对」的结果就说不清。夹具同一组，
// 逐字段比 cohortSize / exposed / outcome / both 与每个分层的计数。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { BUILD_DIR, MANIFEST_PATH, readManifest } from "./wasm-utils.mjs";
import { encodeForModule, pairIntersection } from "../dist/index.js";

/** 在宿主内存上跑配对模块（与沙箱里的调用形状一致：只给 env.memory）。 */
function runModule(input) {
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === "paired-cohort");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { memory },
  });
  assert.equal(instance.exports.abi_version.value, 1);

  const strata = input.strataKeys.length;
  const inOff = 1024; // 宿主给定的输入区间（模块不自己分配内存）
  const outOff = 8192;
  const view = new Uint8Array(memory.buffer);
  view.set(input.present, inOff);
  view.set(input.exposure, inOff + input.present.length);
  view.set(input.outcome, inOff + input.present.length + input.subjects);
  view.set(input.stratum, inOff + input.present.length + 2 * input.subjects);

  const code = instance.exports.run(inOff, input.parties, input.subjects, strata, outOff);
  assert.equal(code, 0);
  const u32 = new Uint32Array(memory.buffer);
  const base = outOff / 4;
  const out = {
    cohortSize: u32[base],
    exposed: u32[base + 1],
    outcome: u32[base + 2],
    both: u32[base + 3],
    strata: Array.from({ length: strata }, (_, s) => ({
      exposed: u32[base + 4 + s * 3],
      both: u32[base + 4 + s * 3 + 1],
      cohort: u32[base + 4 + s * 3 + 2],
    })),
  };
  return out;
}

/** 造一组合成数据：两方共享 4 人、各有一方独有 3 人，含分层与「结局只在 B 方」。 */
function fixture() {
  const tables = [
    {
      node: "urn:tds:sh-med:participant:p-huashan",
      rows: [
        { subjectKey: "s1", exposure: true, outcome: false, ageBand: "60-69", sex: "F" },
        { subjectKey: "s2", exposure: true, outcome: false, ageBand: "60-69", sex: "M" },
        { subjectKey: "s3", exposure: false, outcome: true, ageBand: "70-79", sex: "F" },
        { subjectKey: "s4", exposure: true, outcome: false, ageBand: "70-79", sex: "M" },
        { subjectKey: "a1", exposure: true, outcome: true, ageBand: "60-69", sex: "F" },
        { subjectKey: "a2", exposure: false, outcome: false, ageBand: "60-69", sex: "M" },
        { subjectKey: "a3", exposure: true, outcome: false, ageBand: "70-79", sex: "F" },
      ],
    },
    {
      node: "urn:tds:sh-med:participant:p-ruijin",
      rows: [
        { subjectKey: "s1", exposure: false, outcome: true, ageBand: "60-69", sex: "F" },
        { subjectKey: "s2", exposure: false, outcome: false, ageBand: "60-69", sex: "M" },
        { subjectKey: "s3", exposure: false, outcome: false, ageBand: "70-79", sex: "F" },
        { subjectKey: "s4", exposure: false, outcome: true, ageBand: "70-79", sex: "M" },
        { subjectKey: "b1", exposure: false, outcome: true, ageBand: "60-69", sex: "F" },
        { subjectKey: "b2", exposure: true, outcome: false, ageBand: "60-69", sex: "M" },
        { subjectKey: "b3", exposure: false, outcome: true, ageBand: "70-79", sex: "F" },
      ],
    },
  ];
  // 宿主负责分层编号：与 TS 输出里的分层 key 排序一致，两者才能逐格对拍
  const strataKeys = ["60-69|F", "60-69|M", "70-79|F", "70-79|M"];
  return { tables, strataKeys };
}

test("配对模块与 TS 参考语义逐字段一致（交集 / 暴露 / 结局 / 两者 / 每个分层）", () => {
  const { tables, strataKeys } = fixture();
  const reference = pairIntersection({ tables });
  const moduleOut = runModule(encodeForModule({ tables, strataKeys }));

  // 交集只算两方都出现的主体：s1..s4（a*/b* 是单方独有，不能进分子分母）
  assert.equal(reference.cohortSize, 4);
  assert.equal(moduleOut.cohortSize, reference.cohortSize);
  assert.equal(moduleOut.exposed, reference.exposed);
  assert.equal(moduleOut.outcome, reference.outcome);
  assert.equal(moduleOut.both, reference.exposedWithOutcome);

  // 分层：TS 按 key 排序输出，模块按宿主给的分层编号输出——逐格对齐
  assert.deepEqual(
    reference.strata.map((s) => ({ key: s.key, exposed: s.exposed, both: s.exposedWithOutcome, cohort: s.cohortSize })),
    strataKeys.map((key, s) => ({
      key,
      exposed: moduleOut.strata[s].exposed,
      both: moduleOut.strata[s].both,
      cohort: moduleOut.strata[s].cohort,
    })),
  );
});

test("参数越界即拒（不越界读写宿主内存）", () => {
  const { tables, strataKeys } = fixture();
  const input = encodeForModule({ tables, strataKeys });
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === "paired-cohort");
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { memory },
  });
  // parties>8 / strata>64 / 负偏移 → 非 0
  assert.notEqual(instance.exports.run(1024, 9, input.subjects, strataKeys.length, 8192), 0);
  assert.notEqual(instance.exports.run(1024, 2, input.subjects, 65, 8192), 0);
  assert.notEqual(instance.exports.run(-1, 2, input.subjects, strataKeys.length, 8192), 0);
});

test("清单里的配对模块摘要与实际产物一致（清单不是摆设）", () => {
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === "paired-cohort");
  assert.ok(entry, "清单里必须有 paired-cohort 模块");
  const onDisk = readFileSync(join(BUILD_DIR, entry.file));
  assert.equal(onDisk.length, entry.sizeBytes);
  // 模块名刻意不叫「跨院」之类：本包与协议核一样保持领域中立命名
  assert.equal(entry.abiVersion, 1);
  assert.equal(entry.imports.length, 1);
  assert.equal(entry.imports[0].module, "env");
  assert.equal(MANIFEST_PATH.endsWith("manifest.json"), true);
});
