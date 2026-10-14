import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  scanKernelPurity,
  violationPairs,
  diffAgainstBaseline,
  CANDIDATE_KERNEL_DIRS,
} from './check-kernel-purity.mjs';

/** 临时布局：给一个假的「基座目录」写几行代码，避免只测真实仓库。 */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'kp-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const DENY = ['patient', 'hospital'];

test('基座目录内出现行业词 -> 报出；按词元边界不误伤子串', () => {
  const root = fixture({
    'kernel/clean.ts': 'export const parameter = 1;\n',
    'kernel/dirty.ts': 'const patient = 1;\n',
  });
  try {
    const r = scanKernelPurity({ root, kernelDirs: ['kernel'], denylist: DENY, excludeSpecs: false });
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].file, 'kernel/dirty.ts');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('棘轮：一致 -> 无新增；缺项/计数上升 -> 新增；基线多余 -> 记为已清零', () => {
  const root = fixture({
    'kernel/a.ts': 'const patient = 1;\n',
    'kernel/b.ts': 'const hospital = 1;\n',
  });
  try {
    const r = scanKernelPurity({ root, kernelDirs: ['kernel'], denylist: DENY, excludeSpecs: false });
    const pairs = violationPairs(r);
    const keys = Object.keys(pairs);
    assert.ok(keys.length >= 2);
    assert.deepEqual(diffAgainstBaseline(r, { pairs }).regressions, []);
    assert.equal(diffAgainstBaseline(r, { pairs: {} }).regressions.length, keys.length);
    const first = keys[0];
    const lowered = { ...pairs, [first]: pairs[first] - 1 };
    assert.equal(diffAgainstBaseline(r, { pairs: lowered }).regressions.length, 1);
    const extra = { ...pairs, 'kernel/gone.ts::patient': 5 };
    const d = diffAgainstBaseline(r, { pairs: extra });
    assert.equal(d.regressions.length, 0);
    assert.equal(d.resolved.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('候选基座目录在当前仓库确实存在（棘轮基准不空）', () => {
  const r = scanKernelPurity({ root: process.cwd(), kernelDirs: CANDIDATE_KERNEL_DIRS });
  assert.ok(r.scannedFiles > 0, '扫描文件数应为正');
});
