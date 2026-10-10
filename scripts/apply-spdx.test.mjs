import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySpdx, commentStyle, hasSpdx, headerInsertIndex, spdxHeader } from './apply-spdx.mjs';

test('幂等：已有 SPDX 行不再插入', () => {
  const text = '// SPDX-License-Identifier: MIT\nexport const a = 1;\n';
  assert.equal(hasSpdx(text), true);
  assert.equal(applySpdx(text, 'Apache-2.0', 'MedTrust'), text);
});

test('shebang MUST 留在第一行（P10 踩过的坑）', () => {
  const text = '#!/usr/bin/env node\nconsole.log(1);\n';
  assert.equal(headerInsertIndex(text), text.indexOf('\n') + 1);
  const out = applySpdx(text, 'Apache-2.0', 'MedTrust');
  assert.ok(out.startsWith('#!/usr/bin/env node\n'));
  assert.match(out.split('\n')[1], /SPDX-License-Identifier: Apache-2\.0/);
});

test('无 shebang 时插到文件开头', () => {
  const out = applySpdx('export const a = 1;\n', 'MPL-2.0', 'MedTrust');
  assert.ok(out.startsWith('// SPDX-License-Identifier: MPL-2.0\n'));
});

test('Python 用 # 注释', () => {
  assert.equal(commentStyle('a/b.py'), '#');
  assert.equal(commentStyle('a/b.ts'), '//');
  assert.match(spdxHeader('MIT', 'X', '#'), /^# SPDX-License-Identifier: MIT/);
});
