// 构建算法模块 → build/disproportionality.wasm + build/manifest.json（入库）。
//
// 可复现性：编译器版本锁定（package.json devDependencies,精确版本）、编译参数固定，
// 同源码 + 同编译器 → 同字节 → 同 SM3（scripts/check-reproducible.mjs 在 CI/`pnpm test` 校验）。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import asc from "assemblyscript/asc";
import {
  BUILD_DIR,
  MANIFEST_PATH,
  buildArgs,
  compilerVersion,
  inspectModule,
  sm3BytesHex,
} from "./wasm-utils.mjs";

const ANALYSIS_TYPE = "disproportionality";

async function compile({ outFile, textFile }) {
  const messages = [];
  const { error } = await asc.main(buildArgs(outFile, textFile), {
    stdout: process.stdout,
    stderr: process.stderr,
    reportDiagnostic(diagnostic) {
      messages.push(diagnostic.message);
    },
  });
  if (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  return messages;
}

export async function build({ outFile, textFile, writeManifestPath } = {}) {
  mkdirSync(BUILD_DIR, { recursive: true });
  const wasmPath = outFile ?? join(BUILD_DIR, `${ANALYSIS_TYPE}.wasm`);
  const watPath = textFile ?? join(BUILD_DIR, `${ANALYSIS_TYPE}.wat`);
  await compile({ outFile: wasmPath, textFile: watPath });

  const bytes = readFileSync(wasmPath);
  const wat = readFileSync(watPath, "utf8");
  const { imports, exports, abiVersion } = inspectModule(bytes, wat);
  const manifest = {
    generatedBy: "packages/wasm-algorithms/scripts/build.mjs",
    modules: [
      {
        analysisType: ANALYSIS_TYPE,
        file: `${ANALYSIS_TYPE}.wasm`,
        abiVersion,
        sm3: sm3BytesHex(bytes),
        sizeBytes: bytes.length,
        compiler: { name: "assemblyscript", version: compilerVersion() },
        buildArgs: buildArgs(`${ANALYSIS_TYPE}.wasm`, `${ANALYSIS_TYPE}.wat`),
        imports,
        exports,
      },
    ],
  };
  if (writeManifestPath !== false) {
    writeFileSync(
      writeManifestPath ?? MANIFEST_PATH,
      JSON.stringify(manifest, null, 2) + "\n",
    );
  }
  return manifest;
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  const manifest = await build();
  const m = manifest.modules[0];
  console.log(
    `built ${m.file}: ${m.sizeBytes} bytes, SM3=${m.sm3}, abi=${m.abiVersion}, asc=${m.compiler.version}`,
  );
}
