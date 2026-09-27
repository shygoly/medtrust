// `check-software-attestation-test-kit-prod.mjs` 的负例自检：不会红的守护等于没有守护。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  KIT_PATH,
  MODULE_PATH,
  PROVIDER_PATH,
  runSoftwareAttestationTestKitProdCheck,
} from './check-software-attestation-test-kit-prod.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const real = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const withFiles = (overrides) => {
  const files = {
    [KIT_PATH]: real(KIT_PATH),
    [MODULE_PATH]: real(MODULE_PATH),
    [PROVIDER_PATH]: real(PROVIDER_PATH),
  };
  return runSoftwareAttestationTestKitProdCheck({ files: { ...files, ...overrides } });
};

const caught = (result, needle) => result.errors.some((e) => e.includes(needle));

test('真仓：0 error', () => {
  const r = runSoftwareAttestationTestKitProdCheck();
  assert.deepEqual(r.errors, []);
});

test('R1 违规：工厂不再调用守卫 → 红', () => {
  const stripped = real(KIT_PATH).replace(
    'export function createSoftwareAttestationTestKit(\n  opts: SoftwareAttestationTestKitOptions,\n): SoftwareAttestationTestKit {\n  assertSoftwareAttestationTestKitAllowed(opts.env);',
    'export function createSoftwareAttestationTestKit(\n  opts: SoftwareAttestationTestKitOptions,\n): SoftwareAttestationTestKit {\n  /* guard removed */',
  );
  const r = withFiles({ [KIT_PATH]: stripped });
  assert.ok(caught(r, 'R1'), r.errors.join('\n'));
});

test('R2 违规：守卫不再提 D9/CTL-09 / 不构成 C2 → 红', () => {
  const stripped = real(KIT_PATH)
    .replace(/D9 \/ CTL-09/g, '未登记')
    .replace(/不构成 C2/g, '可当正式证明');
  const r = withFiles({ [KIT_PATH]: stripped });
  assert.ok(caught(r, 'R2'), r.errors.join('\n'));
});

test('R3 违规：tee.module 构造测试通道 → 红', () => {
  const hijack = `${real(MODULE_PATH)}\ncreateSoftwareAttestationTestKit({ measurement: "x" });\n`;
  const r = withFiles({ [MODULE_PATH]: hijack });
  assert.ok(caught(r, 'R3'), r.errors.join('\n'));
});

test('R4 违规：生产代码调用工厂 → 红', () => {
  const r = withFiles({
    'apps/api/src/privacy/tee/__injected.ts':
      'import { createSoftwareAttestationTestKit } from "@medtrust/mdop";\n',
  });
  assert.ok(caught(r, 'R4') && caught(r, '__injected.ts'), r.errors.join('\n'));
});

test('R5 违规：硬门槛被删 → 红', () => {
  const stripped = real(PROVIDER_PATH).replace(
    'report.level !== "hardware" || report.isolation !== "hardware-enclave"',
    'false',
  );
  const r = withFiles({ [PROVIDER_PATH]: stripped });
  assert.ok(caught(r, 'R5'), r.errors.join('\n'));
});
