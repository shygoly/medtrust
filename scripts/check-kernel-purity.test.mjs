import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tokenize, scanFile, scanKernelPurity, makeDenySet, DENYLIST } from './check-kernel-purity.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kp-'));
  const kernel = join(root, 'packages', 'space-kernel');
  mkdirSync(kernel, { recursive: true });
  mkdirSync(join(root, 'industries', 'med'), { recursive: true });
  return { root, kernel };
}

test('tokenize 按词元与 camelCase 边界切分', () => {
  assert.deepEqual(tokenize('patientId'), ['patient', 'id']);
  assert.deepEqual(tokenize('cohortSize'), ['cohort', 'size']);
  assert.deepEqual(tokenize('minCell'), ['min', 'cell']);
});

test('负例：meter 不得误伤 parameter（裸子串会误判）', () => {
  assert.ok(!tokenize('parameter').includes('meter'));
  assert.ok(!tokenize('diameter').includes('meter'));
  assert.ok(tokenize('flowMeter').includes('meter'));
});

test('负例：基座文件含行业词 → 违规', () => {
  const { root, kernel } = fixture();
  const f = join(kernel, 'bad.ts');
  writeFileSync(f, 'const patientId = 1;\nexport default 1;\n');
  const hits = scanFile(f, makeDenySet(DENYLIST), false);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].token, 'patient');
  rmSync(root, { recursive: true, force: true });
});

test('正例：干净基座无违规', () => {
  const { root, kernel } = fixture();
  writeFileSync(join(kernel, 'ok.ts'), 'const total = 1;\nconst parameter = 2;\nexport { total, parameter };\n');
  const r = scanKernelPurity({ root, kernelDirs: ['packages/space-kernel'], packDirs: [] });
  assert.equal(r.violations.length, 0);
  assert.equal(r.importViolations.length, 0);
  assert.equal(r.scannedFiles, 1);
  rmSync(root, { recursive: true, force: true });
});

test('负例：基座 import 行业包 → 依赖方向违规', () => {
  const { root, kernel } = fixture();
  writeFileSync(join(kernel, 'imp.ts'), "import x from '../../industries/med/model';\nexport default x;\n");
  const r = scanKernelPurity({ root, kernelDirs: ['packages/space-kernel'] });
  assert.ok(r.importViolations.length >= 1);
  assert.match(r.importViolations[0].reason, /kernel-imports-pack:med/);
  rmSync(root, { recursive: true, force: true });
});

test('缺目录不崩：缺失目录单独报告', () => {
  const { root } = fixture();
  const r = scanKernelPurity({ root, kernelDirs: ['packages/does-not-exist'] });
  assert.deepEqual(r.kernelDirs, []);
  assert.deepEqual(r.missingDirs, ['packages/does-not-exist']);
  rmSync(root, { recursive: true, force: true });
});
