/**
 * check-orchestration.test.mjs — 上面那个守护的负例自检（注入违规须报红、回滚须转绿）。
 * 运行：node --test scripts/check-orchestration.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(ROOT, 'scripts/check-orchestration.mjs');
const DIR = mkdtempSync(join(tmpdir(), 'check-orchestration-'));

const base = (over) => Object.assign({
  key: 'rws.test',
  kind: 'rws-analysis',
  label: 't',
  channel: 'legacy',
  state: 'pending',
  mdopTemplate: null,
  legacyTables: ['cp_rws_task'],
  legacyRefs: [],
  equivalenceEvidence: null,
  verification: null,
  sunset: null,
}, over);

const run = (channels, budget) => {
  const p = join(DIR, 'ledger-' + Math.random().toString(36).slice(2) + '.json');
  writeFileSync(p, JSON.stringify({ schemaVersion: 1, updated: '2026-10-13', legacyBudget: budget, channels }));
  const r = spawnSync(process.execPath, [GUARD, '--ledger', p, '--no-baseline'], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

test('合法台账 → 0', () => {
  const r = run([base({})], 1);
  assert.equal(r.code, 0, r.out);
});

test('key 重复 → 报红', () => {
  const r = run([base({}), base({})], 2);
  assert.equal(r.code, 1);
  assert.match(r.out, /duplicate key/);
});

test('channel=mdop 无证据且无 verification → 报红', () => {
  const r = run([base({ channel: 'mdop', state: 'migrated' })], 0);
  assert.equal(r.code, 1);
  assert.match(r.out, /等价性证据|verification/);
});

test('channel=mdop 带未过期 verification → 转绿', () => {
  const r = run([base({ channel: 'mdop', state: 'migrated', verification: { status: 'pending', expires: '2099-01-01' } })], 0);
  assert.equal(r.code, 0, r.out);
});

test('verification.expires 已过期 → 报红', () => {
  const r = run([base({ channel: 'mdop', state: 'migrated', verification: { status: 'pending', expires: '2000-01-01' } })], 0);
  assert.equal(r.code, 1);
  assert.match(r.out, /expires 已过期/);
});

test('legacy 条目数超过 budget → 报红（只减不增）', () => {
  const r = run([base({}), base({ key: 'rws.test2' })], 1);
  assert.equal(r.code, 1);
  assert.match(r.out, /超过 legacyBudget/);
});

test('channel=legacy 但没有旧表 → 报红（O5）', () => {
  const r = run([base({ legacyTables: [] })], 1);
  assert.equal(r.code, 1);
  assert.match(r.out, /legacyTables/);
});

test('legacyStorage=in-memory 但没指明持有代码 → 报红（O5）', () => {
  const r = run([base({ legacyStorage: 'in-memory', legacyTables: [], legacyRefs: [] })], 1);
  assert.equal(r.code, 1);
  assert.match(r.out, /in-memory/);
});

test('legacyStorage=in-memory 且指明持有代码 → 0', () => {
  const r = run([base({ legacyStorage: 'in-memory', legacyTables: [], legacyRefs: ['apps/api/src/runtime/secretflow-orchestrator/'] })], 1);
  assert.equal(r.code, 0, r.out);
});

test('legacy-removed 但路径仍在 → 报红（下线闸门③）', () => {
  const r = run([base({ channel: 'mdop', state: 'legacy-removed', equivalenceEvidence: 'x.md', legacyRefs: ['package.json'] })], 0);
  assert.equal(r.code, 1);
  assert.match(r.out, /legacyRefs 残留/);
});

test('legacy-removed 的 mustNotContain 仍命中 → 报红', () => {
  const r = run([base({ channel: 'mdop', state: 'legacy-removed', equivalenceEvidence: 'x.md', legacyRefs: [{ path: 'package.json', mustNotContain: '"name"' }] })], 0);
  assert.equal(r.code, 1);
  assert.match(r.out, /仍含/);
});

test('残留清掉后回滚 → 转绿', () => {
  const r = run([base({ channel: 'mdop', state: 'legacy-removed', equivalenceEvidence: 'x.md', legacyRefs: ['definitely/not/here.ts', { path: 'package.json', mustNotContain: 'ZZZ_NOT_PRESENT_MARKER' }] })], 0);
  assert.equal(r.code, 0, r.out);
});

test('legacy-removed 缺证据 → 报红', () => {
  const r = run([base({ channel: 'mdop', state: 'legacy-removed', legacyRefs: [] })], 0);
  assert.equal(r.code, 1);
  assert.match(r.out, /legacy-removed 必须附等价性证据/);
});

test('mdop-native 豁免证据要求 → 0', () => {
  const r = run([base({ kind: 'mdop-native', channel: 'mdop', state: 'migrated', legacyTables: [], equivalenceEvidence: null })], 0);
  assert.equal(r.code, 0, r.out);
});
