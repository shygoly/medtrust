#!/usr/bin/env node
/**
 * check-software-tee-prod.mjs — 「生产不得静默注入软件 TEE」的机检（T3 / D9 / CTL-09 / D-CN-2）。
 *
 * `check-tee-claims.mjs` 的 R1/R2/R3 只查 `level:'hardware'` / `isolation:'hardware-enclave'`
 * 字面量出现在哪个目录，**不查装配用的是不是软件实现**。硬件化之后，4 处
 * `= new SoftwareTee()` 默认值会继续静默走软件路径——本条把这条缺口做成确定性规则（AO-1）。
 *
 * 判据（任一不过即 error，退出码 1）：
 *  R1 `SoftwareTee` 构造必须调用 `assertSoftwareTeeAllowed`（构造即守卫；默认参数同样走这里）。
 *  R2 `assertSoftwareTeeAllowed` 必须按 `NODE_ENV`（去空白、小写）=== `production` 抛错，
 *     且错误信息含 D9 与 CTL-09（与 tee-node/config.ts 的生产判据对齐）。
 *  R3 `app.module.ts` 不得用 `provide: SoftwareTee` + `useValue` / `useClass` 绕过构造
 *     （那会跳过守卫，让生产装配静默拿到软件替身）。
 *  R4 4 处默认值调用点必须仍写 `new SoftwareTee(`——换别的类就不再受本守卫约束。
 *
 * 为什么不写「app.module 不得列出 SoftwareTee」：同一模块服务开发与生产；
 * 生产 fail-closed 靠构造守卫。列出类 provider 是合法的——生产构造会炸掉。
 *
 * 用法：`node scripts/check-software-tee-prod.mjs`（`--quiet` 只输出结论）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const TEE_PATH = 'apps/connector/src/domain/tee.ts';
export const MODULE_PATH = 'apps/connector/src/app.module.ts';
export const DEFAULT_SITES = [
  'apps/connector/src/domain/rws-executor.ts',
  'apps/connector/src/domain/causal/causal-executor.ts',
  'apps/connector/src/domain/algorithm-validation-executor.ts',
  'apps/connector/src/domain/algorithm-validation/confusion-matrix.ts',
];

const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * @param {{ root?: string, files?: Record<string, string> }} input
 *   `files` 覆写相对路径内容（负例自检用）；缺省读真仓。
 */
export function runSoftwareTeeProdCheck(input = {}) {
  const root = input.root ?? DEFAULT_ROOT;
  const read = (rel) => {
    if (input.files && Object.prototype.hasOwnProperty.call(input.files, rel)) return input.files[rel];
    const full = join(root, rel);
    if (!existsSync(full)) return null;
    return readFileSync(full, 'utf8');
  };

  const errors = [];
  const err = (msg) => errors.push(msg);

  const teeText = read(TEE_PATH);
  if (teeText == null) {
    err(`R1：找不到 ${TEE_PATH}`);
  } else {
    const code = stripComments(teeText);
    const cls = code.match(/export class SoftwareTee[\s\S]*?\n  seal\s*\(/);
    if (!cls) err(`R1：${TEE_PATH} 里找不到 SoftwareTee 类（或 seal 被挪走）`);
    else if (!/constructor[\s\S]*assertSoftwareTeeAllowed\s*\(/.test(cls[0]))
      err(`R1：SoftwareTee 构造未调用 assertSoftwareTeeAllowed——生产默认值将静默生效`);

    const guard = code.match(/export function assertSoftwareTeeAllowed[\s\S]*?\n\}/);
    if (!guard) err(`R2：${TEE_PATH} 里找不到 assertSoftwareTeeAllowed`);
    else {
      const body = guard[0];
      const prodPred =
        /toLowerCase\(\)\s*===\s*['"]production['"]/.test(code) || /isProductionNodeEnv\s*\(/.test(body);
      if (!prodPred) err(`R2：assertSoftwareTeeAllowed 未按 NODE_ENV===production（去空白小写）判据抛错`);
      if (!/throw\s+new\s+Error/.test(body)) err(`R2：assertSoftwareTeeAllowed 没有 throw new Error`);
    }
    if (!/\bD9\b/.test(code) || !/\bCTL-09\b/.test(code))
      err(`R2：抛错信息必须写明 D9 与 CTL-09（软件实现无隔离、不得作为 C2 目标）`);
  }

  const moduleText = read(MODULE_PATH);
  if (moduleText == null) {
    err(`R3：找不到 ${MODULE_PATH}`);
  } else {
    const code = stripComments(moduleText);
    const bypass = /provide\s*:\s*SoftwareTee[\s\S]{0,400}use(?:Value|Class)\s*:/;
    if (bypass.test(code))
      err(`R3：${MODULE_PATH} 用 useValue/useClass 装配 SoftwareTee——会绕过构造守卫`);
  }

  for (const rel of DEFAULT_SITES) {
    const text = read(rel);
    if (text == null) {
      err(`R4：找不到默认值调用点 ${rel}`);
      continue;
    }
    if (!/new\s+SoftwareTee\s*\(/.test(stripComments(text)))
      err(`R4：${rel} 不再写 new SoftwareTee(——换实现必须走同一构造守卫，或同步改本守护`);
  }

  return { errors };
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const r = runSoftwareTeeProdCheck();
  if (!quiet) for (const e of r.errors) console.error(`[ERR] ${e}`);
  if (r.errors.length === 0) {
    console.log('check-software-tee-prod: 0 error(s)');
    process.exit(0);
  }
  console.error(`check-software-tee-prod: ${r.errors.length} error(s)`);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
