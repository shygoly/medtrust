#!/usr/bin/env node
/**
 * C2 场景追溯校验（`tee-confidential-node` / `tee-attestation-pilot`）。
 *
 * 背景：本仓最容易溜过去的一类缺口是「**规格写了、代码没做**」——2026-09-25/26 两轮就是靠人工逐条
 * 比对 spec 场景才发现的（节点阶段状态上报、C2 阶段下发前不复检证明、节点给 C0 中间制品登记对外句柄……）。
 * 本脚本把那两轮的人工做法固化成一条机器判据。
 *
 * 逐条核对三件事（任一不过即 error，退出码 1）：
 *  ① **覆盖**：变更里的每个 spec 场景都必须有且只有一条追溯记录（少一条 / 多一条 / 标题写错都判红）；
 *  ② **符号**：`ts:<路径>#<符号>` 必须真实存在（路径存在，且文件里能搜到该符号；支持 `Class.method`）；
 *  ③ **用例**：用例文件的 `it(...)` / `test(...)` / `describe(...)` 标题里必须出现给定关键词，
 *     且**该用例不是被跳过的**——只写在注释里、或只命中 `it.skip` / `xit` /
 *     `(cond ? describe : describe.skip)` 条件跳过写法，都判红（跳过的用例不算证据）。
 *
 * 表文件：`openspec/changes/tee-confidential-node/traceability.md`（两个变更共用一张表）。
 * **归档后**（`openspec archive`，两个变更的终点）：变更目录、它的 `specs/` 与这张表都会搬进
 * `openspec/changes/archive/<日期>-<名>/`，上游变更（如 `mdop-kernel`）同样会被搬走——
 * 因此本判据对「未归档」与「已归档」两种位置**都认**（变更目录、表、上游场景一律 active 优先、
 * 回退 archive；找不到或同名归档有多份一律报错，不猜）。否则归档这一步本身就会让 `pnpm test` 变红，
 * 这两个变更就永远到不了「可归档」。
 * 用法：`node scripts/check-c2-traceability.mjs`（`--quiet` 只输出结论）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const CHANGES = ['tee-confidential-node', 'tee-attestation-pilot'];
export const TABLE_RELATIVE = 'openspec/changes/tee-confidential-node/traceability.md';
const DEFAULT_ROOT = join(import.meta.dirname, '..');
const CHANGES_RELATIVE = 'openspec/changes';
const ARCHIVE_RELATIVE = 'openspec/changes/archive';
/** 归档目录名形如 `2026-09-26-mdop-kernel`；**逻辑名**＝去掉日期前缀（归档前后追溯表 id 不变）。 */
const ARCHIVE_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;

/** 归档目录下的变更清单：`{ name: 逻辑名, relative }`。 */
function archivedChanges(ROOT) {
  const root = join(ROOT, ARCHIVE_RELATIVE);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => !n.startsWith('.'))
    .map((n) => ({ name: n.replace(ARCHIVE_DATE_PREFIX, ''), relative: `${ARCHIVE_RELATIVE}/${n}` }));
}

/**
 * 定位一个变更：优先未归档路径 `openspec/changes/<名>`；不在时在 `archive/<日期>-<名>` 里**唯一**匹配。
 * 同名归档有多份 → 报错（fail-closed，不猜用哪份）。
 */
function resolveChangeDir(ROOT, name, err, ctx) {
  const active = join(ROOT, CHANGES_RELATIVE, name);
  if (existsSync(active)) return { name, relative: `${CHANGES_RELATIVE}/${name}` };
  const hits = archivedChanges(ROOT).filter((c) => c.name === name);
  if (hits.length === 1) return { name, relative: hits[0].relative };
  if (hits.length > 1)
    err(ctx, `archive/ 下有 ${hits.length} 个归档目录匹配「${name}」——无法唯一确定，请清理重复归档`);
  return null;
}

/** 收集变更里的全部场景：`<change>/<capability>#<场景标题>`。 */
function collectScenarios(ROOT, err, warn) {
  const found = new Map(); // id → spec 文件
  const modifiedCapabilities = new Set();
  for (const change of CHANGES) {
    // 归档后 specs/ 随变更一起搬进 archive/：两种位置都认。
    const located = resolveChangeDir(ROOT, change, err, change);
    if (!located) {
      err(change, `变更目录不存在（既不在 ${CHANGES_RELATIVE}/ 也不在 ${ARCHIVE_RELATIVE}/）`);
      continue;
    }
    const specsDir = join(ROOT, located.relative, 'specs');
    if (!existsSync(specsDir)) {
      err(change, `变更目录（${located.relative}）下没有 specs/`);
      continue;
    }
    for (const capability of readdirSync(specsDir).sort()) {
      const file = join(specsDir, capability, 'spec.md');
      if (!existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      // `## MODIFIED Requirements` 的能力：上游（别的变更里的同一能力）场景也必须被追溯覆盖——
      // 改了既有契约的场景，就有「碰坏上游行为」的风险，那只靠本变更自己的场景看不出来。
      if (/^## MODIFIED Requirements\s*$/m.test(text)) modifiedCapabilities.add(capability);
      for (const line of text.split('\n')) {
        const m = line.match(/^#### Scenario: (.+?)\s*$/);
        if (!m) continue;
        const id = `${change}/${capability}#${m[1]}`;
        if (found.has(id)) warn(id, '同一场景在 spec 里出现多次');
        found.set(id, { file: `${located.relative}/specs/${capability}/spec.md`, upstream: false });
      }
    }
  }
  // 上游场景：别的变更（未归档的 `openspec/changes/<c>` 与已归档的 `archive/<日期>-<c>`）里
  // 同名能力下的全部场景。id 前缀用**逻辑名**（去掉日期前缀）→ 上游归档前后追溯表的 id 不变。
  const changesDir = join(ROOT, CHANGES_RELATIVE);
  const upstreamSources = [
    ...(existsSync(changesDir)
      ? readdirSync(changesDir)
          .filter((c) => !CHANGES.includes(c) && c !== 'archive' && !c.startsWith('.'))
          .map((c) => ({ name: c, relative: `${CHANGES_RELATIVE}/${c}` }))
      : []),
    ...archivedChanges(ROOT).filter((c) => !CHANGES.includes(c.name)),
  ];
  for (const other of upstreamSources) {
    for (const capability of modifiedCapabilities) {
      const file = join(ROOT, other.relative, 'specs', capability, 'spec.md');
      if (!existsSync(file)) continue;
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^#### Scenario: (.+?)\s*$/);
        if (!m) continue;
        const id = `${other.name}/${capability}#${m[1]}`;
        if (found.has(id)) continue;
        found.set(id, { file: `${other.relative}/specs/${capability}/spec.md`, upstream: true });
      }
    }
  }
  return found;
}

/** 解析追溯表：`- id:` 起一条，随后缩进的 `symbol:` / `test:`。 */
function parseTable(tableText) {
  const entries = [];
  let current = null;
  for (const [index, line] of tableText.split('\n').entries()) {
    const idMatch = line.match(/^- id: (.+?)\s*$/);
    if (idMatch) {
      current = { id: idMatch[1], symbol: '', test: '', line: index + 1 };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    const symbol = line.match(/^\s+symbol: (.+?)\s*$/);
    if (symbol) {
      current.symbol = symbol[1];
      continue;
    }
    const test = line.match(/^\s+test: (.+?)\s*$/);
    if (test) current.test = test[1];
  }
  return entries;
}

function resolvePath(ROOT, path, ctx, err, fileOverrides) {
  if (!path) {
    err(ctx, '缺路径');
    return null;
  }
  if (fileOverrides && Object.prototype.hasOwnProperty.call(fileOverrides, path)) return { path, injected: true };
  const full = join(ROOT, path);
  if (!existsSync(full)) {
    err(ctx, `路径不存在：${path}`);
    return null;
  }
  return { path, full };
}

/** 读文件：自检注入的覆盖优先（`fileOverrides` 只给负例自检用）。 */
function readSource(ROOT, resolved, fileOverrides) {
  if (resolved.injected) return fileOverrides[resolved.path];
  return readFileSync(resolved.full, 'utf8');
}

/** 校验 `ts:路径#符号`：文件存在且文件里能搜到符号（`Class.method` 两段都要在）。 */
function checkSymbol(ROOT, token, ctx, err, fileOverrides) {
  if (!token?.startsWith('ts:')) {
    err(ctx, `symbol 必须是 ts:路径#符号（收到 ${token || '空'}）`);
    return;
  }
  const [path, symbol] = token.slice(3).split('#');
  const resolved = resolvePath(ROOT, path, ctx, err, fileOverrides);
  if (!resolved || !symbol) {
    if (!symbol) err(ctx, 'symbol 缺 #符号');
    return;
  }
  const text = readSource(ROOT, resolved, fileOverrides);
  for (const part of symbol.split('.')) {
    if (!text.includes(part)) {
      err(ctx, `符号 ${symbol} 在 ${path} 中检索不到（缺 ${part}）`);
      return;
    }
  }
}

/**
 * 校验 `ts:用例文件#关键词`：文件里必须有含该关键词的 it/test/describe 标题，**且该用例不是被跳过的**。
 *
 * 为什么要判「跳过」：只要求「标题里出现过关键词」的话，`it.skip('…关键词…')` 与
 * `(cond ? describe : describe.skip)('…关键词…')` 都会被当成证据——而它们在数据/环境缺失时
 * 根本不跑。这样一来「规格写了、用例被跳过了、追溯表还是绿的」就成了新的静默黑洞。
 * 关键词只出现在注释或普通代码里同样不算证据（这里一并判掉）。
 */
function checkTest(ROOT, token, ctx, err, fileOverrides) {
  if (!token?.startsWith('ts:')) {
    err(ctx, `test 必须是 ts:文件#关键词（收到 ${token || '空'}）`);
    return;
  }
  const [path, keyword] = token.slice(3).split('#');
  const resolved = resolvePath(ROOT, path, ctx, err, fileOverrides);
  if (!resolved || !keyword) {
    if (!keyword) err(ctx, 'test 缺 #关键词');
    return;
  }
  const text = readSource(ROOT, resolved, fileOverrides);
  // ① 直接调用：`it('…')` / `describe.skip('…')` / `xit('…')`……
  const direct = [...text.matchAll(/(?:^|[^\w.$])(xit|xdescribe|it|test|describe)((?:\.\w+)*)\s*\(\s*(['"`])([\s\S]*?)\3/g)]
    .map((m) => ({ call: `${m[1]}${m[2] ?? ''}`, title: m[4] }))
    .filter((h) => h.title.includes(keyword));
  // ② 条件跳过写法：`(cond ? describe : describe.skip)('…')`
  const conditional = [
    ...text.matchAll(/\([^()]*?\?\s*(?:it|test|describe)\s*:\s*(?:it|test|describe)\.skip\)\s*\(\s*(['"`])([\s\S]*?)\1/g),
  ]
    .map((m) => ({ call: '条件跳过（cond ? it : it.skip）', title: m[2] }))
    .filter((h) => h.title.includes(keyword));

  const isSkipped = (call) => /\.skip|\.todo/.test(call) || /^x/.test(call);
  const hits = [...direct, ...conditional];
  const live = direct.filter((h) => !isSkipped(h.call));
  if (live.length > 0) return;
  if (hits.length > 0) {
    err(
      ctx,
      `${path} 里含「${keyword}」的用例**全是跳过的**（${[...new Set(hits.map((h) => h.call))].join(' / ')}）——` +
        '跳过的用例不算证据（数据/环境缺失时它根本不跑）',
    );
    return;
  }
  {
    err(
      ctx,
      `${path} 里没有标题含「${keyword}」的 it/test/describe（该场景的用例可能被改名、删掉，或关键词只出现在注释里）`,
    );
  }
}

/**
 * 追溯表位置：优先未归档路径 `TABLE_RELATIVE`；该变更归档后回退到 `archive/<日期>-<名>/traceability.md`。
 * 找不到或同名归档有多份 → 返回 `candidates`（调用方报错，fail-closed）。
 */
export function resolveTable(ROOT = DEFAULT_ROOT) {
  const active = join(ROOT, TABLE_RELATIVE);
  if (existsSync(active)) return { path: active, relative: TABLE_RELATIVE };
  const hits = archivedChanges(ROOT)
    .filter((c) => CHANGES.includes(c.name))
    .map((c) => ({ relative: `${c.relative}/traceability.md`, path: join(ROOT, c.relative, 'traceability.md') }))
    .filter((c) => existsSync(c.path));
  if (hits.length === 1) return { path: hits[0].path, relative: hits[0].relative };
  return { path: active, relative: TABLE_RELATIVE, candidates: hits.map((h) => h.relative) };
}

/**
 * 跑一遍校验。返回 `{ errors, warnings, scenarioCount, entryCount }`。
 * `tableText` 给了就用它（自检用），否则读仓库里的表。
 */
export function runC2TraceabilityCheck(input = {}) {
  const ROOT = input.root ?? DEFAULT_ROOT;
  /** 负例自检注入的「文件内容覆盖」（path → text）；只在自检里用，正常校验为空。 */
  const fileOverrides = input.fileOverrides ?? {};
  const errors = [];
  const warnings = [];
  const err = (ctx, msg) => errors.push(`${ctx}: ${msg}`);
  const warn = (ctx, msg) => warnings.push(`${ctx}: ${msg}`);
  let tableText = input.tableText;
  if (tableText === undefined) {
    const located = input.tableRelative
      ? { path: join(ROOT, input.tableRelative), relative: input.tableRelative }
      : resolveTable(ROOT);
    if (located.candidates?.length > 1) {
      err(
        'traceability.md',
        `archive/ 下有 ${located.candidates.length} 份表（${located.candidates.join(' / ')}）——无法唯一确定`,
      );
      tableText = '';
    } else if (!existsSync(located.path)) {
      err(
        'traceability.md',
        `文件不存在（找过 ${TABLE_RELATIVE} 与 ${ARCHIVE_RELATIVE}/<日期>-${CHANGES[0]}/traceability.md）`,
      );
      tableText = '';
    } else tableText = readFileSync(located.path, 'utf8');
  }

  const scenarios = collectScenarios(ROOT, err, warn);
  // id 前缀必须是**真实存在的变更**（本变更、上游变更，或它们的归档目录）：防「变更名写错」这类静默漏项。
  const knownChanges = new Set([
    ...(existsSync(join(ROOT, CHANGES_RELATIVE))
      ? readdirSync(join(ROOT, CHANGES_RELATIVE)).filter((c) => c !== 'archive' && !c.startsWith('.'))
      : []),
    ...archivedChanges(ROOT).map((c) => c.name),
  ]);
  const entries = parseTable(tableText);
  const seen = new Set();
  for (const entry of entries) {
    const ctx = `traceability.md:${entry.line} ${entry.id}`;
    const prefix = entry.id.split('/')[0];
    if (!knownChanges.has(prefix))
      err(
        ctx,
        `id 前缀不是任何已知变更（${CHANGES.map((c) => `${c}/…`).join(' 或 ')}，或上游变更 <change>/…）`,
      );
    if (seen.has(entry.id)) err(ctx, '同一条记录出现两次');
    seen.add(entry.id);
    if (!scenarios.has(entry.id)) err(ctx, 'spec 里没有这个场景（标题写错或场景已删）');
    checkSymbol(ROOT, entry.symbol, ctx, err, fileOverrides);
    checkTest(ROOT, entry.test, ctx, err, fileOverrides);
  }
  for (const [id] of scenarios) {
    if (!seen.has(id)) err('覆盖', `场景没有追溯记录：${id}`);
  }
  const upstreamCount = [...scenarios.values()].filter((s) => s.upstream).length;
  return {
    errors,
    warnings,
    scenarioCount: scenarios.size,
    entryCount: entries.length,
    upstreamCount,
  };
}

/** CLI：直接跑仓库里的那张表。`--quiet` 只输出结论。 */
function main() {
  const quiet = process.argv.includes('--quiet');
  const result = runC2TraceabilityCheck();
  if (!quiet) {
    for (const w of result.warnings) console.warn(`[WARN] ${w}`);
    for (const e of result.errors) console.error(`[ERR] ${e}`);
  }
  const tail =
    `（${result.scenarioCount} 个场景，其中上游 ${result.upstreamCount} 个 / ` +
    `${result.entryCount} 条追溯记录）`;
  if (result.errors.length === 0) {
    console.log(
      `check-c2-traceability: 0 error(s), ${result.warnings.length} warning(s)${tail}`,
    );
    process.exit(0);
  }
  console.error(
    `check-c2-traceability: ${result.errors.length} error(s), ${result.warnings.length} warning(s)${tail}`,
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
