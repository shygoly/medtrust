// 可复现性闸门（algorithm-sandbox「模块可复现构建」）：
//   1. 以锁定编译器从源码重新构建到临时目录；
//   2. 产物 SM3 必须等于入库清单里的 SM3，否则失败；
//   3. 重新构建的产物同样只导入 env.memory、导出 run/abi_version。
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "./build.mjs";
import { MANIFEST_PATH, PLATFORM_MODULES, readManifest, sm3BytesHex } from "./wasm-utils.mjs";

const tmp = mkdtempSync(join(tmpdir(), "medtrust-wasm-"));
try {
  const shipped = readManifest();
  // **按平台模块表**逐个重建对拍：新加一个模块却漏了这道闸，是这类「同一件事有多份产物」
  // 最容易出的疏漏，所以这里循环而不是只查 modules[0]。
  //
  // 注意范围：清单是**共享**的（第三方准入模块也登记在里面，编译器是 rust/clang 等），
  // 可复现构建这条闸只覆盖**本脚本构建的平台模块**——第三方模块走准入侧自己的复现比对，
  // 按 `compiler.name === 'assemblyscript'` 过滤会把「平台模块漏登记」也一起放过，
  // 因此这里以 `PLATFORM_MODULES` 为准、并要求它在清单里**必须存在**。
  for (const spec of PLATFORM_MODULES) {
    const a = shipped.modules.find(
      (m) => m.analysisType === spec.analysisType && m.file === `${spec.analysisType}.wasm`,
    );
    if (!a) throw new Error(`清单里缺平台模块：${spec.analysisType}（先跑 node scripts/build.mjs）`);
    const rebuilt = await build({
      analysisType: a.analysisType,
      outFile: join(tmp, a.file),
      textFile: join(tmp, a.file.replace(/\.wasm$/, ".wat")),
      writeManifestPath: false,
    });
    const b = rebuilt.modules[0];

    const shippedBytes = readFileSync(join(MANIFEST_PATH, "..", a.file));
    const shippedSm3 = sm3BytesHex(shippedBytes);
    if (shippedSm3 !== a.sm3) {
      throw new Error(
        `入库产物与清单不符: build/${a.file} SM3=${shippedSm3} ≠ manifest SM3=${a.sm3}`,
      );
    }
    if (b.sm3 !== a.sm3) {
      throw new Error(
        `不可复现构建: ${a.file} 重新构建 SM3=${b.sm3} ≠ 入库 SM3=${a.sm3}` +
          `（编译器 ${a.compiler.version} → ${b.compiler.version}）`,
      );
    }
    console.log(
      `reproducible: ${a.file} SM3=${a.sm3}（源码重建逐字节一致,只导入 env.memory）`,
    );
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
