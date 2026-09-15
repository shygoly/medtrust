import { ControlPlaneClient } from './control-plane-client';
import { sm3Hex } from './sm3';

// 平台口径（apps/api rws-orchestrator.service.ts aggregateSm3）：平台拿到的是 JSON 解析后的对象，
// 对它做键排序稳定序列化再 SM3。连接器回传的哈希必须与之一致，否则平台拒绝入库。
function platformStableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => platformStableStringify(v)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${platformStableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

describe('ControlPlaneClient.completeAssignment', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('回传哈希与平台对 JSON 解析结果的哈希一致（含 undefined 键与非有限数）', async () => {
    let sent: { aggregate: unknown; aggregateHash: string } | undefined;
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return { ok: true, status: 201, text: async () => '' } as Response;
    }) as unknown as typeof fetch;

    const client = new ControlPlaneClient({ baseUrl: 'http://cp.test/api/v1', participantId: 'p-test', connectorToken: 't' });
    // L2 比较效果的真实聚合形状：warnings/kmCurve 未产出时为 undefined，零格分层的 SE 为 Infinity。
    await client.completeAssignment('a-1', {
      aggregate: {
        cohortSize: 5000,
        warnings: undefined,
        kmCurve: undefined,
        effectEstimate: { mantelHaenszel: { standardError: Infinity, ci95: [0, Infinity] } },
      },
    });

    expect(sent).toBeDefined();
    expect(sent!.aggregateHash).toBe(sm3Hex(platformStableStringify(sent!.aggregate)));
  });
});
