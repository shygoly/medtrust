import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceNumber,
  encodeCardSubmission,
  extractCardMessages,
  isCardMessage,
  parseCardSubmission,
  validateCardMessage,
  validateField,
  validateFields,
  type CardMessage,
  type FormField,
} from '../src/index';

const field = (over: Partial<FormField>): FormField => ({
  name: 'f',
  label: '字段',
  type: 'text',
  ...over,
});

test('coerceNumber 接受数字与数字字符串，拒绝空白/文本/NaN', () => {
  assert.equal(coerceNumber(3), 3);
  assert.equal(coerceNumber('3.5'), 3.5);
  assert.equal(coerceNumber(''), null);
  assert.equal(coerceNumber('abc'), null);
  assert.equal(coerceNumber(Number.NaN), null);
  assert.equal(coerceNumber(null), null);
});

test('validateField：必填、数字范围、select 候选、日期、checkbox', () => {
  assert.equal(validateField(field({ required: true }), undefined), '字段为必填项');
  assert.equal(validateField(field({ required: true }), ''), '字段为必填项');
  assert.equal(validateField(field({}), undefined), null);

  const num = field({ label: '卡尺天数', type: 'number', validation: { min: 1, max: 365 } });
  assert.equal(validateField(num, 'abc'), '卡尺天数必须是数字');
  assert.equal(validateField(num, 0), '卡尺天数不得小于 1');
  assert.equal(validateField(num, 400), '卡尺天数不得大于 365');
  assert.equal(validateField(num, '30'), null);

  const select = field({
    label: '试验方',
    type: 'select',
    options: [{ label: 'A', value: 'p-a' }],
  });
  assert.equal(validateField(select, 'p-b'), '试验方取值不在候选中');
  assert.equal(validateField(select, 'p-a'), null);

  assert.equal(validateField(field({ type: 'date' }), 'not-a-date'), '字段不是合法日期');
  assert.equal(validateField(field({ type: 'date' }), '2026-01-01'), null);

  assert.equal(validateField(field({ type: 'checkbox' }), 'yes'), '字段必须是布尔值');
  assert.equal(validateField(field({ type: 'checkbox' }), true), null);
});

test('validateField：text 正则 + 自定义消息', () => {
  const strata = field({ label: '分层键', validation: { pattern: '^[<>]\\d+\\|[MF]$', message: '分层键格式不正确' } });
  assert.equal(validateField(strata, '40|X'), '分层键格式不正确');
  assert.equal(validateField(strata, '40|F'), '分层键格式不正确');
  assert.equal(validateField(strata, '<40|F'), null);
});

test('validateFields 汇总各字段错误', () => {
  const errors = validateFields(
    [
      field({ name: 'trial', label: '试验方', type: 'select', options: [{ label: 'A', value: 'A' }], required: true }),
      field({ name: 'ratioK', label: '匹配比例', type: 'number', validation: { min: 1, max: 10 }, required: true }),
    ],
    { ratioK: 99 },
  );
  assert.deepEqual(Object.keys(errors).sort(), ['ratioK', 'trial']);
});

test('validateCardMessage / isCardMessage：拦截畸形 LLM 输出', () => {
  assert.deepEqual(validateCardMessage({ type: 'status', title: '已提交' }), []);
  assert.ok(isCardMessage({ type: 'form', title: '配置', fields: [{ name: 'a', label: 'A', type: 'text' }] }));

  assert.deepEqual(validateCardMessage(null), ['card 必须是对象']);
  assert.equal(validateCardMessage({ type: 'nope', title: 'x' }).length, 1);
  assert.equal(validateCardMessage({ type: 'status' }).length, 1);
  assert.equal(validateCardMessage({ type: 'form', title: 'x', fields: [] }).length, 1);
  assert.equal(
    validateCardMessage({ type: 'form', title: 'x', fields: [{ name: 'a', label: 'A', type: 'select' }] }).length,
    1,
  );
  // options: [] 是「目录尚未加载」的合法运行态：卡片必须能下发，由前端降级承载可用性。
  assert.deepEqual(
    validateCardMessage({
      type: 'form',
      title: 'x',
      fields: [{ name: 'a', label: 'A', type: 'select', options: [] }],
    }),
    [],
  );
});

test('extractCardMessages：抽取合法卡、剔除围栏、报告非法卡', () => {
  const content = [
    '好的，我为你准备了一张表单：',
    '```card',
    JSON.stringify({ type: 'form', title: '外部对照配置', fields: [{ name: 'trial', label: '试验方', type: 'text' }] }),
    '```',
    '填写后提交即可。',
  ].join('\n');

  const { cards, text, invalid } = extractCardMessages(content);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, '外部对照配置');
  assert.deepEqual(invalid, []);
  assert.ok(text.startsWith('好的'));
  assert.ok(!text.includes('card'));

  const broken = extractCardMessages('x\n```card\n{ not json }\n```\ny');
  assert.deepEqual(broken.cards, []);
  assert.equal(broken.invalid.length, 1);

  const wrongShape = extractCardMessages('```card\n{"type":"zzz"}\n```');
  assert.deepEqual(wrongShape.cards, []);
  assert.equal(wrongShape.invalid.length, 1);
});

test('encodeCardSubmission / parseCardSubmission 往返', () => {
  const submission = {
    kind: 'card-submit' as const,
    cardType: 'form' as const,
    title: '外部对照配置',
    scenario: 'external-control',
    values: { trial: 'p-sponsor', ratioK: 2 },
  };
  const encoded = encodeCardSubmission(submission);
  assert.ok(encoded.startsWith('[card:submit] '));
  assert.deepEqual(parseCardSubmission(encoded), submission);

  assert.equal(parseCardSubmission('普通消息'), null);
  assert.equal(parseCardSubmission('[card:submit] {bad json'), null);
  assert.equal(parseCardSubmission('[card:submit] {"kind":"other"}'), null);
});

test('CardMessage 类型对拍：状态卡可带 jobId 数据', () => {
  const card: CardMessage = { type: 'status', title: '任务已提交', tone: 'success', data: { jobId: 'job-1' } };
  assert.ok(isCardMessage(card));
});

test('合约卡：结构合法的通过；缺 contract.purpose / dataProducts 的被拦下', () => {
  const approval: CardMessage = {
    type: 'contract_approval',
    title: '数据合约申请审批',
    contract: {
      purpose: '单臂试验外部对照分析',
      dataProducts: [{ participantId: 'p-hosp-a', dataProductId: 'dp-controls' }],
      autoApprove: false,
    },
  };
  assert.deepEqual(validateCardMessage(approval), []);

  const noPurpose = validateCardMessage({
    type: 'contract_approval',
    title: 'x',
    contract: { purpose: '  ', dataProducts: [{ participantId: 'p', dataProductId: 'dp' }] },
  });
  assert.ok(noPurpose.some((error) => error.includes('contract.purpose')));

  const noProducts = validateCardMessage({
    type: 'contract_approval',
    title: 'x',
    contract: { purpose: '用途', dataProducts: [] },
  });
  assert.ok(noProducts.some((error) => error.includes('contract.dataProducts')));

  const noContract = validateCardMessage({ type: 'contract_approval', title: 'x' });
  assert.ok(noContract.some((error) => error.includes('必须有 contract')));
});

test('合约引导卡：reason 必填、steps 必须是数组（否则模型写坏结构也没人拦）', () => {
  assert.deepEqual(
    validateCardMessage({
      type: 'contract_request',
      title: '还差一份合规预审',
      reason: '合约申请必须引用一份属于本方的合规预审',
      steps: ['去合规预审页创建组合'],
    }),
    [],
  );
  assert.ok(
    validateCardMessage({ type: 'contract_request', title: 'x' }).some((error) =>
      error.includes('reason 必填'),
    ),
  );
  assert.ok(
    validateCardMessage({ type: 'contract_request', title: 'x', reason: 'r', steps: 'oops' }).some(
      (error) => error.includes('steps'),
    ),
  );
});

test('metadata 只许是对象（任务配置卡的 contractId 附注走这里）', () => {
  assert.deepEqual(
    validateCardMessage({
      type: 'form',
      title: '外部对照配置',
      scenario: 'external-control',
      metadata: { contractId: 'ct-1' },
      fields: [{ name: 'trial', label: '试验方', type: 'text' }],
    }),
    [],
  );
  assert.ok(
    validateCardMessage({
      type: 'status',
      title: 'x',
      metadata: 'ct-1',
    }).some((error) => error.includes('metadata')),
  );
});

test('actions 给了非数组 → 拦下（LLM 把 actions 写成对象是常见坏形）', () => {
  assert.ok(
    validateCardMessage({ type: 'status', title: 'x', actions: { label: '提交' } }).some((error) =>
      error.includes('actions'),
    ),
  );
});
