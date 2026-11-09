import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTheme, diffThemeTokens, findUndefinedCsTokens, parseCodeTokens, parseDocTokens } from './check-theme.mjs';

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

test('③ 未定义令牌：var(--cs-xxx) 必须真有声明（弹层变透明的根因）', () => {
  const files = [
    { path: 'apps/web/src/app/x.css', text: '.cs { --cs-bg: black; }' },
    { path: 'apps/web/src/components/bell.tsx', text: 'style={{ background: "var(--cs-panel)" }}' },
    { path: 'apps/web/src/components/ok.tsx', text: 'style={{ color: "var(--cs-bg)" }}' },
  ];
  const errors = findUndefinedCsTokens(files);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /bell\.tsx.*--cs-panel/);
});

test('③ 同一文件同一令牌只报一次；带 fallback 也照报（fallback 会掩盖错误）', () => {
  const files = [
    { path: 'apps/web/src/a.tsx', text: 'var(--cs-border, #ddd) var(--cs-border, #ddd)' },
  ];
  const errors = findUndefinedCsTokens(files);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /--cs-border/);
});

test('③ 整链路：源码树里出现未定义令牌时 checkTheme 报错', () => {
  const root = mkdtempSync(join(tmpdir(), 'theme3-'));
  mkdirSync(join(root, 'apps/api/src/runtime/space'), { recursive: true });
  mkdirSync(join(root, 'apps/web/src/components'), { recursive: true });
  writeFileSync(join(root, 'DESIGN.md'), [
    '### 1.1 色彩（Vital Ink 暗色默认主题 + 受约束的空间主题覆盖层）',
    '### 1.5 主题令牌契约（空间主题白名单）',
    '| 令牌 | 类型 |',
    '|---|---|',
    '| `logoKey` | image |',
    '## 2. 状态 → 语义色',
  ].join('\n'));
  writeFileSync(join(root, 'apps/api/src/runtime/space/space-theme.service.ts'),
    'export const THEME_TOKEN_WHITELIST = ["logoKey"] as const;');
  writeFileSync(join(root, 'apps/web/src/app.css'), '.cs { --cs-bg: black; }');
  writeFileSync(join(root, 'apps/web/src/components/pop.tsx'),
    'export const s = { background: "var(--cs-panel)" };');
  const r = checkTheme({ root });
  assert.match(r.errors.join(';'), /未定义的主题令牌 --cs-panel/);
  rmSync(root, { recursive: true, force: true });
});
