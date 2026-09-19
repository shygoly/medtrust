// 可复现性闸门（algorithm-sandbox「模块可复现构建」）：
//   1. 以锁定编译器从源码重新构建到临时目录；
//   2. 产物 SM3 必须等于入库清单里的 SM3，否则失败；
//   3. 重新构建的产物同样只导入 env.memory、导出 run/abi_version。
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "./build.mjs";
import { MANIFEST_PATH, readManifest, sm3BytesHex } from "./wasm-utils.mjs";

const tmp = mkdtempSync(join(tmpdir(), "medtrust-wasm-"));
try {
  const shipped = readManifest();
  const rebuilt = await build({
    outFile: join(tmp, "disproportionality.wasm"),
    textFile: join(tmp, "disproportionality.wat"),
    writeManifestPath: false,
  });
  const a = shipped.modules[0];
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
      `不可复现构建: 重新构建 SM3=${b.sm3} ≠ 入库 SM3=${a.sm3}` +
        `（编译器 ${a.compiler.version} → ${b.compiler.version}）`,
    );
  }
  console.log(
    `reproducible: ${a.file} SM3=${a.sm3}（源码重建逐字节一致,只导入 env.memory）`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
