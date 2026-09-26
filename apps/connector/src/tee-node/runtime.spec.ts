import { signEnvelope, type Envelope } from '@medtrust/mdop';
import { TrustedNodeRuntime, type TrustedNodeRuntimeDeps } from './runtime';

/**
 * 节点长驻循环（任务 3.18）：把「每块都对」变成「整条能跑」。
 *
 * 钉四件事：① 同一批里**先应用清单与吊销再处置消息**；② 一条消息失败不影响其余；
 * ③ 轮询失败在 `runOnce` 可见、在循环里只告警退避（进程不因一次抖动退出）；
 * ④ 心跳与探针**到点才发**（且不因为失败就停摆）。
 */

const NODE = 'urn:tds:sh-med:participant:tee-1';

function envelope(msgType: string, msgId: string): Envelope {
  return {
    mdop: '0.2',
    msg_id: msgId,
    msg_type: msgType,
    job_id: 'job-1',
    sender: 'urn:tds:sh-med:participant:platform',
    receiver: NODE,
    timestamp: '2026-09-25T10:00:00.000Z',
    nonce: `n-${msgId}`,
    idempotency_key: `k-${msgId}`,
    body: {},
    sig: { alg: 'SM2-SM3', kid: 'x', value: 'y' },
  } as unknown as Envelope;
}

function harness(
  over: {
    batches?: Array<Partial<Awaited<ReturnType<TrustedNodeRuntimeDeps['poll']>>>>;
    failPoll?: boolean;
    handler?: (msgType: string) => Promise<unknown>;
  } = {},
) {
  const calls = {
    applied: [] as unknown[],
    revocations: [] as unknown[],
    handled: [] as string[],
    persisted: 0,
    hydrated: 0,
    heartbeats: 0,
    probes: 0,
  };
  let pollIndex = 0;
  const batches = over.batches ?? [{ messages: [], ignored: [], rejected: [], duplicates: 0 }];
  const deps: TrustedNodeRuntimeDeps = {
    node: NODE,
    router: {
      handle: async (envelope: Envelope) => {
        calls.handled.push(envelope.msg_id);
        if (over.handler) await over.handler(envelope.msg_type);
        return { msgType: envelope.msg_type, status: 'handled' };
      },
    } as never,
    operators: {
      applyManifests: (payload: unknown) => {
        calls.applied.push(payload);
        return Array.isArray(payload) ? payload.length : 0;
      },
      applyRevocations: (list: unknown) => {
        calls.revocations.push(list);
        return list !== undefined;
      },
    } as never,
    session: {} as never,
    artifacts: {} as never,
    receipts: {} as never,
    state: {
      hydrate: () => {
        calls.hydrated += 1;
      },
      persist: () => {
        calls.persisted += 1;
      },
    },
    poll: async () => {
      if (over.failPoll) throw new Error('E_RUNTIME: 平台不可达');
      const batch = batches[Math.min(pollIndex, batches.length - 1)];
      pollIndex += 1;
      return {
        messages: [],
        ignored: [],
        rejected: [],
        duplicates: 0,
        ...batch,
      } as Awaited<ReturnType<TrustedNodeRuntimeDeps['poll']>>;
    },
    heartbeat: async () => {
      calls.heartbeats += 1;
    },
    probe: async () => {
      calls.probes += 1;
    },
    now: () => new Date('2026-09-25T10:00:00.000Z'),
  };
  return { deps, calls };
}

describe('可信空间节点长驻循环（任务 3.18）', () => {
  it('一个 tick：先应用清单与吊销，再逐条处置消息，最后落盘', async () => {
    const { deps, calls } = harness({
      batches: [
        {
          messages: [
            { envelope: envelope('PlanFragmentOffer', 'm-1'), body: {} },
            { envelope: envelope('StageDispatch', 'm-2'), body: {} },
          ],
          mdopOperators: [{ ref: 'a', digest: 'd', manifest: {}, signature: {} }],
          mdopRevocations: { version: 2 },
          ignored: [],
          rejected: [],
          duplicates: 1,
        },
      ],
    });
    const runtime = new TrustedNodeRuntime(deps, { heartbeatIntervalMs: 60_000, probeIntervalMs: 300_000 });
    const tick = await runtime.runOnce({ waitMs: 0 });

    expect(calls.hydrated).toBe(1); // 构造时先把盘上状态载入内存
    expect(tick.manifests).toBe(1);
    expect(tick.revocations).toBe(true);
    expect(tick.polled).toBe(2);
    expect(tick.duplicates).toBe(1);
    expect(tick.handled.map((h) => h.msgType)).toEqual(['PlanFragmentOffer', 'StageDispatch']);
    // 顺序：清单/吊销在消息之前被应用（否则同批刚到的新清单赶不上这一批的复核）
    expect(calls.applied[0]).toHaveLength(1);
    expect(calls.handled).toEqual(['m-1', 'm-2']);
    expect(calls.persisted).toBe(1);
  });

  it('一条消息失败不影响其余（错误逐条留痕，等平台按至少一次投递重发）', async () => {
    const { deps, calls } = harness({
      batches: [
        {
          messages: [
            { envelope: envelope('PlanFragmentOffer', 'm-1'), body: {} },
            { envelope: envelope('StageDispatch', 'm-2'), body: {} },
            { envelope: envelope('PurgeOrder', 'm-3'), body: {} },
          ],
        },
      ],
      handler: async (msgType) => {
        if (msgType === 'StageDispatch') throw new Error('E_TICKET_INVALID: 没凭证');
      },
    });
    const tick = await new TrustedNodeRuntime(deps).runOnce({ waitMs: 0 });
    expect(tick.handled.map((h) => h.msgType)).toEqual(['PlanFragmentOffer', 'PurgeOrder']);
    expect(tick.failed).toEqual([{ msgId: 'm-2', reason: 'E_TICKET_INVALID: 没凭证' }]);
    expect(calls.persisted).toBe(1);
  });

  it('心跳与探针到点才发（第一次必发，间隔内不重复）', async () => {
    const { deps, calls } = harness();
    const runtime = new TrustedNodeRuntime(deps, {
      heartbeatIntervalMs: 60_000,
      probeIntervalMs: 300_000,
    });
    const first = await runtime.runOnce({ waitMs: 0, now: new Date('2026-09-25T10:00:00.000Z') });
    expect(first.heartbeat).toBe(true);
    expect(first.probe).toBe(true);
    const second = await runtime.runOnce({ waitMs: 0, now: new Date('2026-09-25T10:00:30.000Z') });
    expect(second.heartbeat).toBe(false);
    expect(second.probe).toBe(false);
    const third = await runtime.runOnce({ waitMs: 0, now: new Date('2026-09-25T10:01:30.000Z') });
    expect(third.heartbeat).toBe(true);
    expect(third.probe).toBe(false);
    expect(calls.heartbeats).toBe(2);
    expect(calls.probes).toBe(1);
  });

  it('心跳/探针失败只告警（在途作业不受影响），轮询失败在 runOnce 抛出', async () => {
    const { deps } = harness();
    const runtime = new TrustedNodeRuntime(
      {
        ...deps,
        heartbeat: async () => {
          throw new Error('HTTP 503');
        },
        probe: async () => {
          throw new Error('HTTP 500');
        },
      },
      { heartbeatIntervalMs: 0, probeIntervalMs: 0 },
    );
    const tick = await runtime.runOnce({ waitMs: 0 });
    expect(tick.heartbeat).toBe(false);
    expect(tick.probe).toBe(false);
    expect(tick.warnings).toEqual([
      '心跳失败：HTTP 503',
      '证明探针失败：HTTP 500',
    ]);

    const failing = harness({ failPoll: true });
    await expect(new TrustedNodeRuntime(failing.deps).runOnce({ waitMs: 0 })).rejects.toThrow(
      /平台不可达/,
    );
  });

  it('循环不因一次轮询失败退出：start() → 失败后继续 → stop() 干净收尾', async () => {
    let attempts = 0;
    const { deps } = harness();
    const runtime = new TrustedNodeRuntime(
      {
        ...deps,
        poll: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('E_RUNTIME: 平台不可达');
          // 第二轮成功之后立刻停：避免测试空转
          void runtime.stop();
          return { messages: [], ignored: [], rejected: [], duplicates: 0 };
        },
      },
      { failureBackoffMs: 1 },
    );
    runtime.start();
    expect(runtime.isRunning()).toBe(true);
    // 等循环自己把「失败 → 退避 → 再试」跑完（第二轮成功后由上面的 poll 自行停）
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(runtime.isRunning()).toBe(false);
    await runtime.stop();
    expect(attempts).toBeGreaterThanOrEqual(2); // 第一次失败后**继续**跑了第二次
  });
});
