import { extractCardMessages, validateCardMessage } from '@medtrust/chat-cards';
import { FAKE_DIRECTORY } from '../test-utils/fake-api-client';
import type { ScenarioBuildContext } from '../agent/scenarios';
import {
  buildContractApprovalCard,
  buildContractPendingCard,
  buildContractRequestCard,
  buildErrorCard,
  buildResultCard,
  buildScenarioFormCard,
  buildScenarioListCard,
  buildStatusCard,
  renderCardFence,
} from './card-builder';

const ctx: ScenarioBuildContext = {
  spaceId: 'sh-med',
  userId: 'user-1',
  directory: FAKE_DIRECTORY,
  defaults: {
    purpose: '外部对照 RWS',
    applicant: { org: 'user-1', project: 'sh-med' },
    contracts: ['ct-1'],
    notBefore: '2026-01-01T00:00:00.000Z',
    notAfter: '2026-04-01T00:00:00.000Z',
    minCell: 5,
    teeNode: 'urn:tds:sh-med:participant:tee-node',
  },
};

describe('卡片构造', () => {
  it('场景卡片带 scenario 与治理假设说明', () => {
    const card = buildScenarioFormCard({ scenarioId: 'external-control', ctx })!;
    expect(card.type).toBe('form');
    expect(card.scenario).toBe('external-control');
    expect(card.description).toContain('逐数据源依赖检查合约');
    expect(card.description).toContain('最小单元格 5');
    expect(card.fields.length).toBeGreaterThan(0);
  });

  it('目录为空时显式告警，并把无候选的 select 降级为文本输入', () => {
    const card = buildScenarioFormCard({
      scenarioId: 'external-control',
      ctx: { ...ctx, directory: { participants: [], dataProducts: [] } },
    })!;
    expect(card.description).toContain('目录为空');
    const trial = card.fields.find((field) => field.name === 'trial')!;
    expect(trial.type).toBe('text');
    expect(trial.help).toContain('直接填写');
    // 降级后仍是合法卡片（不会被服务端的结构校验丢弃）
    expect(validateCardMessage(card)).toEqual([]);
  });

  it('未知场景返回 null', () => {
    expect(buildScenarioFormCard({ scenarioId: 'nope', ctx })).toBeNull();
  });

  it('renderCardFence 输出可被 extractCardMessages 无损解析', () => {
    const card = buildScenarioListCard();
    const { cards, invalid } = extractCardMessages(`前言\n${renderCardFence(card)}\n后语`);
    expect(invalid).toEqual([]);
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe('可用的计算场景');
    expect(Object.keys(cards[0].data ?? {}).length).toBe(6);
  });

  it('状态卡与错误卡形状正确', () => {
    expect(buildStatusCard('任务已提交', 'success', { jobId: 'job-1' })).toMatchObject({
      type: 'status',
      tone: 'success',
      data: { jobId: 'job-1' },
    });
    const error = buildErrorCard('提交失败', '参数不合法', ['改一下再试']);
    expect(error.tone).toBe('error');
    expect(error.description).toContain('改一下再试');
    expect(buildResultCard('结果', { a: 1 }).type).toBe('result');
  });

  it('合约审批卡：autoApprove 恒为 false，申请入参挂在 contract.request 上', () => {
    const card = buildContractApprovalCard({
      purpose: '单臂试验外部对照分析',
      providerId: 'p-hosp-a',
      validDays: 30,
      dataProducts: [{ participantId: 'p-hosp-a', dataProductId: 'dp-controls', name: '对照组数据' }],
      request: { dataProductId: 'dp-controls', purpose: '单臂试验外部对照分析' },
    });

    expect(card.type).toBe('contract_approval');
    expect(card.contract.autoApprove).toBe(false);
    expect(card.metadata).toMatchObject({ tool: 'request_contract', providerId: 'p-hosp-a' });
    // 卡片必须能过服务端结构校验，否则会被 extractCardMessages 丢掉（前端什么都看不到）
    expect(validateCardMessage(card)).toEqual([]);
    const { cards, invalid } = extractCardMessages(renderCardFence(card));
    expect(invalid).toEqual([]);
    expect(cards).toHaveLength(1);
  });

  it('合约引导卡：只给原因与步骤，不给可提交的假动作', () => {
    const card = buildContractRequestCard({
      reason: '本方还没有合规预审组合',
      steps: ['去合规预审页建组合', '回这里发起申请'],
    });
    expect(card.type).toBe('contract_request');
    expect(card.actions).toBeUndefined();
    expect(validateCardMessage(card)).toEqual([]);
  });

  it('合约申请回执卡：contractId 在 data 里（可回头查状态），tone 是 pending 不是 success', () => {
    const card = buildContractPendingCard({ contractId: 'ct-9', status: 'draft' });
    expect(card).toMatchObject({
      type: 'status',
      tone: 'pending',
      data: { contractId: 'ct-9', status: 'draft' },
    });
    // 申请 ≠ 生效：不能给用户"成功"的观感
    expect(validateCardMessage(card)).toEqual([]);
  });
});
