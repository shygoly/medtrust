// `check-software-tee-prod.mjs` 的**负例自检**：不会红的守护等于没有守护。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SITES,
  MODULE_PATH,
  TEE_PATH,
  runSoftwareTeeProdCheck,
} from './check-software-tee-prod.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const real = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const withFiles = (overrides) => {
  const files = {
    [TEE_PATH]: real(TEE_PATH),
    [MODULE_PATH]: real(MODULE_PATH),
  };
  for (const rel of DEFAULT_SITES) files[rel] = real(rel);
  return runSoftwareTeeProdCheck({ files: { ...files, ...overrides } });
};

const caught = (result, needle) => result.errors.some((e) => e.includes(needle));

test('真仓：0 error', () => {
  const r = runSoftwareTeeProdCheck();
  assert.deepEqual(r.errors, []);
});

test('R1 违规：构造不再调用 assertSoftwareTeeAllowed → 红', () => {
  const stripped = real(TEE_PATH).replace(
    'constructor(@Optional() private readonly audit?: AuditService) {\n    assertSoftwareTeeAllowed();\n  }',
    'constructor(@Optional() private readonly audit?: AuditService) {}',
  );
  const r = withFiles({ [TEE_PATH]: stripped });
  assert.ok(caught(r, 'R1'), r.errors.join('\n'));
});

test('R2 违规：守卫不再提 D9/CTL-09 → 红', () => {
  const stripped = real(TEE_PATH).replace(/D9 \/ CTL-09/g, '未登记');
  const r = withFiles({ [TEE_PATH]: stripped });
  assert.ok(caught(r, 'R2'), r.errors.join('\n'));
});

test('R3 违规：useValue 绕过构造 → 红', () => {
  const hijack = real(MODULE_PATH).replace(
    'SoftwareTee,',
    '{ provide: SoftwareTee, useValue: { seal() {}, run() {} } },',
  );
  const r = withFiles({ [MODULE_PATH]: hijack });
  assert.ok(caught(r, 'R3'), r.errors.join('\n'));
});

test('R4 违规：默认值改成别的类 → 红', () => {
  const rel = DEFAULT_SITES[0];
  const stripped = real(rel).replace(/new\s+SoftwareTee\s*\(/g, 'new OtherTee(');
  const r = withFiles({ [rel]: stripped });
  assert.ok(caught(r, 'R4') && caught(r, rel), r.errors.join('\n'));
});
