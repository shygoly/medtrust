import type { ToolContext } from '@medtrust/pi-agent';
import { buildTemplateTools } from './template.tools';

const tools = buildTemplateTools();
const compare = tools.find((tool) => tool.name === 'compare_scenarios')!;
const list = tools.find((tool) => tool.name === 'list_scenarios')!;
const ctx = { spaceId: '' } as ToolContext;
const medCtx = { spaceId: 'sh-med' } as ToolContext;
const powerCtx = { spaceId: 'hn-power' } as ToolContext;

describe('compare_scenarios（3.3.2 场景对比）', () => {
  it('两个以上有效场景 → 差异表（模板 / 提交方式 / 适用描述）', async () => {
    const result = await compare.execute(
      { scenarioIds: ['external-control', 'fl-prediction', 'load-forecast'] },
      ctx,
    );
    expect(result.success).toBe(true);
    const data = result.data as {
      compared: string[];
      rows: Array<{ id: string; submitMode: string; goodFor: string[] }>;
    };
    expect(data.compared).toEqual(['external-control', 'fl-prediction', 'load-forecast']);
    expect(data.rows[0]).toMatchObject({ id: 'external-control', submitMode: 'direct' });
    expect(data.rows[2]).toMatchObject({ id: 'load-forecast', submitMode: 'template' });
    expect(data.rows[0].goodFor.length).toBeGreaterThan(0);
  });

  it('不足两个有效场景 → 明确报错，而不是给一张空表', async () => {
    expect(await compare.execute({ scenarioIds: ['external-control'] }, ctx)).toMatchObject({
      success: false,
    });
    const mixed = await compare.execute({ scenarioIds: ['external-control', 'nope'] }, ctx);
    expect(mixed.success).toBe(false);
    expect(mixed.error).toContain('至少需要两个有效场景');
  });

  it('入参不是数组时不抛错', async () => {
    expect(await compare.execute({}, ctx)).toMatchObject({ success: false });
    expect(await compare.execute({ scenarioIds: 'external-control' }, ctx)).toMatchObject({
      success: false,
    });
  });
});

describe('list_scenarios', () => {
  it('无 spaceId 时列出全部场景（含注册研究）', async () => {
    const result = await list.execute({}, ctx);
    expect(result.success).toBe(true);
    expect((result.data as { scenarios: unknown[] }).scenarios).toHaveLength(8);
  });

  it('医疗空间只列 med 包场景', async () => {
    const result = await list.execute({}, medCtx);
    const scenarios = (result.data as { scenarios: Array<{ id: string; pack: string }> }).scenarios;
    expect(scenarios.every((s) => s.pack === 'med')).toBe(true);
    expect(scenarios.map((s) => s.id)).toEqual(
      expect.arrayContaining([
        'external-control',
        'external-control-registration',
        'fl-prediction',
        'cohort-count',
      ]),
    );
    expect(scenarios.map((s) => s.id)).not.toContain('load-forecast');
  });

  it('电力空间只列 power 包场景', async () => {
    const result = await list.execute({}, powerCtx);
    const scenarios = (result.data as { scenarios: Array<{ id: string; pack: string }> }).scenarios;
    expect(scenarios.map((s) => s.id).sort()).toEqual(
      ['demand-response', 'load-forecast', 'theft-detection'].sort(),
    );
  });

  it('按关键词过滤', async () => {
    const result = await list.execute({ keyword: '窃电' }, powerCtx);
    const scenarios = (result.data as { scenarios: Array<{ id: string }> }).scenarios;
    expect(scenarios.map((scenario) => scenario.id)).toEqual(['theft-detection']);
  });
});
