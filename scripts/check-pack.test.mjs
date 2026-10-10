import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORBIDDEN_MECHANISM_KEYS, checkPack } from './conformance/check-pack.mjs';

const GOOD = {
  id: 'med',
  version: '0.1.0',
  domain: 'healthcare',
  license: 'Apache-2.0',
  compatibleSpi: '^0.1.0',
  provides: { egress: 'med-default', operators: ['a'], terminology: ['icd'] },
};

test('正例：合规包清单 0 错误', () => {
  assert.deepEqual(checkPack(GOOD), []);
});

test('负例：缺必填字段', () => {
  const { license, ...rest } = GOOD;
  assert.match(checkPack(rest).join(';'), /缺必填字段：license/);
});

test('负例：provides 含未知缝', () => {
  assert.match(
    checkPack({ ...GOOD, provides: { teleport: 'x' } }).join(';'),
    /provides 含未知缝：teleport/,
  );
});

test('负例：包声明机制层键（不得扩张机制层，D-SPD-9）', () => {
  for (const k of FORBIDDEN_MECHANISM_KEYS) {
    assert.match(checkPack({ ...GOOD, [k]: true }).join(';'), /不得声明机制层键/);
  }
});

test('负例：版本 / SPI 范围格式', () => {
  assert.match(checkPack({ ...GOOD, version: 'v1' }).join(';'), /语义化版本/);
  assert.match(checkPack({ ...GOOD, compatibleSpi: 'latest' }).join(';'), /版本范围/);
});

test('负例：非对象清单', () => {
  assert.deepEqual(checkPack(null), ['清单不是对象']);
  assert.deepEqual(checkPack([]), ['清单不是对象']);
});
