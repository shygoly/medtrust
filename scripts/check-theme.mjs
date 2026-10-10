#!/usr/bin/env node
/**
 * check-theme.mjs — 主题令牌契约守护（D-SPD-15 / P7.7）。
 *
 * 判据：
 *   ① DESIGN.md「主题令牌契约」表列出的令牌集合 == 代码白名单 THEME_TOKEN_WHITELIST
 *   ② §1.1 标题仍声明"默认主题 + 受约束覆盖层"（防止悄悄退回"唯一主题"而删掉覆盖机制）
 *
 * 用法：node scripts/check-theme.mjs [--json]
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DESIGN_PATH = "DESIGN.md";
export const SERVICE_PATH = "apps/api/src/runtime/space/space-theme.service.ts";

/** 从 DESIGN.md 的主题令牌契约表解析令牌集合。 */
export function parseDocTokens(designText) {
  const section = designText.match(/### 1\.5 主题令牌契约[\s\S]*?(?=\n## )/);
  if (!section) return null;
  const tokens = [];
  for (const row of section[0].matchAll(/^\|\s*\*{0,2}`([A-Za-z][A-Za-z0-9]*)`\*{0,2}\s*\|/gm)) {
    tokens.push(row[1]);
  }
  return tokens;
}

/** 从主题服务源码解析 THEME_TOKEN_WHITELIST。 */
export function parseCodeTokens(source) {
  const block = source.match(/THEME_TOKEN_WHITELIST\s*=\s*\[([\s\S]*?)\]/);
  if (!block) return null;
  return [...block[1].matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map((m) => m[1]);
}

export function diffThemeTokens(docTokens, codeTokens) {
  const errors = [];
  if (!docTokens) { errors.push("DESIGN.md 缺「### 1.5 主题令牌契约」小节"); return errors; }
  if (!codeTokens) { errors.push("主题服务缺 THEME_TOKEN_WHITELIST"); return errors; }
  const d = new Set(docTokens);
  const c = new Set(codeTokens);
  for (const t of d) if (!c.has(t)) errors.push("契约表登记 " + t + "，代码白名单缺失");
  for (const t of c) if (!d.has(t)) errors.push("代码白名单有 " + t + "，契约表未登记");
  return errors;
}

export function checkTheme(opts = {}) {
  const designPath = join(opts.root ?? ROOT, opts.designPath ?? DESIGN_PATH);
  const servicePath = join(opts.root ?? ROOT, opts.servicePath ?? SERVICE_PATH);
  const errors = [];
  let designText = "";
  try { designText = readFileSync(designPath, "utf8"); }
  catch { errors.push("读不到 " + DESIGN_PATH); }
  let source = "";
  try { source = readFileSync(servicePath, "utf8"); }
  catch { errors.push("读不到 " + SERVICE_PATH); }
  if (errors.length) return { errors };
  errors.push(...diffThemeTokens(parseDocTokens(designText), parseCodeTokens(source)));
  if (!/1\.1 色彩（[^）]*默认[^）]*覆盖层/.test(designText)) {
    errors.push("DESIGN.md §1.1 标题须声明「默认主题 + 受约束覆盖层」");
  }
  return { errors };
}

function main() {
  const json = process.argv.includes("--json");
  const result = checkTheme();
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.errors.length) {
    for (const e of result.errors) console.error("[ERR] check-theme: " + e);
  } else {
    console.log("check-theme: 0 error(s)（主题令牌契约与代码白名单一致）");
  }
  process.exit(result.errors.length ? 1 : 0);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
