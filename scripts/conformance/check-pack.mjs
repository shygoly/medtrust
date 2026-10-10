#!/usr/bin/env node
/**
 * check-pack.mjs — **三方一致性套件**（D-SPD-19 / P11.3）。
 *
 * 让**包作者无需内核私有件**即可自检其能力包声明是否合规（PACK.md §1/§4）。
 * 判据：
 *   ① 必填字段齐全（id / version / domain / license / compatibleSpi / provides）
 *   ② provides 只引用**已知的六根 SPI**（写错缝名 = 装不上）
 *   ③ 包 MUST NOT 扩张**机制层**（system 算子类别、沙箱、闸门引擎须显式立决策，D-SPD-9）
 *
 * 用法：node scripts/conformance/check-pack.mjs <pack-manifest.json> [--json]
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const REQUIRED_FIELDS = [
  "id",
  "version",
  "domain",
  "license",
  "compatibleSpi",
  "provides",
];

/** 六根 SPI 的 provides 键（KERNEL.md §3）。 */
export const KNOWN_SEAMS = [
  "dataSource",
  "operators",
  "egress",
  "metering",
  "assurance",
  "terminology",
];

/** 机制层键：包声明里出现即拒（须走内核决策，D-SPD-9）。 */
export const FORBIDDEN_MECHANISM_KEYS = [
  "systemOperators",
  "mechanism",
  "sandbox",
  "egressEngine",
  "kernelPatch",
  "spaceContext",
];

const SEMVER_RANGE = /^[\^~]?\d+\.\d+\.\d+/;

export function checkPack(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["清单不是对象"];
  }
  for (const f of REQUIRED_FIELDS) {
    const v = manifest[f];
    if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
      errors.push("缺必填字段：" + f);
    }
  }
  if (typeof manifest.version === "string" && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push("version 须为语义化版本：" + manifest.version);
  }
  if (typeof manifest.compatibleSpi === "string" && !SEMVER_RANGE.test(manifest.compatibleSpi)) {
    errors.push("compatibleSpi 须为语义化版本范围：" + manifest.compatibleSpi);
  }
  const provides = manifest.provides;
  if (provides && typeof provides === "object" && !Array.isArray(provides)) {
    for (const key of Object.keys(provides)) {
      if (!KNOWN_SEAMS.includes(key)) {
        errors.push("provides 含未知缝：" + key + "（只许 " + KNOWN_SEAMS.join(" / ") + "）");
      }
    }
  } else if (provides !== undefined) {
    errors.push("provides 须为对象");
  }
  for (const k of FORBIDDEN_MECHANISM_KEYS) {
    if (k in manifest) {
      errors.push("包不得声明机制层键：" + k + "（须显式立内核决策，D-SPD-9）");
    }
  }
  return errors;
}

function main() {
  const argv = process.argv.slice(2);
  const path = argv.find((a) => !a.startsWith("--"));
  if (!path) {
    console.error("用法：node scripts/conformance/check-pack.mjs <pack-manifest.json> [--json]");
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(resolve(path), "utf8"));
  const errors = checkPack(manifest);
  if (argv.includes("--json")) console.log(JSON.stringify({ path, errors }, null, 2));
  else if (errors.length) for (const e of errors) console.error("[ERR] check-pack: " + e);
  else console.log("check-pack: 0 error(s)（" + path + " 合规）");
  process.exit(errors.length ? 1 : 0);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
