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
/**
 * 提交形状的源码目录根。`modules/<name>/` 下**只放源码**，不含 npm/cargo 之外的
 * 工程机制 —— 平台自研（Tier A）与第三方（Tier B）走完全相同的目录形状与闸门，
 * 「分层」只是来源标注，不是安全豁免（D-CN-5）。
 */
export const MODULES_DIR = join(PACKAGE_ROOT, "modules");
export const PLATFORM_AS_MODULE_DIR = join(MODULES_DIR, "disproportionality-as");
export const MANIFEST_PATH = join(BUILD_DIR, "manifest.json");

/**
 * 平台自研（Tier A）模块清单：**每个模块一个目录、一份入口源码**。
 *
 * 加模块时只动这张表：构建、静态检查（零能力）、可复现性对拍与清单合并都按它循环，
 * 不会再出现「新模块漏了某道闸」这种事。
 */
export const PLATFORM_MODULES = [
  {
    analysisType: "disproportionality",
    moduleDir: join(MODULES_DIR, "disproportionality-as"),
    entry: "assembly/disproportionality.ts",
    /**
     * 算子**声明形状**：模块在 MDOP 里以什么样的算子出现（类别 / 环境 / 输入输出标签）。
     *
     * 为什么不靠「默认形状」：平台登记服务原先对每个 wasm 模块都套同一份默认
     * （`local` / `plain` / C0→table）。配对算子不是那种东西——它在**节点内**跑、
     * 输入是 **C2 信封投影**、只能放在通告了 TEE 能力的节点上。用默认形状登记
     * 等于把「协同类算子」冒充成「连接器本地统计算子」，编译器就可能把它放到医院侧。
     */
    operator: {
      id: "rws.disproportionality",
      version: "1.0.0",
      category: "local",
      environments: ["plain"],
      inputs: [{ name: "dataset", schema: "mdop.table/1.0", accept_labels: ["C0"] }],
      outputs: [{ name: "table", schema: "mdop.table/1.0", label_rule: "inherit" }],
    },
  },
  {
    analysisType: "paired-cohort",
    moduleDir: join(MODULES_DIR, "pairing-as"),
    entry: "assembly/pairing.ts",
    operator: {
      id: "rws.paired-cohort",
      version: "1.0.0",
      /** 协同类：协议 §5.1 里「跨院主体配对」属协同计算，不是本地统计。 */
      category: "collab",
      /** 只在**可信空间节点**（TEE）内执行——医院侧连接器不得承载它。 */
      environments: ["tee"],
      inputs: [
        { name: "left", schema: "mdop.projection/1.0", accept_labels: ["C2"] },
        { name: "right", schema: "mdop.projection/1.0", accept_labels: ["C2"] },
      ],
      outputs: [{ name: "paired", schema: "rws.paired-cohort/1.0", label_rule: "inherit" }],
    },
  },
  {
    analysisType: "distinct-count",
    moduleDir: join(MODULES_DIR, "distinct-count-as"),
    entry: "assembly/distinct-count.ts",
    operator: {
      id: "rws.distinct-count",
      version: "1.0.0",
      /** 本地统计：按分层去重人数，不是跨院协同。 */
      category: "local",
      /** 只在可信空间节点（TEE）内执行——C2 投影不得下到医院侧连接器。 */
      environments: ["tee"],
      inputs: [
        { name: "dataset", schema: "mdop.projection/1.0", accept_labels: ["C2"] },
      ],
      outputs: [{ name: "counts", schema: "rws.distinct-count/1.0", label_rule: "inherit" }],
    },
  },
  {
    analysisType: "vaccine-scri",
    moduleDir: join(MODULES_DIR, "scri-as"),
    entry: "assembly/scri.ts",
    operator: {
      id: "rws.vaccine-scri",
      version: "1.0.0",
      /** 协同类：接种记录（疾控）与就诊结局（医院）须在节点内按人对齐、按日期差计数。 */
      category: "collab",
      environments: ["tee"],
      inputs: [
        { name: "registry", schema: "mdop.projection/1.0", accept_labels: ["C2"] },
        { name: "events", schema: "mdop.projection/1.0", accept_labels: ["C2"] },
      ],
      outputs: [{ name: "scri", schema: "rws.vaccine-scri/1.0", label_rule: "inherit" }],
    },
  },
];

export function moduleSpec(analysisType) {
  const spec = PLATFORM_MODULES.find((m) => m.analysisType === analysisType);
  if (!spec) throw new Error(`未登记的平台模块：${analysisType}`);
  return spec;
}

/** 模块字节的真国密 SM3(64 hex 小写)。禁止以 sha256 冒充(CTL-15)。 */
export function sm3BytesHex(bytes) {
  return sm3(Array.from(bytes));
}

export function compilerVersion() {
  return require("assemblyscript/package.json").version;
}

/** 固定编译参数(design D4):只导入宿主提供的内存,无 env.abort,零 host 函数。 */
export function buildArgs(outFile, textFile, entry = "assembly/disproportionality.ts") {
  return [
    entry,
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
