import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildReport,
  listWorkspacePackages,
  packagesMissingLicense,
  scanMarkers,
  vendoredDirs,
} from './check-license.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lic-'));
  mkdirSync(join(root, 'packages/a'), { recursive: true });
  mkdirSync(join(root, 'packages/b'), { recursive: true });
  mkdirSync(join(root, 'vendor/foo'), { recursive: true });
  writeFileSync(join(root, 'packages/a/package.json'), JSON.stringify({ name: 'a', license: 'Apache-2.0' }));
  writeFileSync(join(root, 'packages/b/package.json'), JSON.stringify({ name: 'b' }));
  writeFileSync(join(root, 'vendor/foo/index.js'), 'module.exports = 1;');
  return root;
}

test('报告：未声明 license 的包被列出', () => {
  const root = fixture();
  const pkgs = listWorkspacePackages(root);
  assert.deepEqual(packagesMissingLicense(pkgs), ['packages/b/package.json']);
  rmSync(root, { recursive: true, force: true });
});

test('报告：vendored 目录缺 LICENSE 时标出', () => {
  const root = fixture();
  assert.deepEqual(vendoredDirs(root), [{ rel: 'vendor/foo', hasLicense: false }]);
  writeFileSync(join(root, 'vendor/foo/LICENSE'), 'MIT');
  assert.deepEqual(vendoredDirs(root), [{ rel: 'vendor/foo', hasLicense: true }]);
  rmSync(root, { recursive: true, force: true });
});

test('报告：许可制词典命中被统计', () => {
  const root = fixture();
  writeFileSync(join(root, 'packages/a/x.ts'), 'const c = "SNOMED";');
  assert.equal(scanMarkers(root).get('SNOMED')?.length, 1);
  const report = buildReport(root);
  assert.deepEqual(report.licensedDictionaries, { SNOMED: 1 });
  rmSync(root, { recursive: true, force: true });
});

test('当前仓库报告可产出（report-only，不抛）', () => {
  const report = buildReport();
  assert.ok(Array.isArray(report.missingLicense));
  assert.ok(Array.isArray(report.vendored));
});
