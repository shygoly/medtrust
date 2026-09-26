// third-party-module-admission 闸 2 —— 锁定工具链（hermetic、断网、可复现）。
//
// 每种源码语言一套**固定**的构建配方。配方的任何改动都会改变产物 SM3，
// 进而使已入册模块失配 —— 这是有意的：SM3 是「医院同意跑的那一份代码」的指纹，
// 换了编译器/参数就是换了一份代码，必须重走准入（D-CN-5）。
//
// 断网：Rust 走 `--offline --locked`（禁止解析/下载依赖）；AssemblyScript 走
// 仓内锁定版本的 asc，不访问网络。两者都不读取 `$HOME` 之外的可变状态。
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_ROOT } from "./wasm-utils.mjs";

const require = createRequire(import.meta.url);

/** 源码语言白名单（task 1.4）：只收这两种，其它在提交环节就拒。 */
export const SOURCE_LANGUAGES = ["rust", "assemblyscript"];

export class UnsupportedLanguageError extends Error {
  constructor(language) {
    super(
      `不支持的源码语言：${language}。` +
        `准入只接受 Rust / AssemblyScript 源码（D-CN-5）——` +
        `不接受其它语言，也不接受任何不透明二进制（不设 Tier C）。`,
    );
    this.name = "UnsupportedLanguageError";
  }
}

export function assertSourceLanguage(language) {
  if (!SOURCE_LANGUAGES.includes(language)) {
    throw new UnsupportedLanguageError(language);
  }
  return language;
}

/**
 * 从源码目录推断语言。推断不出即拒 —— 「只交了个 .wasm」正是在这里被挡住的:
 * 没有可复现构建的源码，平台复现不出 SM3，模块结构性地无法入册。
 */
export function detectLanguage(sourceDir) {
  if (existsSync(join(sourceDir, "Cargo.toml"))) return "rust";
  if (
    existsSync(join(sourceDir, "asconfig.json")) ||
    existsSync(join(sourceDir, "assembly"))
  ) {
    return "assemblyscript";
  }
  const hint = existsSync(sourceDir)
    ? "目录内未见 Cargo.toml / asconfig.json / assembly/"
    : "源码目录不存在";
  throw new UnsupportedLanguageError(`<未识别>（${hint}）`);
}

/** Rust 工具链版本 —— 从 rust-toolchain.toml 读，不从环境读（环境会漂）。 */
export function rustChannel(sourceDir) {
  const file = join(sourceDir, "rust-toolchain.toml");
  if (!existsSync(file)) {
    throw new Error(
      `Rust 源码必须带 rust-toolchain.toml 锁定工具链版本：${file}`,
    );
  }
  const m = readFileSync(file, "utf8").match(/channel\s*=\s*"([^"]+)"/);
  if (!m) throw new Error(`rust-toolchain.toml 未声明 channel：${file}`);
  return m[1];
}

export function assemblyScriptVersion() {
  return require("assemblyscript/package.json").version;
}

/**
 * Rust → wasm 的固定链接参数。
 * · --import-memory        内存由宿主注入（模块不得自己定义内存）
 * · --no-entry             无 _start，杜绝实例化即执行
 * · -zstack-size / --initial-memory / --max-memory  声明有上限的内存
 * · --remap-path-prefix    抹掉绝对路径 → 换机器构建产物仍逐字节一致
 */
export function rustLinkFlags(sourceDir, { maxMemoryBytes = 67_108_864 } = {}) {
  return [
    "-C link-arg=--import-memory",
    "-C link-arg=--no-entry",
    "-C link-arg=-zstack-size=65536",
    "-C link-arg=--initial-memory=131072",
    `-C link-arg=--max-memory=${maxMemoryBytes}`,
    `--remap-path-prefix=${sourceDir}=/medtrust`,
    `--remap-path-prefix=${PACKAGE_ROOT}=/medtrust-pkg`,
  ].join(" ");
}

/** 构建环境：只保留必要变量，且固定 SOURCE_DATE_EPOCH（时间戳不得进产物）。 */
export function hermeticEnv(sourceDir, extra = {}) {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    // 断网 + 固定时间：两台构建器、两个时刻，产物仍须逐字节一致。
    SOURCE_DATE_EPOCH: "0",
    CARGO_NET_OFFLINE: "true",
    CARGO_TERM_COLOR: "never",
    RUSTFLAGS: rustLinkFlags(sourceDir),
    ...extra,
  };
}

/**
 * 构建隔离模式（third-party-module-admission 闸 2）。
 *
 * `container`（默认）：在 packages/wasm-algorithms/Dockerfile.builder 里编译 ——
 *   `cargo build` 会执行第三方的 build.rs / proc-macro，那是闸 1/闸 3 都不覆盖的
 *   编译期执行点，必须关进无网络、只读、非 root、无凭据的容器。
 * `host`：直接在当前进程所在主机上编译。**只供本机开发/CI 自证**，
 *   必须显式设 `WASM_BUILD_ISOLATION=host` —— 绝不静默回退，否则隔离形同虚设。
 */
export function buildIsolationMode() {
  const raw = (process.env.WASM_BUILD_ISOLATION ?? "container").trim().toLowerCase();
  if (raw !== "container" && raw !== "host") {
    throw new Error(
      `WASM_BUILD_ISOLATION 只接受 container | host，实际 ${raw}`,
    );
  }
  return raw;
}

/** 隔离构建器镜像（版本跟随 rust channel，镜像与工具链一一对应）。 */
export function builderImage(channel) {
  return (
    process.env.WASM_BUILDER_IMAGE?.trim() ||
    `medtrust-wasm-builder:${channel}`
  );
}

/**
 * 容器运行参数：编译期是不可信执行点，按「无网络 / 只读根 / 非 root / 无能力 /
 * 不可提权 / 限资源 / 不挂任何凭据」跑。源码只读挂载，产物走独立的 /out。
 */
export function builderDockerArgs({ sourceDir, outDir, crateLib, channel }) {
  return [
    "run",
    "--rm",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--user",
    "10002:10002",
    "--memory=2g",
    "--cpus=2",
    "--pids-limit=256",
    "--tmpfs",
    "/tmp:rw,size=1g,mode=1777",
    "-v",
    `${sourceDir}:/src:ro`,
    "-v",
    `${outDir}:/out`,
    "-e",
    `CRATE_LIB=${crateLib}`,
    "-e",
    "SOURCE_DATE_EPOCH=0",
    "-e",
    "CARGO_NET_OFFLINE=true",
    "-e",
    // 容器内源码副本固定在 /tmp/src —— remap 前缀也固定，产物与宿主构建逐字节一致。
    `RUSTFLAGS=${rustLinkFlags("/tmp/src")}`,
    builderImage(channel),
  ];
}

/** Rust 的构建命令（cargo 参数亦为配方的一部分，计入清单）。 */
export function rustBuildArgs(targetDir) {
  return [
    "build",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "--offline",
    // --locked:Cargo.lock 不得被构建悄悄改写。零依赖的 crate 也要锁,
    // 因为「锁文件会变」本身就意味着这次构建与上次不是同一份输入。
    "--locked",
    "--target-dir",
    targetDir,
  ];
}
