import {
  ASSISTANT_CONFIGS,
  ASSISTANT_INTENTS,
  routeAssistantIntent,
  toolsForIntent,
} from './assistant-intent';

describe('统一助手意图路由', () => {
  it('六类意图各有独立配置、工具面与人工确认点', () => {
    expect(ASSISTANT_INTENTS).toHaveLength(6);
    for (const intent of ASSISTANT_INTENTS) {
      expect(ASSISTANT_CONFIGS[intent].allowedTools.length).toBeGreaterThan(0);
      expect(ASSISTANT_CONFIGS[intent].auditTag).toContain(intent);
    }
    expect(toolsForIntent('access-contract').has('submit_external_control')).toBe(true);
    expect(toolsForIntent('platform-ops').has('submit_external_control')).toBe(false);
    expect(toolsForIntent('hospital-mapping').has('check_contract_status')).toBe(false);
  });

  it('明确关键词直接路由，并返回依据', () => {
    expect(routeAssistantIntent({ message: '我想做单臂外部对照' })).toMatchObject({
      primary: 'access-contract',
      confidence: 'high',
      requiresSelection: false,
    });
    expect(routeAssistantIntent({ message: '整理监管证据索引' })).toMatchObject({
      primary: 'compliance-evidence',
    });
    expect(routeAssistantIntent({ message: '整理字段码表映射' })).toMatchObject({
      primary: 'hospital-mapping',
    });
  });

  it('多意图同分返回选择卡，不静默猜测', () => {
    const route = routeAssistantIntent({
      message: '研究设计和合约申请',
      role: 'consumer',
    });
    expect(route.requiresSelection).toBe(true);
    expect(route.candidates.length).toBeGreaterThan(1);
  });

  it('角色无权时不能靠前端选项越权', () => {
    const route = routeAssistantIntent({
      message: '重启连接器',
      role: 'consumer',
      explicitIntent: 'platform-ops',
    });
    expect(route.requiresSelection).toBe(true);
    expect(route.primary).not.toBe('platform-ops');
  });

  it('新会话缺省不沿用草稿意图；同一会话才沿用已确认意图', () => {
    expect(routeAssistantIntent({ message: '接着说' }).requiresSelection).toBe(true);
    expect(
      routeAssistantIntent({ message: '接着说', draftIntent: 'result-interpretation' }),
    ).toMatchObject({ primary: 'result-interpretation', requiresSelection: false });
  });

  it('页面上下文只决定候选意图，不携带患者数据', () => {
    expect(
      routeAssistantIntent({ message: '看看', page: '/space/mdop/jobs/job-1' }),
    ).toMatchObject({ primary: 'result-interpretation' });
    expect(
      routeAssistantIntent({ message: '看看', page: '/space/connectors' }),
    ).toMatchObject({ primary: 'platform-ops' });
  });
});
