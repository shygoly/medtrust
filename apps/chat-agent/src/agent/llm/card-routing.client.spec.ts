import type { LLMClient, LLMMessage, LLMResponse, Tool } from '@medtrust/pi-agent';
import { encodeCardSubmission } from '@medtrust/chat-cards';
import type { ScenarioBuildContext } from '../scenarios';
import { CardRoutingLlmClient } from './card-routing.client';

const ctx: ScenarioBuildContext = {
  spaceId: 'sh-med',
  userId: 'u-1',
  directory: { participants: [], dataProducts: [] },
  defaults: {
    purpose: '测试用途',
    applicant: { org: 'u-1', project: 'sh-med' },
    contracts: [],
    notBefore: '2026-01-01T00:00:00.000Z',
    notAfter: '2026-04-01T00:00:00.000Z',
    minCell: 5,
    teeNode: 'urn:tds:sh-med:participant:tee-node-a',
  },
};

const tools: Tool[] = [
  {
    name: 'submit_external_control',
    description: 'submit',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ success: true }),
  },
  {
    name: 'request_contract',
    description: 'request contract',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ success: true }),
  },
];

function delegate(): LLMClient & { calls: number } {
  return {
    calls: 0,
    async complete(): Promise<LLMResponse> {
      this.calls += 1;
      return { content: 'delegated' };
    },
  };
}

describe('CardRoutingLlmClient', () => {
  it('表单提交不经模型解释，原样调用场景工具', async () => {
    const inner = delegate();
    const client = new CardRoutingLlmClient(inner, ctx);
    const values = {
      trial: 'p-huashan',
      controls: 'p-ruijin',
      trialDataProduct: 'dp-a',
      controlsDataProduct: 'dp-b',
      strataKeys: '<40|M',
      caliperDays: 30,
      ratioK: 2,
    };
    const response = await client.complete(
      [
        {
          role: 'user',
          content: encodeCardSubmission({
            kind: 'card-submit',
            cardType: 'form',
            title: '外部对照配置',
            scenario: 'external-control',
            values,
          }),
        },
      ],
      tools,
    );
    expect(inner.calls).toBe(0);
    expect(response.toolCalls).toEqual([
      expect.objectContaining({
        name: 'submit_external_control',
        parameters: { values },
      }),
    ]);
  });

  it('合约审批卡直接调用 request_contract', async () => {
    const inner = delegate();
    const client = new CardRoutingLlmClient(inner, ctx);
    const response = await client.complete(
      [
        {
          role: 'user',
          content: encodeCardSubmission({
            kind: 'card-submit',
            cardType: 'contract_approval',
            title: '合约申请',
            values: { action: 'request_contract', dataProductId: 'dp-a' },
          }),
        },
      ],
      tools,
    );
    expect(inner.calls).toBe(0);
    expect(response.toolCalls?.[0]).toMatchObject({ name: 'request_contract' });
  });

  it('自然语言消息仍交给底层 LLM', async () => {
    const inner = delegate();
    const client = new CardRoutingLlmClient(inner, ctx);
    const messages: LLMMessage[] = [{ role: 'user', content: '我想做外部对照' }];
    await expect(client.complete(messages, tools)).resolves.toMatchObject({ content: 'delegated' });
    expect(inner.calls).toBe(1);
  });
});
