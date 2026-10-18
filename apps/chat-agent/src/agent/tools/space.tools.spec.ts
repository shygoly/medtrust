import type { ToolContext } from '@medtrust/pi-agent';
import { FakeApiClient, FAKE_DIRECTORY } from '../../test-utils/fake-api-client';
import { buildSpaceTools } from './space.tools';

const context = (over: Partial<ToolContext> = {}): ToolContext => ({
  userId: 'u-1',
  spaceId: 'sh-med',
  sessionId: 's-1',
  accessToken: 'tk',
  directory: FAKE_DIRECTORY,
  ...over,
});

describe('list_participants（空间目录工具）', () => {
  const tool = () => buildSpaceTools(new FakeApiClient());

  it('返回参与方与数据产品元数据（不含任何数据内容）', async () => {
    const result = await tool()[0].execute({}, context());
    expect(result.success).toBe(true);
    const data = result.data as { spaceId: string; participants: unknown[]; dataProducts: unknown[] };
    expect(data.spaceId).toBe('sh-med');
    expect(data.participants.length).toBeGreaterThan(0);
    expect(data.dataProducts.length).toBeGreaterThan(0);
  });

  it('显式 spaceId 覆盖上下文里的空间', async () => {
    const api = new FakeApiClient();
    const result = await buildSpaceTools(api)[0].execute({ spaceId: 'power-space' }, context());
    expect((result.data as { spaceId: string }).spaceId).toBe('power-space');
    expect(api.directoryCalls.at(-1)?.spaceId).toBe('power-space');
  });
});
