#!/usr/bin/env node
/**
 * check-runtime.mjs — 运行时前置检查（`pnpm dev` / `pnpm build` 会先跑它）。
 *
 * 为什么需要：`better-sqlite3` 是原生模块，编译产物与 Node 的 ABI 一一对应（Node 20 = 115，
 * Node 24 = 137）。换了 Node 却没重新 `pnpm install` 时，api / connector 启动会抛出十几行
 * "Could not locate the bindings file … Tried:"，看不出根因。本脚本把它收敛成一条可执行的提示。
 *
 *  R1 版本：当前 Node 落在根 package.json 的 engines.node 区间内；
 *  R2 ABI：当前 Node 真的能加载 better-sqlite3（dlopen + 建内存库 + 跑一条查询）。
 *
 * 归属：这是**运行环境预检**（挂在 `pnpm dev` / `pnpm build` 前），断言的是环境而非仓库内容，
 *       故不进 `pnpm test` 链，也不需要负例自检；环境不满足时它就是那个唯一会红的东西。
 *
 * 用法：node scripts/check-runtime.mjs     （非 0 退出 = 前置条件不满足，并给出修法）
 * 仓库钉住的版本见根 `.node-version`；engines 支持 `>=` `>` `<=` `<` `=`、`||` 与 `20.x` 这类主版本通配。
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const current = process.versions.node;
const abi = process.versions.modules;
const pinned = existsSync(join(root, '.node-version'))
  ? readFileSync(join(root, '.node-version'), 'utf8').trim()
  : '(未设置)';

function fail(title, lines) {
  console.error('\n✖ 运行时前置检查未通过：' + title + '\n');
  for (const line of lines) console.error('  ' + line);
  console.error('');
  process.exit(1);
}

function parseVersion(v) {
  const p = String(v).split('.').map((x) => parseInt(x, 10));
  return [p[0] || 0, p[1] || 0, p[2] || 0];
}
function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
/** 单个比较记号；无法识别返回 null（不阻塞）。 */
function tokenOk(ver, token) {
  const m = /^(>=|<=|>|<|=)?\s*v?(\d+)(?:\.(\d+|\*))?(?:\.(\d+|\*))?$/.exec(token.trim());
  if (!m) return null;
  const op = m[1] || '=';
  const bound = [];
  for (const p of [m[2], m[3], m[4]]) {
    if (p === undefined || p === '*') break;
    bound.push(Number(p));
  }
  const padded = [bound[0] ?? 0, bound[1] ?? 0, bound[2] ?? 0];
  const c = compare(ver, padded);
  switch (op) {
    case '>': return c > 0;
    case '>=': return c >= 0;
    case '<': return c < 0;
    case '<=': return c <= 0;
    default: return compare(ver.slice(0, bound.length), bound) === 0; // '=' 支持 20.x 前缀匹配
  }
}

// —— R1：engines.node ——
const range = pkg.engines?.node;
if (range) {
  const ver = parseVersion(current);
  const ok = String(range)
    .split('||')
    .some((alt) => alt.trim().split(/\s+/).filter(Boolean).every((t) => tokenOk(ver, t) !== false));
  if (!ok) {
    fail('Node 版本不在 engines.node 允许区间', [
      `当前：v${current}    允许：${range}    仓库钉住：${pinned}`,
      '',
      `请切到仓库钉住的版本：fnm use ${pinned}   （nvm / asdf 读同一个文件）`,
    ]);
  }
}

// —— R2：better-sqlite3 能否真正加载（ABI 匹配）——
const req = createRequire(join(root, 'packages/database/package.json'));
let Database;
try {
  Database = req('better-sqlite3');
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND') {
    fail('依赖未安装', ['没有找到 better-sqlite3。', '', '请先运行：pnpm install']);
  }
  fail('better-sqlite3 无法加载', [String(err.message).split('\n')[0], '', '请先运行：pnpm install']);
}
try {
  const db = new Database(':memory:');
  db.prepare('select 1 as ok').get();
  db.close();
} catch (err) {
  fail('better-sqlite3 原生模块与当前 Node 不匹配（ABI 不符）', [
    `当前 Node：v${current}（ABI ${abi}）`,
    `原因：${String(err.message).split('\n')[0]}`,
    '',
    '原生模块按 ABI 编译，换 Node 版本后必须重装。任选其一：',
    `  1) 切到仓库钉住的版本：fnm use ${pinned}`,
    '  2) 保持当前 Node 并重装依赖：pnpm install --force',
  ]);
}

console.log(`✓ 运行时前置检查通过：Node v${current}（ABI ${abi}）· better-sqlite3 可加载`);
