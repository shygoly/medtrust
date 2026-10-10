import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTheme, diffThemeTokens, parseCodeTokens, parseDocTokens } from './check-theme.mjs';

const DOC = [
  '### 1.1 色彩（Vital Ink 暗色默认主题 + 受约束的空间主题覆盖层）',
  '### 1.5 主题令牌契约（空间主题白名单）',
  '| 令牌 | 类型 |',
  '|---|---|',
  '| `logoKey` | image |',
  '| `title` | text |',
  '## 2. 状态 → 语义色',
].join('\n');
const CODE = 'export const THEME_TOKEN_WHITELIST = ["logoKey","title"] as const;';

test('解析：契约表令牌与代码白名单', () => {
  assert.deepEqual(parseDocTokens(DOC), ['logoKey', 'title']);
  assert.deepEqual(parseCodeTokens(CODE), ['logoKey', 'title']);
  assert.deepEqual(diffThemeTokens(['logoKey'], ['logoKey']), []);
});

test('负例：契约表多登记 → 报错', () => {
  assert.match(diffThemeTokens(['logoKey', 'evil'], ['logoKey'])[0], /代码白名单缺失/);
});

test('负例：代码白名单多出 → 报错', () => {
  assert.match(diffThemeTokens(['logoKey'], ['logoKey', 'rogue'])[0], /契约表未登记/);
});

test('负例：缺小节 / 缺白名单', () => {
  assert.match(diffThemeTokens(null, ['a'])[0], /缺「### 1.5/);
  assert.match(diffThemeTokens(['a'], null)[0], /缺 THEME_TOKEN_WHITELIST/);
});

test('负例：§1.1 退回"唯一主题"即报错（整链路）', () => {
  const root = mkdtempSync(join(tmpdir(), 'theme-'));
  mkdirSync(join(root, 'apps/api/src/runtime/space'), { recursive: true });
  writeFileSync(join(root, 'DESIGN.md'), [
    '### 1.1 色彩（Vital Ink 暗色主题，唯一主题）',
    '### 1.5 主题令牌契约（空间主题白名单）',
    '| 令牌 | 类型 |',
    '|---|---|',
    '| `logoKey` | image |',
    '## 2. 状态 → 语义色',
  ].join('\n'));
  writeFileSync(join(root, 'apps/api/src/runtime/space/space-theme.service.ts'),
    'export const THEME_TOKEN_WHITELIST = ["logoKey"] as const;');
  const r = checkTheme({ root });
  assert.match(r.errors.join(';'), /§1.1 标题须声明/);
  rmSync(root, { recursive: true, force: true });
});

test('正例：当前仓库契约自洽', () => {
  const r = checkTheme();
  assert.deepEqual(r.errors, []);
});
