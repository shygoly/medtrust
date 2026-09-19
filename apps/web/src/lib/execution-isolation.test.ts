import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executionIsolationLabel,
  isExecutionIsolation,
  trustLevelLabel,
} from './execution-isolation';

const SM3 = 'b2760b0c56727fd77d0cc7d02d005400a0b31fa5b8894042c079e75618867ced';

test('Wasm 沙箱显示模块指纹前 16 位', () => {
  assert.equal(
    executionIsolationLabel('wasm-sandbox', SM3),
    '执行隔离:Wasm 沙箱 · 模块 b2760b0c56727fd7…',
  );
});

test('无隔离如实标注(软件、同进程)', () => {
  assert.equal(executionIsolationLabel('none'), '执行隔离:无隔离(软件、同进程)');
  assert.equal(executionIsolationLabel(undefined), '执行隔离:无隔离(软件、同进程)');
});

test('信任级别不因沙箱而虚标为硬件', () => {
  assert.equal(trustLevelLabel('software'), '信任级别:software(无远程证明)');
  assert.equal(trustLevelLabel(undefined), '信任级别:software(无远程证明)');
  assert.equal(trustLevelLabel('hardware'), '信任级别:硬件远程证明');
});

test('枚举校验只认两个合法值', () => {
  assert.equal(isExecutionIsolation('wasm-sandbox'), true);
  assert.equal(isExecutionIsolation('none'), true);
  assert.equal(isExecutionIsolation('hardware-tee'), false);
  assert.equal(isExecutionIsolation(undefined), false);
});
