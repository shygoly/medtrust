#!/usr/bin/env node
/**
 * check-software-attestation-test-kit-prod.mjs — 「软件证明测试通道不得在生产装配/非测试判据下启用」（AO-1）。
 *
 * 测试通道演练接口与管线，不构成 C2 可用性证据。生产硬门槛
 * `verifyAttestationClaims`（level=hardware）必须保持；本条只守装配与构造守卫。
 *
 * 判据（任一不过即 error，退出码 1）：
 *  R1 `createSoftwareAttestationTestKit` 必须调用 `assertSoftwareAttestationTestKitAllowed`。
 *  R2 守卫必须按 `NODE_ENV`（去空白、小写）=== `production` 抛错，且错误信息含 D9、CTL-09、
 *     「不构成 C2」。
 *  R3 `apps/api/src/privacy/tee/tee.module.ts` 不得调用 `createSoftwareAttestationTestKit`
 *     （生产装配不得启用测试通道）。
 *  R4 生产代码（非 spec/test、非本套件文件）不得出现 `createSoftwareAttestationTestKit`。
 *  R5 `verifyAttestationClaims` 的硬件硬门槛字面量必须仍在 `provider.ts`（不得被本通道改掉）。
 *
 * 用法：`node scripts/check-software-attestation-test-kit-prod.mjs`（`--quiet` 只输出结论）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const KIT_PATH = 'packages/mdop/src/attestation/software-attestation-test-kit.ts';
export const PROVIDER_PATH = 'packages/mdop/src/attestation/provider.ts';
export const MODULE_PATH = 'apps/api/src/privacy/tee/tee.module.ts';
export const PROD_SCAN_DIRS = ['apps/api/src', 'packages/mdop/src'];

const FACTORY = 'createSoftwareAttestationTestKit';
const GUARD = 'assertSoftwareAttestationTestKitAllowed';
const HARD_GATE = 'report.level !== "hardware" || report.isolation !== "hardware-enclave"';

const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * @param {{ root?: string, files?: Record<string, string> }} input
 */
export function runSoftwareAttestationTestKitProdCheck(input = {}) {
  const root = input.root ?? DEFAULT_ROOT;
  const read = (rel) => {
    if (input.files && Object.prototype.hasOwnProperty.call(input.files, rel)) return input.files[rel];
    const full = join(root, rel);
    if (!existsSync(full)) return null;
    return readFileSync(full, 'utf8');
  };

  const errors = [];
  const err = (msg) => errors.push(msg);

  const kitText = read(KIT_PATH);
  if (kitText == null) {
    err(`R1：找不到 ${KIT_PATH}`);
  } else {
    const code = stripComments(kitText);
    const factory = code.match(new RegExp(`export function ${FACTORY}[\\s\\S]*?\\n\\}`));
    if (!factory) err(`R1：${KIT_PATH} 里找不到 ${FACTORY}`);
    else if (!new RegExp(`${GUARD}\\s*\\(`).test(factory[0]))
      err(`R1：${FACTORY} 未调用 ${GUARD}——生产将能静默构造测试通道`);

    const guard = code.match(new RegExp(`export function ${GUARD}[\\s\\S]*?\\n\\}`));
    if (!guard) err(`R2：${KIT_PATH} 里找不到 ${GUARD}`);
    else {
      const body = guard[0];
      const prodPred =
        /toLowerCase\(\)\s*===\s*['"]production['"]/.test(code) || /isProductionNodeEnv\s*\(/.test(body);
      if (!prodPred) err(`R2：${GUARD} 未按 NODE_ENV===production（去空白小写）判据抛错`);
      if (!/throw\s+new\s+Error/.test(body)) err(`R2：${GUARD} 没有 throw new Error`);
    }
    if (!/\bD9\b/.test(code) || !/\bCTL-09\b/.test(code))
      err(`R2：抛错信息必须写明 D9 与 CTL-09`);
    if (!/不构成 C2/.test(code)) err(`R2：抛错信息必须写明不构成 C2 可用性证据`);
  }

  const moduleText = read(MODULE_PATH);
  if (moduleText == null) {
    err(`R3：找不到 ${MODULE_PATH}`);
  } else if (new RegExp(`\\b${FACTORY}\\b`).test(stripComments(moduleText))) {
    err(`R3：${MODULE_PATH} 调用了 ${FACTORY}——生产装配不得启用测试通道`);
  }

  const isExempt = (rel) => {
    if (rel === KIT_PATH) return true;
    if (/\.(spec|test)\.tsx?$/.test(rel)) return true;
    return false;
  };

  const walkTs = (dir, out = []) => {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walkTs(full, out);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  };

  const seen = new Set();
  for (const relDir of PROD_SCAN_DIRS) {
    for (const full of walkTs(join(root, relDir))) {
      const rel = relative(root, full).replaceAll('\\', '/');
      seen.add(rel);
      if (isExempt(rel)) continue;
      const text = read(rel);
      if (text == null) continue;
      if (new RegExp(`\\b${FACTORY}\\b`).test(stripComments(text)))
        err(`R4：${rel} 的生产代码调用了 ${FACTORY}——测试通道不得出现在生产装配`);
    }
  }
  if (input.files) {
    for (const rel of Object.keys(input.files)) {
      const norm = rel.replaceAll('\\', '/');
      if (seen.has(norm) || isExempt(norm)) continue;
      if (!PROD_SCAN_DIRS.some((d) => norm.startsWith(`${d}/`))) continue;
      if (new RegExp(`\\b${FACTORY}\\b`).test(stripComments(input.files[rel] ?? '')))
        err(`R4：${norm} 的生产代码调用了 ${FACTORY}——测试通道不得出现在生产装配`);
    }
  }

  const providerText = read(PROVIDER_PATH);
  if (providerText == null) {
    err(`R5：找不到 ${PROVIDER_PATH}`);
  } else if (!stripComments(providerText).includes(HARD_GATE)) {
    err(`R5：${PROVIDER_PATH} 的 verifyAttestationClaims 硬门槛已被改动或删除`);
  }

  return { errors };
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const r = runSoftwareAttestationTestKitProdCheck();
  if (!quiet) for (const e of r.errors) console.error(`[ERR] ${e}`);
  if (r.errors.length === 0) {
    console.log('check-software-attestation-test-kit-prod: 0 error(s)');
    process.exit(0);
  }
  console.error(`check-software-attestation-test-kit-prod: ${r.errors.length} error(s)`);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
