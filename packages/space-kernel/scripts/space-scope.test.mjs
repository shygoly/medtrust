// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSpaceScopedEntity,
  registerSpaceScopedEntity,
  resetSpaceScopedEntitiesForTest,
  scopeToSpace,
  spaceScopedEntities,
} from '../dist/index.js';

function fakeQb() {
  const calls = [];
  return {
    alias: 't',
    calls,
    andWhere(condition, parameters) { calls.push({ condition, parameters }); return this; },
  };
}

test('未登记实体：不注入（P4 落列前零行为变更）', () => {
  resetSpaceScopedEntitiesForTest();
  const qb = fakeQb();
  scopeToSpace(qb, 'cp_data_product', { spaceId: 's1' });
  assert.equal(qb.calls.length, 0);
  assert.equal(isSpaceScopedEntity('cp_data_product'), false);
});

test('已登记实体 + 有上下文：注入 space_id 过滤', () => {
  resetSpaceScopedEntitiesForTest();
  registerSpaceScopedEntity('cp_digital_contract');
  const qb = fakeQb();
  scopeToSpace(qb, 'cp_digital_contract', { spaceId: 's1' });
  assert.equal(qb.calls.length, 1);
  assert.match(qb.calls[0].condition, /^t\.space_id = :__spaceId$/);
  assert.deepEqual(qb.calls[0].parameters, { __spaceId: 's1' });
});

test('无空间上下文：原样返回（fail-open 到调用方守卫，不由仓储猜默认空间）', () => {
  resetSpaceScopedEntitiesForTest();
  registerSpaceScopedEntity('cp_digital_contract');
  const qb = fakeQb();
  scopeToSpace(qb, 'cp_digital_contract', undefined);
  assert.equal(qb.calls.length, 0);
});

test('负例：不得为空空间注入', () => {
  resetSpaceScopedEntitiesForTest();
  registerSpaceScopedEntity('cp_digital_contract');
  const qb = fakeQb();
  scopeToSpace(qb, 'cp_digital_contract', { spaceId: '' });
  assert.equal(qb.calls.length, 0);
});

test('登记表可枚举且身份表未被默认登记', () => {
  resetSpaceScopedEntitiesForTest();
  registerSpaceScopedEntity('cp_mdop_job');
  assert.deepEqual(spaceScopedEntities(), ['cp_mdop_job']);
  assert.equal(isSpaceScopedEntity('cp_participant'), false);
});
