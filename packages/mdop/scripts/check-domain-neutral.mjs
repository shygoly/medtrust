#!/usr/bin/env node
/**
 * 领域中立性扫描（D2 / 任务 3.1）：`packages/mdop` 是协议核心，MUST NOT 出现
 * 患者、诊断、用药等医疗领域词——医疗 schema 放在调用方。
 *
 * 与 jest 里的 `src/domain-neutral.spec.ts` 同判据，提供一条不依赖 jest 的入口。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const SELF = "domain-neutral";

const TERMS = [
  "患者",
  "诊断",
  "用药",
  "医疗",
  "医院",
  "病历",
  "处方",
  "疾病",
  "病人",
  "patient",
  "diagnos",
  "medicat",
  "drug",
  "disease",
  "hospital",
  "clinical",
  "cohort",
  "synthea",
];

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

const hits = [];
for (const file of walk(SRC)) {
  if (file.includes(SELF)) continue; // 判据自身
  const text = readFileSync(file, "utf8").toLowerCase();
  for (const term of TERMS) {
    if (text.includes(term.toLowerCase())) hits.push(`${file.slice(ROOT.length + 1)}: ${term}`);
  }
}

if (hits.length) {
  for (const hit of hits) console.log(`[ERR] 领域词泄漏: ${hit}`);
  console.log(`\ncheck-domain-neutral: ${hits.length} error(s)`);
  process.exit(1);
}
console.log("check-domain-neutral: 0 error(s)（协议核心保持领域中立）");
