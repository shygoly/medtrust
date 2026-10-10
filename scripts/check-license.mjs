#!/usr/bin/env node
/**
 * check-license.mjs — 开源拆分前的许可与数据红线**报告**（D-SPD-19 / P11.1 / P11.2）。
 *
 * 三类事实必须可查：
 *   ① 哪些工作区包**没有声明** license 字段（内核开源前必须逐包定许可）；
 *   ② 哪些源文件出现**许可制词典**（SNOMED CT / LOINC / ICD / ATC / CIM / IEC 61850）；
 *   ③ 是否存在 **vendored 代码**（须单独核查其许可）与演示数据里的**真实机构名**。
 *
 * 缺省 **report-only（恒退出 0）**；`--strict` 才在任何一项非空时退出 1。
 * 用法：node scripts/check-license.mjs [--json] [--strict]
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 许可制词典 → 许可方；出现即须标注来源或改为运行期加载（D-SPD-19）。 */
export const LICENSED_DICTIONARIES = {
  SNOMED: "SNOMED CT（会员制许可）",
  LOINC: "LOINC（Regenstrief 许可）",
  "ICD-10": "WHO ICD-10",
  ATC: "WHO ATC",
  OMOP: "OMOP CDM（社区规范）",
  "IEC 61850": "IEC 标准（付费）",
  "CIM": "IEC 61970 CIM",
};

/** 演示数据中的真实机构名（开源前须清理或替换为合成名）。 */
export const REAL_INSTITUTION_MARKERS = [
  "华山", "瑞金", "中山医院", "协和",
  "huashan", "ruijin", "zhongshan", "xiehe",
];

const CODE_EXT = /\.(ts|tsx|js|mjs|py|json)$/;
const SKIP_DIR = /(^|\/)(node_modules|dist|build|\.git|coverage|\.next)(\/|$)/;

export function listWorkspacePackages(root = ROOT) {
  const out = [];
  for (const base of ["packages", "industries", "apps"]) {
    const dir = join(root, base);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const pkgPath = join(dir, name, "package.json");
      if (!existsSync(pkgPath)) continue;
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        out.push({ rel: relative(root, pkgPath), name: pkg.name, license: pkg.license ?? null });
      } catch {
        out.push({ rel: relative(root, pkgPath), name: null, license: null });
      }
    }
  }
  return out;
}

export function packagesMissingLicense(pkgs) {
  return pkgs.filter((p) => !p.license).map((p) => p.rel);
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR.test(full)) continue;
      yield* walk(full);
    } else if (CODE_EXT.test(entry.name)) {
      yield full;
    }
  }
}

export function scanMarkers(root = ROOT, markers = Object.keys(LICENSED_DICTIONARIES)) {
  const hits = new Map();
  for (const base of ["apps", "packages", "industries", "scripts"]) {
    for (const file of walk(join(root, base))) {
      const text = readFileSync(file, "utf8");
      for (const m of markers) {
        if (text.includes(m)) {
          const rel = relative(root, file);
          if (!hits.has(m)) hits.set(m, []);
          hits.get(m).push(rel);
        }
      }
    }
  }
  return hits;
}

export function vendoredDirs(root = ROOT) {
  const dir = join(root, "vendor");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP_DIR.test(join(dir, e.name)))
    .map((e) => ({
      rel: relative(root, join(dir, e.name)),
      hasLicense: existsSync(join(dir, e.name, "LICENSE")) || existsSync(join(dir, e.name, "LICENSE.md")),
    }));
}

export function buildReport(root = ROOT) {
  const pkgs = listWorkspacePackages(root);
  return {
    missingLicense: packagesMissingLicense(pkgs),
    licensedDictionaries: Object.fromEntries(
      [...scanMarkers(root).entries()].map(([k, v]) => [k, v.length]),
    ),
    realInstitutionNames: Object.fromEntries(
      [...scanMarkers(root, REAL_INSTITUTION_MARKERS).entries()].map(([k, v]) => [k, v.length]),
    ),
    vendored: vendoredDirs(root),
  };
}

function main() {
  const argv = process.argv.slice(2);
  const report = buildReport();
  if (argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("[license] 未声明 license 的工作区包：" + (report.missingLicense.length || "无"));
    for (const p of report.missingLicense) console.log("  - " + p);
    const dict = Object.entries(report.licensedDictionaries);
    console.log("[license] 许可制词典命中文件数：" + (dict.length ? "" : "无"));
    for (const [k, n] of dict) console.log("  - " + k + "： " + n + " 个文件（" + LICENSED_DICTIONARIES[k] + "）");
    const inst = Object.entries(report.realInstitutionNames);
    console.log("[license] 演示数据真实机构名命中：" + (inst.length ? "" : "无"));
    for (const [k, n] of inst) console.log("  - " + k + "： " + n + " 个文件");
    console.log("[license] vendored 目录：" + (report.vendored.length ? "" : "无"));
    for (const v of report.vendored) console.log("  - " + v.rel + (v.hasLicense ? "（有 LICENSE）" : "（**无 LICENSE，须核查**）"));
  }
  const strict = argv.includes("--strict");
  const dirty =
    report.missingLicense.length ||
    Object.keys(report.licensedDictionaries).length ||
    Object.keys(report.realInstitutionNames).length ||
    report.vendored.some((v) => !v.hasLicense);
  process.exit(strict && dirty ? 1 : 0);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
