// 构建与校验共用的工具：SM3 摘要、模块导入/导出检查、编译器版本读取。
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
// sm-crypto 是 CJS 包,ESM 侧没有具名导出。
const { sm3 } = require("sm-crypto");

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BUILD_DIR = join(PACKAGE_ROOT, "build");
export const MANIFEST_PATH = join(BUILD_DIR, "manifest.json");

/** 模块字节的真国密 SM3(64 hex 小写)。禁止以 sha256 冒充(CTL-15)。 */
export function sm3BytesHex(bytes) {
  return sm3(Array.from(bytes));
}

export function compilerVersion() {
  return require("assemblyscript/package.json").version;
}

/** 固定编译参数(design D4):只导入宿主提供的内存,无 env.abort,零 host 函数。 */
export function buildArgs(outFile, textFile) {
  return [
    "assembly/disproportionality.ts",
    "--outFile",
    outFile,
    ...(textFile ? ["--textFile", textFile] : []),
    "--runtime",
    "stub",
    "--importMemory",
    "--initialMemory",
    "1",
    "--maximumMemory",
    "1024",
    "--use",
    "abort=",
    "-O3",
  ];
}

/**
 * 静态检查:导入必须恰好是 {module:'env', name:'memory', kind:'memory'};
 * 导出只许 run(函数)、abi_version(常量全局)、被重新导出的那同一块内存。
 * 内存必须来自导入(宿主创建、有上限),模块不得自己定义内存 —— 判据是 WAT 里
 * 只有 `(import "env" "memory" ...)` 而没有内存定义行。
 * 返回 { imports, exports, abiVersion }。
 */
export function inspectModule(bytes, watText) {
  const mod = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(mod).map((i) => ({
    module: i.module,
    name: i.name,
    kind: i.kind,
  }));
  const exports = WebAssembly.Module.exports(mod).map((e) => ({
    name: e.name,
    kind: e.kind,
  }));

  const badImport = imports.find(
    (i) => !(i.module === "env" && i.name === "memory" && i.kind === "memory"),
  );
  if (badImport) {
    throw new Error(
      `模块含非零能力导入（必须只有 env.memory）: ${badImport.module}.${badImport.name} (${badImport.kind})`,
    );
  }
  if (imports.length !== 1) {
    throw new Error(`模块必须恰好导入一块内存,实际 ${imports.length} 个导入`);
  }
  const run = exports.find((e) => e.name === "run");
  if (!run || run.kind !== "function") {
    throw new Error("模块必须导出函数 run");
  }
  const abi = exports.find((e) => e.name === "abi_version");
  if (!abi || abi.kind !== "global") {
    throw new Error("模块必须导出常量全局 abi_version");
  }
  const unexpected = exports.find(
    (e) => !["run", "abi_version", "memory"].includes(e.name),
  );
  if (unexpected) {
    throw new Error(`模块导出了未授权符号 ${unexpected.name} (${unexpected.kind})`);
  }
  if (watText !== undefined) {
    const memoryImports = watText.match(/\(import "env" "memory" \(memory/g) ?? [];
    const memoryDefs = watText.match(/^\s*\(memory /gm) ?? [];
    if (memoryImports.length !== 1 || memoryDefs.length !== 0) {
      throw new Error(
        `内存必须恰好来自一次 env.memory 导入(宿主注入且有上限),实际导入 ${memoryImports.length} 次、自定义内存 ${memoryDefs.length} 处`,
      );
    }
  }

  // abi_version 的真实取值:用宿主内存实例化后读取常量全局。
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
  const instance = new WebAssembly.Instance(mod, { env: { memory } });
  const abiVersion = instance.exports.abi_version.value;
  if (abiVersion !== 1) {
    throw new Error(`abi_version 必须是 1,实际 ${abiVersion}`);
  }
  return { imports, exports, abiVersion };
}

export function readManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}
