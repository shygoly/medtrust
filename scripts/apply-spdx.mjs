#!/usr/bin/env node
/**
 * apply-spdx.mjs — SPDX 头批量补齐（P11.1 **决策支撑**；缺省 dry-run）。
 *
 * 许可 id 与版权行由**调用方**给出：工程侧不预设任何许可——
 * 许可选择是商业/法务决定（见 KERNEL.md §6）。
 *
 *   node scripts/apply-spdx.mjs --license Apache-2.0 --holder "MedTrust" --dry-run
 *   node scripts/apply-spdx.mjs --license Apache-2.0 --holder "MedTrust" --write
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const SPDX_RE = /SPDX-License-Identifier/;
export const DEFAULT_DIRS = ["packages/space-kernel", "packages/space-kernel-spi", "industries"];

export function hasSpdx(text) {
  return SPDX_RE.test(text);
}

/** 注释风格：.py/.sh 用 #，其余用 //。 */
export function commentStyle(file) {
  return /\.(py|sh)$/.test(file) ? "#" : "//";
}

/**
 * 头部插入点：**shebang MUST 留在第一行**。
 * （P10 期间正是把 import 插到 shebang 前导致编译失败——这里显式处理并测试。）
 */
export function headerInsertIndex(text) {
  return text.startsWith("#!") ? text.indexOf("\n") + 1 : 0;
}

export function spdxHeader(license, holder, style = "//") {
  return (
    style + " SPDX-License-Identifier: " + license + "\n" +
    style + " SPDX-FileCopyrightText: " + holder + "\n"
  );
}

/** 幂等：已有 SPDX 行则原样返回。 */
export function applySpdx(text, license, holder) {
  if (hasSpdx(text)) return text;
  const idx = headerInsertIndex(text);
  return text.slice(0, idx) + spdxHeader(license, holder, commentStyle("")) + text.slice(idx);
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mjs|js|py)$/.test(entry.name)) yield full;
  }
}

/** 计划：哪些文件缺 SPDX 头（dry-run 用）。 */
export function planSpdx(root = process.cwd(), dirs = DEFAULT_DIRS) {
  const need = [];
  const have = [];
  for (const d of dirs) {
    for (const file of walk(join(root, d))) {
      const text = readFileSync(file, "utf8");
      (hasSpdx(text) ? have : need).push(relative(root, file));
    }
  }
  return { need: need.sort(), have: have.sort() };
}

/** 应用（仅在 --write 时调用）。 */
export function applyToFiles(root, dirs, license, holder) {
  const changed = [];
  for (const d of dirs) {
    for (const file of walk(join(root, d))) {
      const text = readFileSync(file, "utf8");
      if (hasSpdx(text)) continue;
      const idx = headerInsertIndex(text);
      const next = text.slice(0, idx) + spdxHeader(license, holder, commentStyle(file)) + text.slice(idx);
      writeFileSync(file, next);
      changed.push(relative(root, file));
    }
  }
  return changed;
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const license = arg("--license");
  const holder = arg("--holder");
  const write = argv.includes("--write");
  if (!license || !holder) {
    console.error('用法：node scripts/apply-spdx.mjs --license <SPDX-ID> --holder "<版权行>" [--write]');
    process.exit(2);
  }
  const plan = planSpdx();
  if (!write) {
    console.log("[spdx] dry-run：缺 SPDX 头的文件 " + plan.need.length + " 个，已有 " + plan.have.length + " 个");
    for (const f of plan.need.slice(0, 30)) console.log("  - " + f);
    if (plan.need.length > 30) console.log("  ... 其余 " + (plan.need.length - 30) + " 个省略");
    console.log("[spdx] 加 --write 才会写入（许可 = " + license + "，版权 = " + holder + "）");
    return;
  }
  const changed = applyToFiles(process.cwd(), DEFAULT_DIRS, license, holder);
  console.log("[spdx] 已写入 " + changed.length + " 个文件");
}

const isMain = process.argv[1] && import.meta.url === new URL("file://" + resolve(process.argv[1])).href;
if (isMain) main();
