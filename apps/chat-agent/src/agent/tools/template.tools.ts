import type { Tool } from '@medtrust/pi-agent';
import { findScenario, SCENARIOS } from '../scenarios';

/** 模板/场景信息查询与场景对比：让模型不必「记住」场景表。 */
export function buildTemplateTools(): Tool[] {
  return [
    {
      name: 'compare_scenarios',
      description:
        '对比两个以上场景的适用条件与差异（模板、提交方式、关键参数、适用描述）。用户在多方案之间犹豫时用。',
      parameters: {
        type: 'object',
        properties: {
          scenarioIds: {
            type: 'array',
            items: { type: 'string' },
            description: '要对比的场景 id（至少 2 个，见 list_scenarios）',
          },
        },
        required: ['scenarioIds'],
      },
      execute: async (params) => {
        const raw =
          typeof params === 'object' && params !== null
            ? (params as { scenarioIds?: unknown }).scenarioIds
            : undefined;
        const ids = Array.isArray(raw) ? raw.map((id) => String(id)) : [];
        const scenarios = ids
          .map((id) => findScenario(id))
          .filter((scenario): scenario is NonNullable<typeof scenario> => Boolean(scenario));

        if (scenarios.length < 2) {
          return {
            success: false,
            error: `至少需要两个有效场景 id（收到：${ids.join(', ') || '空'}）`,
          };
        }

        return {
          success: true,
          data: {
            compared: scenarios.map((scenario) => scenario.id),
            rows: scenarios.map((scenario) => ({
              id: scenario.id,
              title: scenario.title,
              template: scenario.template,
              submitMode: scenario.mode,
              description: scenario.description,
              goodFor: scenario.examples,
              keywords: scenario.keywords,
            })),
          },
        };
      },
    },
    {
      name: 'list_scenarios',
      description: '列出平台当前支持的场景（id、标题、说明、适用描述）。场景不明确时先调它。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '可选：按关键词过滤' },
        },
      },
      execute: async (params) => {
        const keyword =
          typeof params === 'object' && params !== null
            ? String((params as { keyword?: unknown }).keyword ?? '')
            : '';
        const scenarios = SCENARIOS.filter(
          (scenario) =>
            keyword === '' ||
            scenario.title.includes(keyword) ||
            scenario.description.includes(keyword) ||
            scenario.keywords.some((word) => word.includes(keyword)),
        ).map((scenario) => ({
          id: scenario.id,
          title: scenario.title,
          description: scenario.description,
          template: scenario.template,
          toolName: scenario.toolName,
          examples: scenario.examples,
        }));
        return { success: true, data: { scenarios } };
      },
    },
  ];
}
