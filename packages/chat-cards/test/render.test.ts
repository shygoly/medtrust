import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardRenderer } from '../src/react';
import { contractApprovalSubmission } from '../src/cards/ContractApprovalCard';
import type { CardMessage, FormCardMessage } from '../src/index';
import type { ContractApprovalCardMessage } from '../src/types';

const formCard: FormCardMessage = {
  type: 'form',
  title: '外部对照配置',
  description: '配置试验组和对照组',
  fields: [
    { name: 'trial', label: '试验方', type: 'select', required: true, options: [{ label: '申办方', value: 'p-sponsor' }] },
    { name: 'ratioK', label: '匹配比例', type: 'number', defaultValue: 2, validation: { min: 1, max: 10 } },
  ],
};

const render = (card: CardMessage, onSubmit = () => undefined) =>
  renderToStaticMarkup(createElement(CardRenderer, { card, onSubmit }));

test('FormCard：渲染标题、字段、必填标记、默认值与提交按钮', () => {
  const html = render(formCard);
  assert.match(html, /data-card-type="form"/);
  assert.match(html, /外部对照配置/);
  assert.match(html, /试验方/);
  assert.match(html, /name="trial"/);
  assert.match(html, /name="ratioK"/);
  assert.match(html, /value="2"/);
  assert.match(html, /data-testid="submit-card"/);
  assert.match(html, /申办方/);
});

test('StatusCard：按 tone 渲染并带 data 明细', () => {
  const html = render({ type: 'status', title: '任务已提交', tone: 'success', data: { jobId: 'job-1' } });
  assert.match(html, /data-card-type="status"/);
  assert.match(html, /data-tone="success"/);
  assert.match(html, /job-1/);
});

test('ResultCard：表格化渲染 data', () => {
  const html = render({ type: 'result', title: '分析结果', data: { hr: 0.82 } });
  assert.match(html, /data-card-type="result"/);
  assert.match(html, /data-result-key="hr"/);
  assert.match(html, /0.82/);
});

test('ConfirmCard：默认动作含确认与返回', () => {
  const html = render({ type: 'confirm', title: '确认提交', data: { trial: 'p-sponsor' } });
  assert.match(html, /data-card-type="confirm"/);
  assert.match(html, /确认提交/);
  assert.match(html, /返回修改/);
});

test('CardRenderer：未知类型退化为状态卡，不抛错', () => {
  const html = render({ type: 'status', title: '兜底' });
  assert.match(html, /兜底/);
});

const approvalCard: CardMessage = {
  type: 'contract_approval',
  title: '数据合约申请审批',
  contract: {
    providerId: 'p-hosp-a',
    consumerId: 'p-sponsor',
    purpose: '单臂试验外部对照分析',
    dataProducts: [{ participantId: 'p-hosp-a', dataProductId: 'dp-controls', name: '对照组数据' }],
    validDays: 30,
    autoApprove: false,
    request: { dataProductId: 'dp-controls', purpose: '单臂试验外部对照分析' },
  },
};

test('ContractApprovalCard：展示参与方/用途/数据产品，且不写成"立即生效"', () => {
  const html = render(approvalCard);
  assert.match(html, /data-card-type="contract_approval"/);
  assert.match(html, /p-sponsor ↔ p-hosp-a/);
  assert.match(html, /单臂试验外部对照分析/);
  assert.match(html, /对照组数据/);
  assert.match(html, /30 天/);
  // 本仓控制面没有"平台自动批准"：文案必须是"由数据提供方签发"
  assert.match(html, /签发/);
  assert.doesNotMatch(html, /立即生效/);
});

test('ContractApprovalCard：点提交回灌 action=request_contract 与申请入参', () => {
  const html = render(approvalCard);
  assert.match(html, /同意并提交申请/);
  assert.match(html, /data-testid="submit-card"/);

  // 回灌契约抽成纯函数（react-dom/server 不跑 onClick，只能这样钉住）
  assert.deepEqual(contractApprovalSubmission(approvalCard as ContractApprovalCardMessage), {
    action: 'request_contract',
    dataProductId: 'dp-controls',
    purpose: '单臂试验外部对照分析',
  });
});

test('ContractRequestCard：只给步骤与原因，不给提交按钮', () => {
  const html = render({
    type: 'contract_request',
    title: '还差一份合规预审',
    reason: '合约申请必须引用一份属于本方的合规预审。',
    steps: ['在「合规预审」页创建组合', '回这里让我发起申请'],
  });
  assert.match(html, /data-card-type="contract_request"/);
  assert.match(html, /合规预审/);
  assert.match(html, /<li>回这里让我发起申请<\/li>/);
  assert.doesNotMatch(html, /data-testid="submit-card"/);
});

test('CardRenderer：合约卡缺字段时退化，不抛错', () => {
  const html = render({ type: 'contract_approval', title: '合约' } as CardMessage);
  assert.match(html, /data-card-type="status"/);
});
