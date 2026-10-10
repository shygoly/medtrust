#!/usr/bin/env node
/**
 * plan-demo-anonymization.mjs — 真实机构名清理**计划**（P11.2 决策支撑）。
 *
 * 只做两件事：统计命中、检查映射表是否已裁决。**缺省 dry-run**；
 * 映射值留空（null）即视为未裁决——工程侧不发明替代名。
 *
 *   node scripts/plan-demo-anonymization.mjs            # 统计 + 未裁决清单
 *   node scripts/plan-demo-anonymization.mjs --check    # 未裁决即退出 1
 *   node scripts/plan-demo-anonymization.mjs --write    # 按映射应用（需先填满映射）
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MAP_PATH = "scripts/demo-alias-map.json";
const SCAN_DIRS = ["apps", "packages", "industries", "scripts", "docs", "openspec", "fly-services"];
const EXTS = /\.(ts|tsx|mjs|js|py|sql|json|md)$/;
const SKIP = /(^|\/)(node_modules|dist|build|\.git|coverage|\.next)(\/|$)/;

export function loadAliasMap(root = ROOT) {
  return JSON.parse(readFileSync(join(root, MAP_PATH), "utf8"));
}

export function unresolvedMarkers(map) {
  return Object.entries(map)
    .filter(([k]) => !k.startsWith("_"))
    .filter(([, v]) => v === null || v === undefined || v === "")
    .map(([k]) => k);
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP.test(full)) continue;
      // 不改写历史：归档变更集是过往记录（D-SPD-19 只要求不再新增真实名）。
      if (/(^|\/)archive(\/|$)/.test(full)) continue;
      yield* walk(full);
    } else if (EXTS.test(entry.name) && !full.endsWith("demo-alias-map.json")) {
      yield full;
    }
  }
}

/**
 * 扫描目标 = **git 已跟踪**的文本文件（发布面）。
 *
 * 只用跟踪清单，不遍历工作区：未跟踪的 `data/raw`、`data/synthea` 生成物有 8.5G
 * 且**不会发布**，改它们没有意义还会拖垮机器。
 * 排除：`openspec/changes/archive/**`（历史记录不改写）、`vendor/**`（第三方代码）。
 */
export function scanTargets(root = ROOT) {
  const TEXT = /\.(ts|tsx|mjs|cjs|js|json|md|py|sql|toml|yml|yaml|html|css|txt|sh)$/;
  // 无扩展名的发布面文件（Dockerfile.* / Makefile / .env.example）也在改名范围内。
  const NO_EXT = /(^|\/)(Dockerfile[^/]*|Makefile|\.env[^/]*)$/;
  try {
    const tracked = execSync("git ls-files -z", { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean);
    return tracked
      .filter((f) => !f.startsWith("openspec/changes/archive/"))
      .filter((f) => !f.startsWith("vendor/"))
      .filter((f) => TEXT.test(f) || NO_EXT.test(f))
      .map((f) => join(root, f));
  } catch {
    const targets = [];
    for (const d of SCAN_DIRS) targets.push(...walk(join(root, d)));
    for (const f of readdirSync(root)) if (f.endsWith(".md")) targets.push(join(root, f));
    return targets;
  }
}

/** 每个标记命中的文件数（dry-run）。 */
export function planCounts(root = ROOT, map = loadAliasMap(root)) {
  const markers = Object.keys(map).filter((k) => !k.startsWith("_"));
  const counts = Object.fromEntries(markers.map((m) => [m, 0]));
  for (const file of scanTargets(root)) {
    const text = readFileSync(file, "utf8");
    for (const m of markers) if (text.includes(m)) counts[m] += 1;
  }
  return counts;
}

/** 按映射应用替换（仅在 --write）。 */
export function applyAliases(root = ROOT, map = loadAliasMap(root)) {
  const pairs = Object.entries(map)
    .filter(([k, v]) => !k.startsWith("_") && v)
    .sort((a, b) => b[0].length - a[0].length); // 长标记优先，避免子串误替换
  const changed = [];
  const skipped = [];
  for (const file of scanTargets(root)) {
    let before;
    try {
      before = readFileSync(file, "utf8");
    } catch {
      skipped.push(relative(root, file) + "（不可读）");
      continue;
    }
    let after = before;
    for (const [from, to] of pairs) after = after.split(from).join(to);
    if (after === before) continue;
    try {
      writeFileSync(file, after);
      changed.push(relative(root, file));
    } catch {
      // 只读文件（如受保护的历史 POC 稿）：不改，但必须列出来，不能静默跳过。
      skipped.push(relative(root, file) + "（只读，未改写）");
    }
  }
  for (const s of skipped) console.error("[anonymize] 跳过：" + s);
  return changed;
  return changed;
}

function main() {
  const argv = process.argv.slice(2);
  const map = loadAliasMap();
  const counts = planCounts(ROOT, map);
  const unresolved = unresolvedMarkers(map);
  for (const [m, n] of Object.entries(counts)) {
    console.log("[anonymize] " + m + "： " + n + " 个文件" + (unresolved.includes(m) ? "（映射未裁决）" : ""));
  }
  console.log("[anonymize] 未裁决标记 " + unresolved.length + " 个：" + (unresolved.join(", ") || "无"));
  if (argv.includes("--check") && unresolved.length) process.exit(1);
  if (!argv.includes("--write")) {
    console.log("[anonymize] dry-run；填满 " + MAP_PATH + " 后加 --write 应用");
    return;
  }
  if (unresolved.length) {
    console.error("[anonymize] 映射仍有未裁决项，拒绝写入（fail-closed）");
    process.exit(1);
  }
  const changed = applyAliases(ROOT, map);
  console.log("[anonymize] 已改写 " + changed.length + " 个文件");
  console.log("[anonymize] 内容残留标记：" + (unresolved.length ? "有" : "无"));
}

const isMain = process.argv[1] && import.meta.url === new URL("file://" + resolve(process.argv[1])).href;
if (isMain) main();
