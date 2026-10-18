import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * 直接对拍**构建产物**。
 *
 * 源码级测试（走 src + tsx）掩盖过一次真实故障：`src/cards.ts` 改名成 `protocol.ts` 后，
 * 旧的 `dist/cards.js` 仍留在 dist 里，`require('./cards')` 优先命中它而不是
 * `dist/cards/index.js`，于是 react 入口的 FormCard/StatusCard/... 全是 undefined
 * ——tsc 不报错、构建不报错，只有浏览器渲染时报 React #130。
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const reactEntry = require('../dist/react.js') as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const protocolEntry = require('../dist/index.js') as Record<string, unknown>;

test('构建产物 · react 入口：卡片组件与字段组件都是函数', () => {
  const components = [
    'CardRenderer',
    'FormCard',
    'StatusCard',
    'ResultCard',
    'ConfirmCard',
    'ContractApprovalCard',
    'ContractRequestCard',
    'contractApprovalSubmission',
    'TextField',
    'SelectField',
    'NumberField',
    'DateField',
    'CheckboxField',
  ];
  for (const name of components) {
    assert.equal(typeof reactEntry[name], 'function', `${name} 应导出为函数`);
  }
});

test('构建产物 · 协议入口：校验与信封函数都在', () => {
  const functions = [
    'validateCardMessage',
    'validateFields',
    'validateField',
    'isCardMessage',
    'extractCardMessages',
    'encodeCardSubmission',
    'parseCardSubmission',
  ];
  for (const name of functions) {
    assert.equal(typeof protocolEntry[name], 'function', `${name} 应导出为函数`);
  }
});

test('构建产物 · 协议入口不泄漏 React 组件（两入口分离）', () => {
  assert.equal(protocolEntry.CardRenderer, undefined);
  assert.equal(protocolEntry.FormCard, undefined);
});
