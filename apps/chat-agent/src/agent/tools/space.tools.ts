import type { Tool } from '@medtrust/pi-agent';
import { asChatContext } from '../context';
import type { MedTrustApiClient } from './api-client';

/** 空间目录查询工具：只回参与方与数据产品的**元数据**，不回任何数据内容。 */
export function buildSpaceTools(api: MedTrustApiClient): Tool[] {
  return [
    {
      name: 'list_participants',
      description:
        '列出当前空间内可用的参与方与数据产品（仅元数据：id 与名称；不含任何数据内容）。出卡片前如果不知道候选，先调它。',
      parameters: {
        type: 'object',
        properties: {
          spaceId: { type: 'string', description: '空间 id（缺省用当前会话的空间）' },
        },
      },
      execute: async (params, context) => {
        const ctx = asChatContext(context);
        const requested =
          typeof params === 'object' && params !== null
            ? (params as { spaceId?: unknown }).spaceId
            : undefined;
        const spaceId = typeof requested === 'string' && requested ? requested : ctx.spaceId;
        const directory = await api.listDirectory(spaceId);
        return { success: true, data: { spaceId, ...directory } };
      },
    },
  ];
}
