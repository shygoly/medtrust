// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PackRegistry, currentSpace, requireSpace, runInSpaceContext } from '../dist/index.js';

const packA = { id: 'alpha', version: '1.0.0', domain: 'alpha-dom', license: 'X', compatibleSpi: '^0.1.0', provides: {} };
const packB = { id: 'beta', version: '1.0.0', domain: 'beta-dom', license: 'X', compatibleSpi: '^0.1.0', provides: {} };
const bA = { packId: 'alpha' };
const bB = { packId: 'beta' };

test('部署白名单：未授权包注册被拒', () => {
  const reg = new PackRegistry(['alpha']);
  reg.register(packA, bA);
  assert.throws(() => reg.register(packB, bB), /PACK_NOT_ALLOWED:beta/);
});

test('包装配：双包同时注册，各自启用互不影响', () => {
  const reg = new PackRegistry(['alpha', 'beta']);
  reg.register(packA, bA);
  reg.register(packB, bB);
  const s1 = { spaceId: 's1' };
  const s2 = { spaceId: 's2' };
  reg.enable(s1, 'alpha');
  reg.enable(s2, 'beta');
  assert.deepEqual(reg.enabledIds(s1), ['alpha']);
  assert.deepEqual(reg.enabledIds(s2), ['beta']);
  // 同实例多领域：两个空间可分别启用不同包
  reg.enable(s1, 'beta');
  assert.deepEqual(reg.enabledIds(s1), ['alpha', 'beta']);
  assert.deepEqual(reg.enabledIds(s2), ['beta']);
});

test('空间运行期启用集：未启用即空，且不跨空间泄漏', () => {
  const reg = new PackRegistry(['alpha']);
  reg.register(packA, bA);
  assert.deepEqual(reg.enabledIds({ spaceId: 's1' }), []);
  reg.enable({ spaceId: 's1' }, 'alpha');
  assert.deepEqual(reg.enabledIds({ spaceId: 's2' }), []);
});

test('bundle.packId 与 manifest.id 不一致即拒', () => {
  const reg = new PackRegistry(['alpha']);
  assert.throws(() => reg.register(packA, { packId: 'other' }), /PACK_BUNDLE_MISMATCH/);
});

test('空间上下文：上下文内可读，上下文外 fail-closed', () => {
  assert.equal(currentSpace(), undefined);
  assert.throws(() => requireSpace(), /SPACE_CONTEXT_MISSING/);
  runInSpaceContext({ spaceId: 's9' }, () => {
    assert.equal(requireSpace().spaceId, 's9');
    assert.equal(currentSpace().spaceId, 's9');
  });
  assert.equal(currentSpace(), undefined);
});
