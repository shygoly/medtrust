import { SCENARIOS } from '../scenarios';
import { MEDTRUST_SYSTEM_PROMPT, buildSystemPrompt } from './system';

describe('system prompt', () => {
  it('由场景表生成：六个场景的标题、id 与工具名都在', () => {
    for (const scenario of SCENARIOS) {
      expect(MEDTRUST_SYSTEM_PROMPT).toContain(scenario.title);
      expect(MEDTRUST_SYSTEM_PROMPT).toContain(scenario.id);
      expect(MEDTRUST_SYSTEM_PROMPT).toContain(scenario.toolName);
    }
  });

  it('写明了 Card 协议与提交信封（模型才知道怎么出卡/提交）', () => {
    expect(MEDTRUST_SYSTEM_PROMPT).toContain('```card');
    expect(MEDTRUST_SYSTEM_PROMPT).toContain('[card:submit]');
    expect(MEDTRUST_SYSTEM_PROMPT).toContain('text / number / select / date / checkbox');
  });

  it('明确要求"工具返回后 MUST 出 status 卡"（否则真模型只写散文，界面没有结果卡）', () => {
    // 这条是被 DeepSeek 实测暴露出来的：模型照"用一句话回报结果"做了，cards 为空。
    expect(MEDTRUST_SYSTEM_PROMPT).toMatch(/工具返回后.*MUST 出卡/s);
    expect(MEDTRUST_SYSTEM_PROMPT).toContain('"type": "status"');
    expect(MEDTRUST_SYSTEM_PROMPT).toContain('tone');
    expect(MEDTRUST_SYSTEM_PROMPT).toContain('jobId');
  });

  it('写明了出域红线（只有 prompt-text 可以出去）', () => {
    expect(MEDTRUST_SYSTEM_PROMPT).toContain('信任边界');
    expect(MEDTRUST_SYSTEM_PROMPT).toContain('患者级数据');
  });

  it('写明合规流程：先查合约、缺合约走申请、申请不等于生效（合规集成 Phase 1-4）', () => {
    expect(MEDTRUST_SYSTEM_PROMPT).toContain('check_contract_status');
    expect(MEDTRUST_SYSTEM_PROMPT).toContain('request_contract');
    expect(MEDTRUST_SYSTEM_PROMPT).toContain('contract_approval');
    expect(MEDTRUST_SYSTEM_PROMPT).toContain('contract_request');
    // 工具自带卡必须原样输出：模型没有编造合约 id / 参与方的空间
    expect(MEDTRUST_SYSTEM_PROMPT).toContain('原样');
    // 本仓控制面没有自动批准：措辞必须落在"等数据提供方签发"上
    expect(MEDTRUST_SYSTEM_PROMPT).toContain('签发');
  });

  it('要求任务配置卡带上授权合约（metadata 里带 contractId）', () => {
    expect(MEDTRUST_SYSTEM_PROMPT).toContain('metadata.contractId');
  });

  it('可重复构建且不含任何用户数据（提示词是常量）', () => {
    expect(buildSystemPrompt()).toBe(MEDTRUST_SYSTEM_PROMPT);
  });
});
