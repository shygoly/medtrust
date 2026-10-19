import type { ToolContext } from '@medtrust/pi-agent';
import { FakeApiClient, FAKE_DIRECTORY } from '../test-utils/fake-api-client';
import type { ScenarioBuildContext, ScenarioDefaults, ScenarioDefinition } from './scenarios';
import { directoryHelp } from './scenarios';
import { buildSubmitTool } from './tools/mdop.tools';

/**
 * 「加一个场景」的**可运行示例**（对应 docs/DEVELOPER-GUIDE.md §1）。
 *
 * 这里不往 SCENARIOS 里塞演示场景（那会污染真实注册表、也让识别语料的覆盖断言变松），
 * 而是把同一份配方独立构造出来，验证它对**同一套约定**成立：
 * 字段名唯一、校验生效、经 submit 工具能成功提交一次。
 * 文档里的配方如果漂移，这个用例会红。
 */
const demoCount: ScenarioDefinition = {
  id: 'demo-count',
  pack: 'med',
  assistantIntent: 'access-contract',
  toolName: 'submit_demo_count',
  title: '演示计数',
  template: 'demo.count',
  analysisKey: 'demo.count',
  endpoint: '/mdop/jobs/demo-count',
  mode: 'direct',
  description: '按数据持有方计数，只回小单元格以上的聚合。',
  keywords: ['演示', 'demo'],
  examples: ['帮我跑一下演示计数'],
  purposePolicy: { default: '对话式任务配置（AI Chat Agent）', allowed: ['对话式任务配置（AI Chat Agent）'] },
  contractDependencies: [],
  contractRequestDefaults: {
    retention: '作业完成后 30 天',
    output: '仅聚合统计',
    minCell: 5,
    validDays: 30,
  },
  productRoles: {},
  buildFields: (ctx: ScenarioBuildContext) => [
    {
      name: 'holders',
      label: '数据持有方',
      type: 'text',
      required: true,
      help: ['用逗号分隔', directoryHelp(ctx, 'participants')].filter(Boolean).join('；'),
    },
  ],
  validate: (values: Record<string, unknown>) =>
    String(values.holders ?? '').trim() ? [] : ['至少需要一个数据持有方'],
  buildSubmission: (values: Record<string, unknown>, ctx: ScenarioBuildContext) => ({
    submission: {
      scenarioId: 'demo-count',
      mode: 'direct' as const,
      endpoint: '/mdop/jobs/demo-count',
      analysisKey: 'demo.count',
      payload: {
        purpose: ctx.defaults.purpose,
        applicant: ctx.defaults.applicant,
        contracts: ctx.defaults.contracts,
        notBefore: ctx.defaults.notBefore,
        notAfter: ctx.defaults.notAfter,
        holders: String(values.holders)
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
          .map((participantId) => ({ participantId })),
        minCell: ctx.defaults.minCell,
      },
    },
    warnings: [],
  }),
};

const defaults: ScenarioDefaults = {
  purpose: '演示',
  applicant: { org: 'u-1', project: 'sh-med' },
  contracts: ['ct-1'],
  notBefore: '2026-01-01T00:00:00.000Z',
  notAfter: '2026-04-01T00:00:00.000Z',
  minCell: 5,
  teeNode: 'urn:tds:sh-med:participant:tee-node',
};

const ctx: ScenarioBuildContext = {
  spaceId: 'sh-med',
  userId: 'u-1',
  directory: FAKE_DIRECTORY,
  defaults,
};

const toolContext: ToolContext = {
  userId: 'u-1',
  spaceId: 'sh-med',
  sessionId: 's-1',
  accessToken: 'tk',
  directory: FAKE_DIRECTORY,
  defaults,
};

describe('加一个场景：可运行配方', () => {
  it('卡片字段名唯一、必填有 label，且多值字段带目录提示', () => {
    const fields = demoCount.buildFields(ctx);
    const names = fields.map((field) => field.name);
    expect(new Set(names).size).toBe(names.length);
    expect(fields[0].label.length).toBeGreaterThan(0);
    expect(fields[0].help).toContain('目录可用');
  });

  it('校验生效：空值被拒，有值通过', () => {
    expect(demoCount.validate({ holders: '' }, ctx)).toEqual(['至少需要一个数据持有方']);
    expect(demoCount.validate({ holders: 'p-hosp-a' }, ctx)).toEqual([]);
  });

  it('经 submit 工具成功提交一次（与真实场景走同一条工具/客户端路径）', async () => {
    const api = new FakeApiClient();
    const tool = buildSubmitTool(demoCount, api);

    const result = await tool.execute({ values: { holders: 'p-hosp-a, p-hosp-b' } }, toolContext);

    expect(result.success).toBe(true);
    expect(api.submissions).toHaveLength(1);
    expect(api.submissions[0].submission).toMatchObject({
      scenarioId: 'demo-count',
      mode: 'direct',
      endpoint: '/mdop/jobs/demo-count',
      payload: {
        contracts: ['ct-1'],
        holders: [{ participantId: 'p-hosp-a' }, { participantId: 'p-hosp-b' }],
        minCell: 5,
      },
    });
  });

  it('校验不通过时不调用 API', async () => {
    const api = new FakeApiClient();
    const tool = buildSubmitTool(demoCount, api);
    const result = await tool.execute({ values: { holders: '' } }, toolContext);
    expect(result.success).toBe(false);
    expect(api.submissions).toHaveLength(0);
  });
});
