// 错误码对拍的**负例自检**：把文档文本改坏，逐条断言「改坏会被抓住」。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runErrorCodeCheck, latestProtocolDoc } from './check-protocol-error-codes.mjs';

const ROOT = join(import.meta.dirname, '..');
// 夹具取**正册**（版本号最大的那份），与守护同一个解析器：协议升版时自检跟着走，
// 不会像 2026-10-16 那样——守护留在 v0.2，把 v0.3 的三个新码误报成分叉，自检也跟着红。
const DOC_PATH = latestProtocolDoc(ROOT);
const doc = readFileSync(join(ROOT, DOC_PATH), 'utf8');
const run = (docText) => runErrorCodeCheck({ root: ROOT, docText });

test('正册是版本号最大的协议文档（不留在被取代的版本上）', () => {
  assert.match(DOC_PATH, /v(\d+)\.(\d+)\.md$/);
  const [major, minor] = DOC_PATH.match(/v(\d+)\.(\d+)\.md$/).slice(1).map(Number);
  const versions = readdirSync(join(ROOT, 'docs'))
    .map((n) => n.match(/（MDOP）v(\d+)\.(\d+)\.md$/))
    .filter(Boolean)
    .map((m) => [Number(m[1]), Number(m[2])]);
  for (const [M, m] of versions) {
    assert.ok(major > M || (major === M && minor >= m), `正册 ${DOC_PATH} 落后于 v${M}.${m}`);
  }
});

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
