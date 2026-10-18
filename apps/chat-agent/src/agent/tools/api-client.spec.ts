import type { ScenarioSubmission } from '../scenarios';
import { HttpMedTrustApiClient } from './api-client';

/**
 * 真 HTTP 客户端（HttpMedTrustApiClient）的用例。
 *
 * 别的用例都用 FakeApiClient 替身，因此**模板两步**（plans/preview → jobs）与目录映射
 * 一直只有集成/e2e 覆盖。这里用打桩的 fetch 把这段逻辑钉住，包括错误路径。
 */
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const withFetch = async (
  handler: (url: string, init?: RequestInit) => Response,
  run: () => Promise<void>,
): Promise<void> => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
};

const client = () =>
  new HttpMedTrustApiClient({
    apiUrl: 'http://cp.test',
    apiPrefix: '/api/v1',
    serviceToken: 'svc-token',
  });

describe('HttpMedTrustApiClient', () => {
  it('目录映射：数据产品取标题，参与方按 providerId 去重', async () => {
    await withFetch(
      () =>
        jsonResponse({
          items: [
            { id: 'dp-1', title: '试验组数据', providerId: 'p-a' },
            { id: 'dp-2', title: '对照组数据', providerId: 'p-a' },
            { id: 'dp-3', title: '其它数据', providerId: 'p-b' },
          ],
        }),
      async () => {
        const directory = await client().listDirectory('sh-med');
        expect(directory.dataProducts).toHaveLength(3);
        expect(directory.participants.map((p) => p.id)).toEqual(['p-a', 'p-b']);
      },
    );
  });

  it('目录读取用 agent 自有凭证，不借调用者 token（AGENT.md R2）', async () => {
    let seenAuth: string | undefined;
    await withFetch(
      (_url, init) => {
        seenAuth = (init?.headers as Record<string, string> | undefined)?.authorization;
        return jsonResponse({ items: [] });
      },
      async () => {
        await client().listDirectory('sh-med');
      },
    );
    expect(seenAuth).toBe('Bearer svc-token');
  });

  it('目录不可用时返回空目录（降级，不抛）', async () => {
    await withFetch(() => jsonResponse({ message: 'boom' }, 500), async () => {
      await expect(client().listDirectory('sh-med')).resolves.toEqual({
        participants: [],
        dataProducts: [],
      });
    });
  });

  it('direct：直接 POST 场景端点并带上调用者令牌', async () => {
    const calls: Array<{ url: string; body: unknown; auth?: string }> = [];
    await withFetch(
      (url, init) => {
        calls.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          auth: (init?.headers as Record<string, string> | undefined)?.authorization,
        });
        return jsonResponse({ jobId: 'job-1', status: 'submitted', template: 'rws.external-control' });
      },
      async () => {
        const submission: ScenarioSubmission = {
          scenarioId: 'external-control',
          mode: 'direct',
          endpoint: '/mdop/jobs/external-control',
          analysisKey: 'mdop.external-control',
          payload: { trial: { participantId: 'p-a' } },
        };
        const result = await client().submitScenario(submission, {
          userId: 'u-1',
          spaceId: 'sh-med',
          token: 'user-token',
        });
        expect(result.jobId).toBe('job-1');
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://cp.test/api/v1/mdop/jobs/external-control');
    expect(calls[0].body).toEqual({ trial: { participantId: 'p-a' } });
    // 提交是"用户的动作"：带调用者令牌，而不是 agent 自己的
    expect(calls[0].auth).toBe('Bearer user-token');
  });

  it('template：先 plans/preview 再 jobs，并补上 analysisKey', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    await withFetch(
      (url, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        calls.push({ url, body });
        if (url.endsWith('/mdop/plans/preview')) {
          return jsonResponse({
            purpose: 'p',
            applicant: { org: 'o', project: 'j' },
            contracts: ['ct-1'],
            stages: [{ id: 's1', op: 'x', inputs: [] }],
            not_before: 'a',
            not_after: 'b',
          });
        }
        return jsonResponse({ jobId: 'job-2', status: 'submitted' });
      },
      async () => {
        const submission: ScenarioSubmission = {
          scenarioId: 'load-forecast',
          mode: 'template',
          template: 'power.load-forecast',
          analysisKey: 'power.load-forecast',
          templateInput: { participants: [{ participantId: 'p-grid-a' }] },
        };
        const result = await client().submitScenario(submission, {
          userId: 'u-1',
          spaceId: 'sh-med',
        });
        expect(result.jobId).toBe('job-2');
        expect(result.plan).toMatchObject({ stages: [{ id: 's1' }] });
      },
    );

    expect(calls.map((call) => call.url)).toEqual([
      'http://cp.test/api/v1/mdop/plans/preview',
      'http://cp.test/api/v1/mdop/jobs',
    ]);
    expect(calls[0].body).toEqual({
      template: 'power.load-forecast',
      input: { participants: [{ participantId: 'p-grid-a' }] },
    });
    expect(calls[1].body.analysisKey).toBe('power.load-forecast');
    expect(calls[1].body.stages).toHaveLength(1);
  });

  it('非 2xx：抛出含状态码与服务端 message 的错误', async () => {
    await withFetch(
      () => jsonResponse({ message: '[E_CHANNEL_UNKNOWN] 未登记' }, 409),
      async () => {
        await expect(
          client().submitScenario(
            {
              scenarioId: 'x',
              mode: 'direct',
              endpoint: '/mdop/jobs/x',
              analysisKey: 'x',
              payload: {},
            },
            { userId: 'u', spaceId: 's' },
          ),
        ).rejects.toThrow(/409 \[E_CHANNEL_UNKNOWN\]/);
      },
    );
  });

  it('缺端点 / 缺模板时立即报错，不发请求', async () => {
    let called = 0;
    await withFetch(
      () => {
        called += 1;
        return jsonResponse({});
      },
      async () => {
        await expect(
          client().submitScenario(
            { scenarioId: 'x', mode: 'direct', analysisKey: 'x' },
            { userId: 'u', spaceId: 's' },
          ),
        ).rejects.toThrow(/缺少提交端点/);
        await expect(
          client().submitScenario(
            { scenarioId: 'y', mode: 'template', analysisKey: 'y' },
            { userId: 'u', spaceId: 's' },
          ),
        ).rejects.toThrow(/缺少模板 id/);
      },
    );
    expect(called).toBe(0);
  });
});
