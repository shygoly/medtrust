// 错误码对拍的**负例自检**：把文档文本改坏，逐条断言「改坏会被抓住」。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runErrorCodeCheck } from './check-protocol-error-codes.mjs';

const ROOT = join(import.meta.dirname, '..');
const doc = readFileSync(join(ROOT, 'docs/医疗数据跨节点算子编排协议规范（MDOP）v0.2.md'), 'utf8');
const run = (docText) => runErrorCodeCheck({ root: ROOT, docText });

test('真文档：代码集合与 §11 表一一对应（0 error）', () => {
  const result = run(doc);
  assert.deepEqual(result.errors, []);
  assert.equal(result.codeCount, result.rowCount);
});

test('文档少一行 → 报「§11 表里没有这一行」', () => {
  const line = doc.match(/^\|\s*`(E_[A-Z_]+)`.*$/m)[0];
  const broken = doc.replace(line + '\n', '');
  const result = run(broken);
  assert.ok(result.errors.some((e) => e.includes('但 §11 表里没有这一行')));
});

test('文档多一行（代码里没有的码）→ 报「死条目」', () => {
  const broken = doc.replace(
    '| `E_RUNTIME` |',
    '| `E_NOT_A_REAL_CODE` | 任意 | 只存在于文档里的码 | 否 |\n| `E_RUNTIME` |',
  );
  const result = run(broken);
  assert.ok(result.errors.some((e) => e.includes('死条目')));
});

test('可重试列与代码不一致 → 报「可重试列写…」', () => {
  const broken = doc.replace(/^\| `E_RUNTIME` \|([^|]*)\|([^|]*)\| 是 \|$/m, '| `E_RUNTIME` |$1|$2| 否 |');
  assert.notEqual(broken, doc, '测试夹具没改到 E_RUNTIME 行');
  const result = run(broken);
  assert.ok(result.errors.some((e) => e.includes('可重试列写')));
});

test('§11 小节被删 → 报「找不到小节」', () => {
  const result = run(doc.replace('## 11. 错误码与异常处理', '## 11. （改名了）'));
  assert.ok(result.errors.some((e) => e.includes('找不到')));
});
