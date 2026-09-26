#!/usr/bin/env node
/**
 * check-tee-claims.mjs — 「TEE 表述红线」的机检（TRUST 红线清单第 4 条 / CTL-09 / D9 / D-RWS-4）。
 *
 * 这条红线在 C2 变更之前是一句粗话：「代码出现 `'hardware'` 赋值即违规」。C2 落地后它必须变精确，
 * 否则两种坏法各占一半：要么形同虚设（证明契约里本来就有 hardware，粗话只能被忽略），
 * 要么把合法代码判红（真证明代理必须产出 hardware 级结论）。现在的三条是：
 *
 *  R1 **自述口径 `attestationLevel` 不得写成 `hardware`**（仓库内任何位置，含测试）。
 *     它是**医院/agent 执行环境**对外的信任级别自述；硬件远程证明真正接入并跑通演练前恒为
 *     `software`。要改这个口径，改的是受控来源（`@Entity` 列 + 服务），不是在业务代码里写字面量。
 *  R2 **`level: 'hardware'` 只许出现在证明契约与测试夹具里**（`packages/mdop/src/attestation/**`
 *     或 `*.spec.ts` / `*.test.ts`）。可信空间节点的硬件结论**只能由证明提供者产出**
 *     （`mapVendorQuote`）；换个目录写这个字面量，就是在没有厂商证明根的地方虚构信任级别。
 *  R3 **`isolation: 'hardware-enclave'` 只许出现在证明契约、节点组件与测试夹具里**。
 *     医院侧执行环境（连接器域内 / agent）没有硬件飞地——那里出现这个赋值即为虚标。
 *
 * 注意：三条都只认「赋值/属性写法」，**不认类型联合与比较**（`level: 'software' | 'hardware'`、
 * `report.level === 'hardware'` 都是合法且必要的：一个声明取值域，一个在做判定）。
 * 零依赖，`node scripts/check-tee-claims.mjs` 运行；退出码：有 error 则 1。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".git", "coverage", "build", ".turbo", "data"]);

/** 扫描根（两个平面都在 src 下；agent 是 python+ts 混合，只扫 ts）。 */
const SCAN_ROOTS = ["apps", "packages"];

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const isTestFile = (rel) => /\.(spec|test)\.tsx?$/.test(rel);
const isProofCore = (rel) => rel.startsWith("packages/mdop/src/attestation/");
const isTeeNode = (rel) => rel.startsWith("apps/connector/src/tee-node/");

/** R1：自述口径的字面量（属性写法 + 显式改值写法；不覆盖比较与类型联合）。 */
const R1_PATTERNS = [
  /attestationLevel\s*:\s*['"]hardware['"]/,
  /\.attestationLevel\s*=\s*['"]hardware['"]/,
];
/** R2：证明契约里的硬件级结论（属性写法；比较写作 `level === 'hardware'` 不会被误伤）。 */
const R2_PATTERN = /(?<![A-Za-z_.])level\s*:\s*['"]hardware['"]/;
/** R3：硬件飞地隔离级别（属性写法；类型联合 `'none' | 'hardware-enclave'` 不会被误伤）。 */
const R3_PATTERN = /(?<![A-Za-z_.])isolation\s*:\s*['"]hardware-enclave['"]/;

/**
 * 纯函数：对给定文件集合做判定（便于负例自检注入口径）。
 * @param {{ files: Array<{ path: string; text: string }> }} input
 */
export function runTeeClaimCheck(input) {
  const errors = [];
  for (const file of input.files) {
    const rel = file.path;
    file.text.split("\n").forEach((line, index) => {
      const at = `${rel}:${index + 1}`;
      if (R1_PATTERNS.some((p) => p.test(line)))
        errors.push(
          `[ERR] ${at}: attestationLevel 被写成 hardware —— 医院/agent 执行环境的信任级别自述必须恒 software（D9 / D-RWS-4）`,
        );
      if (R2_PATTERN.test(line) && !isTestFile(rel) && !isProofCore(rel))
        errors.push(
          `[ERR] ${at}: 证明契约之外出现 level: 'hardware' —— 硬件级结论只能由证明提供者产出（packages/mdop/src/attestation/）`,
        );
      if (R3_PATTERN.test(line) && !isTestFile(rel) && !isProofCore(rel) && !isTeeNode(rel))
        errors.push(
          `[ERR] ${at}: 医院侧执行环境出现 isolation: 'hardware-enclave' —— 没有硬件飞地就不得声明硬件隔离`,
        );
    });
  }
  return { errors, fileCount: input.files.length };
}

function main() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    for (const full of walk(join(ROOT, root), [])) {
      const rel = relative(ROOT, full);
      files.push({ path: rel, text: readFileSync(full, "utf8") });
    }
  }
  const { errors, fileCount } = runTeeClaimCheck({ files });
  for (const e of errors) console.log(e);
  console.log(`\ncheck-tee-claims: ${errors.length} error(s)（扫描 ${fileCount} 个 TS 文件）`);
  if (errors.length) process.exit(1);
}

// 仅在被直接执行时跑扫描（被 import 做自检时不跑）
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

export { ROOT, SCAN_ROOTS };
export const _internals = { walk, isTestFile, isProofCore, isTeeNode, R1_PATTERNS, R2_PATTERN, R3_PATTERN };
