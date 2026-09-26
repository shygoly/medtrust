// 构建算法模块 → build/disproportionality.wasm + build/manifest.json（入库）。
//
// 可复现性：编译器版本锁定（package.json devDependencies,精确版本）、编译参数固定，
// 同源码 + 同编译器 → 同字节 → 同 SM3（scripts/check-reproducible.mjs 在 CI/`pnpm test` 校验）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import asc from "assemblyscript/asc";
import {
  BUILD_DIR,
  MANIFEST_PATH,
  PLATFORM_MODULES,
  buildArgs,
  compilerVersion,
  inspectModule,
  moduleSpec,
  sm3BytesHex,
} from "./wasm-utils.mjs";

async function compile({ outFile, textFile, moduleDir, entry }) {
  const messages = [];
  // asc 按 --baseDir 解析入口（不是 cwd）。baseDir = 提交形状的模块目录，
  // 也就是闸 0 检查的那个目录；不写进 manifest 的 buildArgs（那里只留可移植的配方）。
  const { error } = await asc.main(
    [...buildArgs(outFile, textFile, entry), "--baseDir", moduleDir],
    {
    stdout: process.stdout,
    stderr: process.stderr,
    reportDiagnostic(diagnostic) {
      messages.push(diagnostic.message);
    },
    },
  );
  if (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  return messages;
}

export async function build({ outFile, textFile, writeManifestPath, analysisType } = {}) {
  mkdirSync(BUILD_DIR, { recursive: true });
  // 不给 analysisType 就构建**全部**平台模块（CLI 与可复现性闸门都走这条）
  const specs = analysisType ? [moduleSpec(analysisType)] : PLATFORM_MODULES;
  const modules = [];
  for (const spec of specs) {
    modules.push(await buildOne(spec, { outFile, textFile }));
  }
  const manifest = { generatedBy: "packages/wasm-algorithms/scripts/build.mjs", modules };
  if (writeManifestPath !== false) {
    // third-party-module-admission:清单是**共享**的 —— 平台自研模块(本脚本)与
    // 第三方准入模块(admit-cli)都往里登记。按 analysisType+file 合并而不是整体覆盖,
    // 否则重建平台模块会把已入册的第三方模块从分发清单里抹掉。
    const path = writeManifestPath ?? MANIFEST_PATH;
    const existing = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { modules: [] };
    const merged = [...(existing.modules ?? [])];
    for (const m of manifest.modules) {
      const idx = merged.findIndex((x) => x.analysisType === m.analysisType && x.file === m.file);
      if (idx >= 0) merged[idx] = m;
      else merged.push(m);
    }
    writeFileSync(path, JSON.stringify({ ...manifest, modules: merged }, null, 2) + "\n");
  }
  return manifest;
}

/** 构建单个平台模块（可复现性闸门按模块重建时也调它）。 */
async function buildOne(spec, { outFile, textFile } = {}) {
  const analysisType = spec.analysisType;
  const wasmPath = outFile ?? join(BUILD_DIR, `${analysisType}.wasm`);
  const watPath = textFile ?? join(BUILD_DIR, `${analysisType}.wat`);
  await compile({
    outFile: wasmPath,
    textFile: watPath,
    moduleDir: spec.moduleDir,
    entry: spec.entry,
  });

  const bytes = readFileSync(wasmPath);
  const wat = readFileSync(watPath, "utf8");
  const { imports, exports, abiVersion } = inspectModule(bytes, wat);
  return {
    analysisType,
    file: `${analysisType}.wasm`,
    abiVersion,
    sm3: sm3BytesHex(bytes),
    sizeBytes: bytes.length,
    compiler: { name: "assemblyscript", version: compilerVersion() },
    // 算子**声明形状**随模块一起入清单：平台登记服务按它建算子（而不是套一份默认形状）
    ...(spec.operator ? { operator: spec.operator } : {}),
    buildArgs: buildArgs(`${analysisType}.wasm`, `${analysisType}.wat`, spec.entry),
    imports,
    exports,
  };
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  const manifest = await build();
  for (const m of manifest.modules)
    console.log(
      `built ${m.file}: ${m.sizeBytes} bytes, SM3=${m.sm3}, abi=${m.abiVersion}, asc=${m.compiler.version}`,
    );
}
