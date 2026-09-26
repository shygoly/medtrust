// 闸 2 —— 复现构建 + 平台签名 + 语言白名单（tasks 1.1 / 1.2 / 1.4 + 「不设 Tier C」负例）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AdmissionError,
  admitBinaryOnly,
  reproduceAndGate,
} from './admission.mjs';
import {
  UnsupportedLanguageError,
  assertSourceLanguage,
  detectLanguage,
} from './toolchains.mjs';
import { spawnSync } from 'node:child_process';

// Rust 工具链不在的环境（部分 CI）跳过真构建用例——但**不**跳过白名单/负例，
// 那些是纯逻辑判据，任何环境都必须绿。
const HAS_RUST =
  spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' })
    .stdout?.includes('wasm32-unknown-unknown');
const rustTest = HAS_RUST ? test : test.skip;

test('语言白名单只认 Rust / AssemblyScript', () => {
  assert.equal(assertSourceLanguage('rust'), 'rust');
  assert.equal(assertSourceLanguage('assemblyscript'), 'assemblyscript');
  for (const bad of ['python', 'c', 'go', 'wasm', 'javascript', '']) {
    assert.throws(() => assertSourceLanguage(bad), UnsupportedLanguageError);
  }
});

test('按源码目录识别语言；识别不出即拒', () => {
  assert.equal(detectLanguage('modules/disproportionality-rust'), 'rust');
  assert.equal(detectLanguage('modules/disproportionality-as'), 'assemblyscript');
  const empty = mkdtempSync(join(tmpdir(), 'medtrust-nolang-'));
  try {
    assert.throws(() => detectLanguage(empty), UnsupportedLanguageError);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('只交 .wasm 二进制 → 复现不出 SM3，MUST 拒绝入册（不设 Tier C）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'medtrust-binonly-'));
  try {
    writeFileSync(join(dir, 'module.wasm'), Buffer.from([0x00, 0x61, 0x73, 0x6d]));
    // 走正常准入入口：没有源码 → 连语言都识别不出 → 在提交环节就拒。
    await assert.rejects(
      () => reproduceAndGate(dir),
      (err) => err instanceof UnsupportedLanguageError,
    );
    // 显式表达同一条不变量。
    await assert.rejects(
      () => admitBinaryOnly(dir),
      (err) =>
        err instanceof AdmissionError && err.reason === 'no-reproducible-source',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

rustTest('Rust 源码：两个独立构建器产出同一 SM3，并过闸 1', { timeout: 600_000 }, async () => {
  const r = await reproduceAndGate('modules/disproportionality-rust', {
    analysisType: 'disproportionality',
  });
  assert.equal(r.language, 'rust');
  assert.match(r.sm3, /^[0-9a-f]{64}$/);
  assert.equal(r.toolchain.channel, '1.95.0');
  assert.equal(r.staticGate.abiVersionExportKind, 'function');
  assert.ok(r.reproducibleBuildRef.includes(r.sm3));

  // 再跑一遍整套（又是两个新构建器）——SM3 必须还是同一个。
  const again = await reproduceAndGate('modules/disproportionality-rust');
  assert.equal(again.sm3, r.sm3, '跨调用不可复现');
});

test('AssemblyScript 源码：同样走复现构建 + 闸 1', { timeout: 600_000 }, async () => {
  const r = await reproduceAndGate('modules/disproportionality-as', {
    analysisType: 'disproportionality',
  });
  assert.equal(r.language, 'assemblyscript');
  assert.equal(r.staticGate.abiVersionExportKind, 'global');
  assert.match(r.sm3, /^[0-9a-f]{64}$/);
});

rustTest('源码被改一个字节 → SM3 变（SM3 指的是「这一份代码」）', { timeout: 600_000 }, async () => {
  const base = await reproduceAndGate('modules/disproportionality-rust');
  const dir = mkdtempSync(join(tmpdir(), 'medtrust-tamper-'));
  try {
    cpSync('modules/disproportionality-rust', dir, { recursive: true });
    rmSync(join(dir, 'target'), { recursive: true, force: true });
    const lib = join(dir, 'src', 'lib.rs');
    const src = (await import('node:fs')).readFileSync(lib, 'utf8');
    writeFileSync(lib, src.replace('if n < 0 || k < 0', 'if n < -1 || k < 0'));
    const tampered = await reproduceAndGate(dir);
    assert.notEqual(tampered.sm3, base.sm3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Rust 源码缺 rust-toolchain.toml → 拒（工具链不锁 = 不可复现）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'medtrust-notoolchain-'));
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "x"\nversion = "0.1.0"\n');
    writeFileSync(join(dir, 'src', 'lib.rs'), '');
    await assert.rejects(() => reproduceAndGate(dir), /rust-toolchain\.toml/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
