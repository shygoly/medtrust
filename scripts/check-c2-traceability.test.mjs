// 追溯校验器的**负例自检**：一个不会红的校验器等于没有校验。
//
// 这里改的是**表**（把真表复制一份再破坏），不是仓库里的文件：
//  ① 真表 → 0 error；② 删掉一条记录 → 报「场景没有追溯记录」；
//  ③ 符号改成不存在的 → 报「检索不到」；④ 关键词改成不存在的 → 报「没有标题含…」。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { runC2TraceabilityCheck, TABLE_RELATIVE } from './check-c2-traceability.mjs';

const ROOT = join(import.meta.dirname, '..');
const table = readFileSync(join(ROOT, TABLE_RELATIVE), 'utf8');

const run = (text, fileOverrides) => runC2TraceabilityCheck({ root: ROOT, tableText: text, fileOverrides });

/** 把第一条记录的 `test:` 指向一个**注入文件**，用于验证「用例是否真算证据」这条判据。 */
const KEYWORD = '被跳过的场景证据';
const INJECTED = 'apps/api/src/mdop/__injected__.spec.ts';
const withInjectedTestRow = (text) =>
  text.replace(/^(  test: ts:)(\S+)$/m, `$1${INJECTED}#${KEYWORD}`);

test('真表：0 error（两个变更的每个场景都指向真实符号与真实用例）', () => {
  const result = run(table);
  assert.deepEqual(result.errors, []);
  assert.ok(result.scenarioCount > 0);
  assert.equal(result.entryCount, result.scenarioCount);
});

test('删掉一条记录 → 该场景被判定为「没有追溯记录」', () => {
  const [id] = table.match(/- id: (.+)/)[1].split('\n');
  const broken = table.replace(
    new RegExp(`- id: ${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=\\n- id: |\\n\\n### |\\n## |$)`),
    '',
  );
  const result = run(broken);
  assert.ok(result.errors.some((e) => e.includes('场景没有追溯记录')));
});

test('符号改成不存在的 → 报「检索不到」', () => {
  const broken = table.replace(
    /^(  symbol: ts:)(\S+)$/m,
    (_, prefix, token) => `${prefix}${token.split('#')[0]}#ThisSymbolDoesNotExist`,
  );
  const result = run(broken);
  assert.ok(result.errors.some((e) => e.includes('ThisSymbolDoesNotExist')));
});

test('用例关键词改成不存在的 → 报「没有标题含…」', () => {
  const broken = table.replace(
    /^(  test: ts:)(\S+)$/m,
    (_, prefix, token) => `${prefix}${token.split('#')[0]}#这段话不可能是任何用例标题`,
  );
  const result = run(broken);
  assert.ok(result.errors.some((e) => e.includes('没有标题含')));
});

test('场景标题被写错（spec 里没有这个场景）→ 报「spec 里没有这个场景」', () => {
  const broken = table.replace(/^- id: (.+)$/m, '- id: tee-confidential-node/mdop-protocol#不存在的场景');
  const result = run(broken);
  assert.ok(result.errors.some((e) => e.includes('spec 里没有这个场景')));
});

test('用例被 it.skip 跳过 → 不算证据（否则「规格写了、用例skipped、追溯表还绿」就是新黑洞）', () => {
  const result = run(withInjectedTestRow(table), {
    [INJECTED]: `it.skip('${KEYWORD}', () => {});\n`,
  });
  assert.ok(result.errors.some((e) => e.includes('全是跳过的')));
});

test('用例被条件跳过（cond ? it : it.skip）→ 同样不算证据', () => {
  const result = run(withInjectedTestRow(table), {
    [INJECTED]: `(hasData ? describe : describe.skip)('${KEYWORD}', () => {});\n`,
  });
  assert.ok(result.errors.some((e) => e.includes('全是跳过的')));
});

test('关键词只出现在注释里 → 报「没有标题含…」（不再是「文件里出现过就算」）', () => {
  const result = run(withInjectedTestRow(table), {
    [INJECTED]: `// ${KEYWORD}\nit('另一个用例', () => {});\n`,
  });
  assert.ok(result.errors.some((e) => e.includes('没有标题含')));
});

test('真用例（非跳过）指向同一关键词 → 该条通过（判据不会把正常用例判红）', () => {
  const result = run(withInjectedTestRow(table), {
    [INJECTED]: `it('${KEYWORD}', () => {});\n`,
  });
  assert.deepEqual(result.errors, []);
});

// ── 归档后的布局（2026-09-26 补） ─────────────────────────────────────────────
// 两个变更的终点是 `openspec archive`：这一步会把变更目录（连同 specs/ 与这张表）搬进
// `openspec/changes/archive/<日期>-<名>/`，上游 `mdop-kernel` 同样会被搬走。
// 判据必须跨过归档边界继续成立——否则「归档」这个动作本身就会把 `pnpm test` 弄红，
// 两个变更就永远到不了「可归档」（归档即红）。下面直接构造归档后的布局来钉这件事。
const ARCHIVED_TABLE = `## tee-confidential-node

### spec: local-plan-review

- id: tee-confidential-node/local-plan-review#本变更复核场景
  symbol: ts:fixture/sym.ts#SymA
  test: ts:fixture/case.spec.ts#复核用例
- id: tee-confidential-node/node-artifact-lifecycle#本变更销毁场景
  symbol: ts:fixture/sym.ts#SymE
  test: ts:fixture/case.spec.ts#本变更销毁用例

### 上游 spec: mdop-kernel/local-plan-review

- id: mdop-kernel/local-plan-review#上游复核场景
  symbol: ts:fixture/sym.ts#SymB
  test: ts:fixture/case.spec.ts#上游复核用例
- id: mdop-kernel/node-artifact-lifecycle#上游销毁场景
  symbol: ts:fixture/sym.ts#SymC
  test: ts:fixture/case.spec.ts#上游销毁用例

## tee-attestation-pilot

- id: tee-attestation-pilot/attestation-provider#试点场景
  symbol: ts:fixture/sym.ts#SymD
  test: ts:fixture/case.spec.ts#试点用例
`;

const ARCHIVED_LAYOUT = {
  'openspec/changes/archive/2026-09-26-mdop-kernel/specs/local-plan-review/spec.md':
    '## ADDED Requirements\n\n### Requirement: 七项本地复核\n\n#### Scenario: 上游复核场景\n',
  'openspec/changes/archive/2026-09-26-mdop-kernel/specs/node-artifact-lifecycle/spec.md':
    '## ADDED Requirements\n\n### Requirement: 销毁指令与销毁回执\n\n#### Scenario: 上游销毁场景\n',
  'openspec/changes/archive/2026-09-26-tee-confidential-node/specs/local-plan-review/spec.md':
    '## MODIFIED Requirements\n\n### Requirement: 七项本地复核\n\n#### Scenario: 本变更复核场景\n',
  'openspec/changes/archive/2026-09-26-tee-confidential-node/specs/node-artifact-lifecycle/spec.md':
    '## MODIFIED Requirements\n\n### Requirement: 销毁指令与销毁回执\n\n#### Scenario: 本变更销毁场景\n',
  'openspec/changes/archive/2026-09-26-tee-confidential-node/traceability.md': ARCHIVED_TABLE,
  'openspec/changes/tee-attestation-pilot/specs/attestation-provider/spec.md':
    '## ADDED Requirements\n\n### Requirement: 证明提供者\n\n#### Scenario: 试点场景\n',
  'fixture/sym.ts':
    'export const SymA = 1;\nexport const SymB = 2;\nexport const SymC = 3;\nexport const SymD = 4;\nexport const SymE = 5;\n',
  'fixture/case.spec.ts':
    "it('复核用例', () => {});\nit('本变更销毁用例', () => {});\nit('上游复核用例', () => {});\nit('上游销毁用例', () => {});\nit('试点用例', () => {});\n",
};

/** 造一棵「变更与上游都已归档」的最小仓。`extra` 用来注入负例。 */
function buildArchivedFixture(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'c2-trace-archive-'));
  for (const [rel, text] of Object.entries({ ...ARCHIVED_LAYOUT, ...extra })) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

const withFixture = (fn, extra) => {
  const root = buildArchivedFixture(extra);
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test('归档后布局（变更与上游都在 archive/）→ 判据仍成立：0 error、上游照数', () => {
  withFixture((root) => {
    const result = runC2TraceabilityCheck({ root });
    assert.deepEqual(result.errors, []);
    assert.equal(result.entryCount, 5);
    assert.equal(result.upstreamCount, 2);
  });
});

test('归档后布局：表在 active 与 archive 都没有 → 报「文件不存在」（不静默放过）', () => {
  const root = buildArchivedFixture();
  try {
    rmSync(join(root, 'openspec/changes/archive/2026-09-26-tee-confidential-node/traceability.md'));
    const result = runC2TraceabilityCheck({ root });
    assert.ok(result.errors.some((e) => e.includes('文件不存在')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('归档后布局：id 前缀既不是未归档变更也不是归档变更 → 照旧报「不是任何已知变更」', () => {
  withFixture((root) => {
    const result = runC2TraceabilityCheck({
      root,
      tableText: ARCHIVED_TABLE.replace(
        'tee-attestation-pilot/attestation-provider#试点场景',
        'ghost-change/attestation-provider#试点场景',
      ),
    });
    assert.ok(result.errors.some((e) => e.includes('不是任何已知变更')));
  });
});

test('同名变更有两份归档 → 报「无法唯一确定」（fail-closed，不猜用哪份）', () => {
  withFixture(
    (root) => {
      const result = runC2TraceabilityCheck({ root });
      assert.ok(result.errors.some((e) => e.includes('无法唯一确定')));
    },
    { 'openspec/changes/archive/2026-09-27-tee-confidential-node/traceability.md': ARCHIVED_TABLE },
  );
});
