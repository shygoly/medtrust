#!/usr/bin/env node
/**
 * 错误码对拍：`packages/mdop/src/errors.ts`（代码里的权威集合）↔ 协议 §11 错误码表（文档里的正册）。
 *
 * 为什么需要它：本仓的铁律是「**元语与代码同批落地**」。错误码是最容易悄悄分叉的一处——
 * 2026-09-26 实测就发现代码里有 4 个码（`E_MEASUREMENT_NOT_ALLOWED` / `E_TCB_TOO_OLD` /
 * `E_KEY_RELEASE_DENIED` / `E_ENVELOPE_POLICY`）**根本不在协议 §11 的表里**：
 * 它们在 §9.3/§9.6 的正文里被提到，但读错误码表的人（尤其外部实现方）看不到。
 *
 * 判据（任一不过即 error）：
 *  ① 代码里出现的每个码都必须在 §11 表里有一行；
 *  ② §11 表里的每一行也必须在代码集合里（防「文档写了代码没有」）；
 *  ③ 表中「可重试」列必须与 `errors.ts` 的 `RETRYABLE` 标记一致（是/否；「视原因」按 `RETRYABLE=false` 处理，
 *     因为缺省是 fail-closed，可重试与否由具体原因决定——这一列写成「视原因」不算错）。
 *
 * 用法：`node scripts/check-protocol-error-codes.mjs`（`--quiet` 只输出结论）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ERRORS_TS = 'packages/mdop/src/errors.ts';
const PROTOCOL = 'docs/医疗数据跨节点算子编排协议规范（MDOP）v0.2.md';
const SECTION_START = '## 11. 错误码与异常处理';
const SECTION_END = '## 12.';
const DEFAULT_ROOT = join(import.meta.dirname, '..');

/** 从 `errors.ts` 里抽 `MDOP_ERROR_CODES` 与 `RETRYABLE`。 */
export function parseErrorCodes(enumText) {
  const codes = [...enumText.matchAll(/^\s+"(E_[A-Z_]+)",$/gm)].map((m) => m[1]);
  const retryable = new Map();
  for (const line of enumText.split('\n')) {
    const m = line.match(/^\s+(E_[A-Z_]+):\s*(true|false),\s*$/);
    if (m) retryable.set(m[1], m[2] === 'true');
  }
  return { codes, retryable };
}

/** 从协议 §11 表里抽 `| \`E_x\` | 阶段 | 含义 | 可重试 |` 行。 */
export function parseProtocolTable(docText) {
  const start = docText.indexOf(SECTION_START);
  if (start < 0) return null;
  const rest = docText.slice(start);
  const end = rest.indexOf(SECTION_END);
  const section = end >= 0 ? rest.slice(0, end) : rest;
  const rows = [];
  for (const line of section.split('\n')) {
    const m = line.match(/^\|\s*`(E_[A-Z_]+)`\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*$/);
    if (m) rows.push({ code: m[1], stage: m[2], meaning: m[3], retryable: m[4] });
  }
  return rows;
}

/** 跑一遍对拍。返回 `{ errors, warnings, codeCount, rowCount }`。 */
export function runErrorCodeCheck(input = {}) {
  const ROOT = input.root ?? DEFAULT_ROOT;
  const errors = [];
  const warnings = [];
  const err = (ctx, msg) => errors.push(`${ctx}: ${msg}`);

  const enumText = input.enumText ?? readFileSync(join(ROOT, ERRORS_TS), 'utf8');
  const docText =
    input.docText ??
    (existsSync(join(ROOT, PROTOCOL)) ? readFileSync(join(ROOT, PROTOCOL), 'utf8') : '');
  const { codes, retryable } = parseErrorCodes(enumText);
  if (codes.length === 0) err(ERRORS_TS, '没解析出任何错误码（集合被改名或格式变了？）');
  const rows = parseProtocolTable(docText);
  if (!rows) {
    err(PROTOCOL, `找不到「${SECTION_START}」小节`);
    return { errors, warnings, codeCount: codes.length, rowCount: 0 };
  }
  if (rows.length === 0) err(PROTOCOL, '§11 错误码表解析为 0 行（表被改名或格式变了？）');

  const docCodes = new Set(rows.map((r) => r.code));
  for (const code of codes) {
    if (!docCodes.has(code)) err(PROTOCOL, `代码里有 ${code}，但 §11 表里没有这一行（元语与代码分叉）`);
  }
  const codeSet = new Set(codes);
  for (const row of rows) {
    if (!codeSet.has(row.code)) err(ERRORS_TS, `§11 表里有 ${row.code}，但代码集合里没有（死条目）`);
    const expected = retryable.get(row.code);
    if (expected === undefined) continue;
    const text = row.retryable.replace(/\s/g, '');
    const declared = text.startsWith('是') || text.startsWith('视原因') ? undefined : text.startsWith('否') ? false : undefined;
    // 「视原因」= 由具体原因决定（代码里按不可重试处理，fail-closed），不算错
    if (declared === undefined && !text.startsWith('视原因') && !text.startsWith('是')) {
      warnings.push(`${row.code}: 可重试列写法无法判定（${row.retryable}），跳过一致性检查`);
      continue;
    }
    if (declared !== undefined && declared !== expected)
      err(PROTOCOL, `${row.code} 的可重试列写「${row.retryable}」，但代码里 RETRYABLE=${expected}`);
  }
  return { errors, warnings, codeCount: codes.length, rowCount: rows.length };
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const result = runErrorCodeCheck();
  if (!quiet) {
    for (const w of result.warnings) console.warn(`[WARN] ${w}`);
    for (const e of result.errors) console.error(`[ERR] ${e}`);
  }
  const tail = `（${result.codeCount} 个码 / §11 表 ${result.rowCount} 行）`;
  if (result.errors.length === 0) {
    console.log(`check-protocol-error-codes: 0 error(s), ${result.warnings.length} warning(s)${tail}`);
    process.exit(0);
  }
  console.error(
    `check-protocol-error-codes: ${result.errors.length} error(s), ${result.warnings.length} warning(s)${tail}`,
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
