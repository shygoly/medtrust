#!/usr/bin/env node
/**
 * check-crypto-imports.mjs — TRUST.md **红线清单第 1 条**（`sm-crypto` 引用白名单）的机检。
 *
 * 为什么要有这条：TRUST.md 红线 1 一直写着「守护：grep（v2 自动化）」，但**那个守护从来没被写出来**
 * （仓内既无 grep 脚本，也没有 ESLint 规则或钩子）。结果是两种坏法同时存在：
 *  ① 白名单**早已过期**——按契约字面，控制面只许 `apps/api/src/security/crypto/` 与
 *     `blockchain/adapters/chain.adapter.ts` 两处直引，实测却有 5 处（另有 `packages/mdop/src/crypto/`、
 *     `packages/wasm-algorithms/scripts/` 这层**契约里根本没提**的合法入口）；
 *  ② 没有守护 ⇒ 新增直引不会被任何人拦下，红线退化成一句愿望。
 * 本条把红线变成**可执行**的判据，并且**不偷偷放行**：现状里那几个未被契约覆盖的控制面入口
 * 一律进「**在册偏离**」（每条写明偿还方向），而不是把它们写进白名单当成合规——登记偏离是本仓
 * 既有做法（见 DECISIONS D8 对 C2 信封 AEAD 临时偏离的处理）。在册偏离**只许减少**：
 * 某个文件还清（不再直引）之后必须从名单里删掉，否则判红（防名单变成永久豁免）。
 *
 * 判据（任一不过即 error，退出码 1）：
 *  R1 出现**未登记**的 `sm-crypto` 直引 → 红（并打印该文件与命中行）；
 *  R2 **在册偏离已还清**却仍留在名单里 → 红（清账要求）；
 *  R3 白名单/在册偏离里的文件**不存在**了 → 红（名单悬空，说明路径写错或文件改名）。
 *
 * 不计入：「注释行」（`//` `*` `/*`）、`*.spec.ts` / `*.test.ts` / `__fixtures__/`（测试与夹具不是信任路径）、
 * `*.d.ts`（类型声明；本仓的 `sm-crypto.d.ts` 只是补最小环境声明）。
 *
 * 用法：`node scripts/check-crypto-imports.mjs`（`--quiet` 只输出结论）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const DEFAULT_ROOT = join(import.meta.dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.git', 'coverage', 'build', '.turbo', 'data']);

/**
 * 白名单（**经安全中枢**的合法入口）。每条都必须能说出「为什么这一处可以直接引 sm-crypto」。
 */
export const SANCTIONED = [
  {
    match: 'apps/api/src/security/crypto/',
    reason: '控制面的国密安全中枢（GMCryptoService 本体所在目录）',
  },
  {
    match: 'apps/api/src/blockchain/adapters/chain.adapter.ts',
    reason: '存证链适配器：现状白名单项，收敛方向见 docs/tech-debt.md TD-5',
  },
  {
    match: 'apps/connector/src/domain/sm3.ts',
    reason: '连接器平面唯一的 SM3 入口（该 app 无 GMCryptoService，其余连接器代码一律经此 helper）',
  },
  {
    match: 'packages/mdop/src/crypto/',
    reason: 'MDOP 共享包自带的国密原语（连接器侧使用；共享包不可能依赖 apps/api 的 Nest 服务）',
  },
  {
    match: 'packages/wasm-algorithms/scripts/',
    reason: '构建期工具脚本（不在任何运行时信任路径上）',
  },
];

/**
 * 在册偏离：**现状直引但契约未覆盖**的控制面入口。不是「合规」，是「已知、已登记、待偿还」。
 * 每条都要写清偿还方向；还清后必须删除本条（R2 会强制）。
 */
export const REGISTERED_DEVIATIONS = [
  {
    path: 'apps/api/src/common/canonical-json.ts',
    reason: '控制面第三个 SM3 入口，绕过了 GMCryptoService',
    repay: '与 GMCryptoService 收敛；难点是它是纯函数工具、拿不到注入的服务，需先定形（如把摘要函数作为参数传入）',
  },
  {
    path: 'apps/api/src/runtime/participant-identity/platform-key-store.ts',
    reason: 'KEK 归一化直接调用 sm3，绕过 GMCryptoService',
    repay: '改走 GMCryptoService.sm3（该类是 Nest 服务，可注入）',
  },
  {
    path: 'apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.ts',
    reason: '编排器内直接调用 sm3 做摘要，绕过 GMCryptoService',
    repay: '改走 GMCryptoService.sm3（同上，可注入）',
  },
];

const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);
/** 测试与夹具不是信任路径：`.spec.ts` / `.test.mjs` / `__fixtures__/` 一律不参与判据。 */
const isTestPath = (rel) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(rel) || rel.includes('__fixtures__/');
const isDecl = (rel) => rel.endsWith('.d.ts');
const IMPORT_RE = /(from\s*['"]sm-crypto['"]|require\(\s*['"]sm-crypto['"]\s*\)|import\(\s*['"]sm-crypto['"]\s*\))/;

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|cjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const isSanctioned = (rel) => SANCTIONED.find((s) => rel === s.match || rel.startsWith(s.match));
const deviationOf = (rel) => REGISTERED_DEVIATIONS.find((d) => d.path === rel);

/**
 * 跑一遍校验。返回 `{ errors, warnings, scanned, directImporters, hits }`。
 * `root` 只在负例自检里用（默认真仓）。
 */
export function runCryptoImportCheck(input = {}) {
  const ROOT = input.root ?? DEFAULT_ROOT;
  const errors = [];
  const warnings = [];
  const err = (msg) => errors.push(msg);
  const hits = []; // { path, line, text }

  for (const dir of ['apps', 'packages', 'scripts']) {
    const base = join(ROOT, dir);
    if (!existsSync(base)) continue;
    for (const file of walk(base, [])) {
      const rel = relative(ROOT, file).split('\\').join('/');
      if (isTestPath(rel) || isDecl(rel)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (isComment(line)) return;
          if (IMPORT_RE.test(line)) hits.push({ path: rel, line: i + 1, text: line.trim() });
        });
    }
  }

  const directImporters = [...new Set(hits.map((h) => h.path))].sort();

  // R1：未登记的直引
  for (const rel of directImporters) {
    if (isSanctioned(rel) || deviationOf(rel)) continue;
    const at = hits.filter((h) => h.path === rel).map((h) => h.line).join(', ');
    err(
      `未登记直引：${rel}（第 ${at} 行）——TRUST.md 红线清单第 1 条要求 sm-crypto 只出现在白名单入口里。` +
        `确属合法入口就加进白名单并写明理由；只是欠收敛就登记为「在册偏离」并写清偿还方向`,
    );
  }
  // R2：已还清却仍在册（防名单变永久豁免）
  for (const d of REGISTERED_DEVIATIONS) {
    if (!directImporters.includes(d.path))
      err(`在册偏离已还清但仍在名单里：${d.path}——请从 check-crypto-imports.mjs 的 REGISTERED_DEVIATIONS 删除`);
  }
  // R3：名单悬空（文件/目录改名后名单没跟着改）
  for (const entry of [...SANCTIONED.map((s) => s.match), ...REGISTERED_DEVIATIONS.map((d) => d.path)]) {
    if (!existsSync(join(ROOT, entry)))
      err(`名单条目路径不存在：${entry}（文件改名或删除后名单没跟着改）`);
  }

  return {
    errors,
    warnings,
    directImporters,
    hits,
    sanctioned: directImporters.filter((p) => isSanctioned(p)),
    deviations: directImporters.filter((p) => deviationOf(p)),
  };
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const r = runCryptoImportCheck();
  if (!quiet) for (const e of r.errors) console.error(`[ERR] ${e}`);
  const tail =
    `（扫描直引 ${r.directImporters.length} 个文件：白名单 ${r.sanctioned.length} / ` +
    `在册偏离 ${r.deviations.length}）`;
  if (r.errors.length === 0) {
    console.log(`check-crypto-imports: 0 error(s)${tail}`);
    process.exit(0);
  }
  console.error(`check-crypto-imports: ${r.errors.length} error(s)${tail}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
