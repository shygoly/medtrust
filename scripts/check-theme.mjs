#!/usr/bin/env node
/**
 * check-theme.mjs — 主题令牌契约守护（D-SPD-15 / P7.7）。
 *
 * 判据：
 *   ① DESIGN.md「主题令牌契约」表列出的令牌集合 == 代码白名单 THEME_TOKEN_WHITELIST
 *   ② §1.1 标题仍声明"默认主题 + 受约束覆盖层"（防止悄悄退回"唯一主题"而删掉覆盖机制）
 *   ③ `apps/web/src` 里 `var(--cs-*)` 引用的令牌必须真的有定义——
 *      未定义时 CSS 会静默解析失败（背景变透明、颜色回落），界面"糊在一起"却不报错。
 *
 * 用法：node scripts/check-theme.mjs [--json]
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DESIGN_PATH = "DESIGN.md";
export const SERVICE_PATH = "apps/api/src/runtime/space/space-theme.service.ts";
export const WEB_SRC = "apps/web/src";

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage"]);

/** 递归列出 web 源码里的 ts / tsx / css（顺序稳定）。 */
export function listWebFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(tsx?|css)$/.test(e.name)) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

/**
 * ③ 未定义令牌：`var(--cs-xxx)` 必须有对应的 `--cs-xxx: ...` 声明。
 * 逐文件报（同一文件同一令牌只报一次），路径相对仓库根，便于定位。
 */
export function findUndefinedCsTokens(files) {
  const defined = new Set();
  for (const f of files) for (const m of f.text.matchAll(/(--cs-[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
  const errors = [];
  const seen = new Set();
  for (const f of files) {
    for (const m of f.text.matchAll(/var\((--cs-[a-z0-9-]+)/g)) {
      const token = m[1];
      const key = f.path + "|" + token;
      if (defined.has(token) || seen.has(key)) continue;
      seen.add(key);
      errors.push(`${f.path} 引用了未定义的主题令牌 ${token}（var() 会解析失败，样式静默丢失）`);
    }
  }
  return errors;
}

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
  // ③ 只在本仓完整树里检查（测试夹具没有 apps/web/src 时跳过，保持可单测）
  const webRoot = join(opts.root ?? ROOT, WEB_SRC);
  if (existsSync(webRoot)) {
    const files = listWebFiles(webRoot).map((full) => ({
      path: full.slice((opts.root ?? ROOT).length + 1).split("\\").join("/"),
      text: readFileSync(full, "utf8"),
    }));
    errors.push(...findUndefinedCsTokens(files));
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
