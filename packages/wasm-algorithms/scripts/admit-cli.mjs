#!/usr/bin/env node
// third-party-module-admission —— 准入构建 CLI（控制面「构建触发」的执行体）。
//
// 控制面不在 API 进程里编译第三方代码:构建是**另起进程**的平台侧动作,
// 由本 CLI 执行(锁定工具链、断网 hermetic、双构建器对拍),把产物落到
// build/ 并在 stdout 打印一行 JSON 准入记录。API 只消费这条记录。
//
// 用法:
//   node scripts/admit-cli.mjs --source modules/disproportionality-rust \
//        --analysis-type disproportionality [--language rust] [--json-only]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUILD_DIR, MANIFEST_PATH } from "./wasm-utils.mjs";
import { reproduceAndGate } from "./admission.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

/** 把复现出来的产物写进分发目录并登记到清单（同 SM3 幂等覆盖）。 */
export function publishToBuildDir(record) {
  mkdirSync(BUILD_DIR, { recursive: true });
  const file = `${record.analysisType}-${record.sm3.slice(0, 12)}.wasm`;
  writeFileSync(join(BUILD_DIR, file), record.bytes);

  const manifest = existsSync(MANIFEST_PATH)
    ? JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
    : { generatedBy: "packages/wasm-algorithms/scripts/admit-cli.mjs", modules: [] };
  const entry = {
    analysisType: record.analysisType,
    file,
    abiVersion: 1,
    sm3: record.sm3,
    sizeBytes: record.sizeBytes,
    compiler: {
      name: record.toolchain.language,
      version: record.toolchain.channel,
    },
    language: record.language,
    reproducibleBuildRef: record.reproducibleBuildRef,
    staticGate: record.staticGate,
  };
  const idx = manifest.modules.findIndex((m) => m.sm3 === record.sm3);
  if (idx >= 0) manifest.modules[idx] = entry;
  else manifest.modules.push(entry);
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  return { file, entry };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.source || !args["analysis-type"]) {
    console.error(
      "用法: node scripts/admit-cli.mjs --source <源码目录> --analysis-type <分析类型> " +
        "[--language rust|assemblyscript] [--no-publish] [--emit-base64]",
    );
    process.exit(2);
  }
  try {
    const record = await reproduceAndGate(args.source, {
      language: args.language === true ? undefined : args.language,
      analysisType: args["analysis-type"],
    });
    const published = args["no-publish"] ? null : publishToBuildDir(record);
    // stdout 只有一行 JSON —— 控制面直接 JSON.parse。
    process.stdout.write(
      JSON.stringify({
        ok: true,
        analysisType: record.analysisType,
        language: record.language,
        sm3: record.sm3,
        sizeBytes: record.sizeBytes,
        toolchain: record.toolchain,
        staticGate: record.staticGate,
        sourceGate: record.sourceGate,
        reproducibleBuildRef: record.reproducibleBuildRef,
        file: published?.file ?? null,
        // --emit-base64：把产物字节一并交出，供独立构建环境提交给控制面
        // （POST /module-admission/submissions/:id/attest-build）。
        // 控制面不信任这里声称的 sm3，会对字节自行重算。
        ...(args["emit-base64"]
          ? { wasmBase64: Buffer.from(record.bytes).toString("base64") }
          : {}),
      }) + "\n",
    );
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        reason: err.reason ?? err.name ?? "error",
        error: err.message,
      }) + "\n",
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
