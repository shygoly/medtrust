import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyAliases, planCounts, unresolvedMarkers } from './plan-demo-anonymization.mjs';

function fixture(alias) {
  const root = mkdtempSync(join(tmpdir(), 'anon-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'apps'), { recursive: true });
  writeFileSync(join(root, 'scripts/demo-alias-map.json'), JSON.stringify(alias));
  writeFileSync(join(root, 'apps/x.ts'), 'const a = "华山医院";\nconst b = "瑞金医院";\n');
  return root;
}

test('未裁决标记被识别（值为 null）', () => {
  assert.deepEqual(unresolvedMarkers({ _c: 1, 华山: null, 瑞金: '广慈' }), ['华山']);
});

test('计数：按标记统计命中文件数，排除映射表自身', () => {
  const root = fixture({ 华山: null, 瑞金: null });
  const counts = planCounts(root);
  assert.equal(counts['华山'], 1);
  assert.equal(counts['瑞金'], 1);
  rmSync(root, { recursive: true, force: true });
});

test('应用：长标记优先，且映射表自身不被改写', () => {
  const root = fixture({ 华山: '云台', 中山医院: '滨江' });
  writeFileSync(join(root, 'apps/y.ts'), 'const c = "中山医院";\n');
  const changed = applyAliases(root);
  assert.deepEqual(changed.sort(), ['apps/x.ts', 'apps/y.ts']);
  const text = readFileSync(join(root, 'apps/x.ts'), 'utf8');
  assert.match(text, /云台/);
  assert.doesNotMatch(text, /华山/);
  rmSync(root, { recursive: true, force: true });
});
