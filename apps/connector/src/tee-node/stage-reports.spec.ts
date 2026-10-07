import { canonicalSm3, generateSm2KeyPair, type Envelope } from '@medtrust/mdop';
import { MdopOutboundClient, MdopOutboundHttpError } from '../mdop/mdop-client';
import { NodeArtifactStore } from '../mdop/node/node-artifacts';
import { NodeReceiptChain } from '../mdop/node/node-receipts';
import { NodeReceiptReporter } from './receipt-report';
import {
  StageReportRefused,
  finishStageReporting,
  outstandingReports,
  publishedC3Source,
  type PendingStageReports,
  type StageArtifactRef,
  type StageReportDeps,
} from './stage-reports';

/**
 * 阶段执行之后的上报（2026-10-07 真机复现 job-muy1ioki-b12ae3e7 的回归）。
 *
 * 路由器级的用例（`node-messages.spec.ts`）钉的是「不重跑」；这里钉上报本身的两条判据：
 *  ① C3 载荷只从节点制品库取，而且只认出口守卫放行的那一份（补投不比首投多放行任何东西）；
 *  ② 上报失败分「没送到」与「被拒」——前者什么都不报、等重发再补，后者如实报阶段失败。
 */

const NODE = 'urn:tds:sh-med:participant:tee-node-a';
const PLATFORM = 'urn:tds:sh-med:participant:platform';
const JOB = 'job-reports';
const STAGE = 'decTee';
const HANDLE = `art://${NODE}/${JOB}/${STAGE}`;
const KEYS = generateSm2KeyPair();
const NOW = new Date('2026-10-07T12:00:00.000Z');
const PAYLOAD = { analysisType: 'vaccine-scri', cohortSize: 42, buckets: [{ key: 'all', count: 42 }] };
const DIGEST = canonicalSm3(PAYLOAD);

function fixture(over: { exited?: boolean; label?: string; payload?: Record<string, unknown> } = {}) {
  const artifacts = new NodeArtifactStore({ node: NODE, privateKey: KEYS.privateKey });
  const chain = new NodeReceiptChain({ node: NODE, privateKey: KEYS.privateKey });
  artifacts.put({
    handle: HANDLE,
    jobId: JOB,
    label: over.label ?? 'C3',
    digest: DIGEST,
    payload: over.payload ?? PAYLOAD,
    expiresAt: new Date(NOW.getTime() + 72 * 3_600_000).toISOString(),
  });
  chain.append({ jobId: JOB, stage: STAGE, event: 'EXECUTED', opDigest: 'component:x@1', outputDigest: DIGEST });
  if (over.exited !== false)
    chain.append({
      jobId: JOB,
      stage: STAGE,
      event: 'EXITED',
      opDigest: 'component:node-exit@1',
      outputDigest: DIGEST,
      label: 'C3',
    });

  const outbound = new MdopOutboundClient({
    baseUrl: 'http://127.0.0.1:1/api/v1',
    participantId: 'tee-node-a',
    privateKey: KEYS.privateKey,
  });
  const sent: Array<{ kind: string; body: Record<string, unknown>; payload?: unknown }> = [];
  let fault: ((kind: string) => Error | undefined) | undefined;
  const pass = (kind: string) => {
    const err = fault?.(kind);
    if (err) throw err;
  };
  (outbound as unknown as { sendMessage: unknown }).sendMessage = async (envelope: Envelope) => {
    pass(envelope.msg_type);
    sent.push({ kind: envelope.msg_type, body: envelope.body as Record<string, unknown> });
    return { accepted: true };
  };
  (outbound as unknown as { sendDelivery: unknown }).sendDelivery = async (
    envelope: Envelope,
    _handle: unknown,
    payload: unknown,
  ) => {
    pass('DELIVERY');
    sent.push({ kind: 'DELIVERY', body: envelope.body as Record<string, unknown>, payload });
    return { accepted: true };
  };
  const receipts = new NodeReceiptReporter({ receipts: chain, outbound, platform: PLATFORM });
  const deps: StageReportDeps = {
    outbound,
    platform: PLATFORM,
    receipts,
    c3Payload: publishedC3Source({ artifacts, receipts, now: () => NOW }),
  };
  return {
    artifacts,
    chain,
    receipts,
    deps,
    sent,
    failWith: (rule: (kind: string) => Error | undefined) => {
      fault = rule;
    },
  };
}

const ref = (): StageArtifactRef => ({
  stage: { id: STAGE, op: 'declassify.small_cell@1.0.0', op_digest: 'component:x@1', output_schema: 'mdop.table/1.0' },
  handle: HANDLE,
  label: 'C3',
  digest: DIGEST,
  expiresAt: new Date(NOW.getTime() + 72 * 3_600_000).toISOString(),
});
const pendingAll = (): PendingStageReports => ({ handle: ref(), delivery: ref(), receipts: true });
const run = (deps: StageReportDeps, pending: PendingStageReports, attempt = 1) =>
  finishStageReporting(deps, {
    jobId: JOB,
    credentialId: 'tkt-1',
    stageId: STAGE,
    attempt,
    digest: DIGEST,
    label: 'C3',
    pending,
    statusReported: false,
  });
const c3 = (f: ReturnType<typeof fixture>) =>
  f.deps.c3Payload({ jobId: JOB, stageId: STAGE, handle: HANDLE, digest: DIGEST });
const refusal = (f: ReturnType<typeof fixture>): StageReportRefused => {
  try {
    c3(f);
  } catch (err) {
    return err as StageReportRefused;
  }
  throw new Error('本该拒绝，却取到了载荷');
};

describe('C3 载荷的唯一来源：节点制品库里出口守卫放行的那一份', () => {
  it('制品在、是 C3、摘要重算一致、链上有 EXITED → 取到的就是那一份', () => {
    expect(c3(fixture())).toEqual(PAYLOAD);
  });

  it('已销毁（PurgeOrder）→ 取不到：销毁过的作业不可再投', () => {
    const f = fixture();
    f.artifacts.purge({ jobId: JOB, reason: 'purge-order', idempotencyKey: `purge:${JOB}` });
    expect(refusal(f)).toBeInstanceOf(StageReportRefused);
    expect(refusal(f).message).toMatch(/已销毁或已到期/);
  });

  it('已过保留期 → 同样取不到（到期的制品不因为「还没来得及删」就能出域）', () => {
    const f = fixture();
    const late = publishedC3Source({
      artifacts: f.artifacts,
      receipts: f.receipts,
      now: () => new Date(NOW.getTime() + 73 * 3_600_000),
    });
    expect(() => late({ jobId: JOB, stageId: STAGE, handle: HANDLE, digest: DIGEST })).toThrow(/已销毁或已到期/);
  });

  it('制品库里的载荷被换过（摘要重算对不上）→ E_RELEASE_CHECK_FAILED', () => {
    const err = refusal(fixture({ payload: { ...PAYLOAD, cohortSize: 43 } }));
    expect(err.code).toBe('E_RELEASE_CHECK_FAILED');
  });

  it('同句柄下是一份没出过口的制品（链上没有它的 EXITED）→ 拒：发布审查与出口守卫没放行过的东西不投', () => {
    // 有同节点下游的 C3 中间产物就是这种形态：进了制品库、标着 C3，但从没走过出口
    const err = refusal(fixture({ exited: false }));
    expect(err.code).toBe('E_RELEASE_CHECK_FAILED');
    expect(err.message).toMatch(/EXITED/);
  });

  it('等级不是 C3 → 拒（数据面只出 C3）', () => {
    expect(refusal(fixture({ label: 'C2' })).code).toBe('E_RELEASE_CHECK_FAILED');
  });
});

describe('上报失败分两种：没送到（等重发再补） / 被拒（如实报阶段失败）', () => {
  const statusOf = (f: ReturnType<typeof fixture>) =>
    f.sent.filter((s) => s.kind === 'StageStatus').map((s) => ({ status: s.body.status, code: s.body.code }));

  it('全部送达：句柄 → C3 → 回执链 → 成功状态（状态最后发），清单清空', async () => {
    const f = fixture();
    const pending = pendingAll();
    const result = await run(f.deps, pending);
    expect(result).toMatchObject({ complete: true, statusReported: true, delivered: true, receipts: 2 });
    expect(f.sent.map((s) => s.kind)).toEqual([
      'ArtifactReady',
      'DELIVERY',
      'AuditReceipt',
      'AuditReceipt',
      'StageStatus',
    ]);
    expect(f.sent[1].payload).toEqual(PAYLOAD);
    expect(outstandingReports(pending)).toEqual([]);
  });

  it.each([
    ['链路不通', () => new Error('fetch failed')],
    ['平台 5xx', () => new MdopOutboundHttpError('/mdop/deliveries', 502)],
    ['被限流 429', () => new MdopOutboundHttpError('/mdop/deliveries', 429)],
  ])('C3 投递没送到（%s）→ 停在这一步，什么状态都不报；下一次接着补，已送达的不重发', async (_name, error) => {
    const f = fixture();
    const pending = pendingAll();
    f.failWith((kind) => (kind === 'DELIVERY' ? error() : undefined));

    const first = await run(f.deps, pending);
    expect(first).toMatchObject({ complete: false, statusReported: false, handleRegistered: true, delivered: false });
    expect(first.stalled?.step).toBe('delivery');
    expect(first.rejected).toBeUndefined();
    expect(first.outstanding).toEqual(['delivery', 'receipts', 'status']);
    expect(statusOf(f)).toEqual([]); // 既不报成功（C3 还没到），也不报失败（阶段已经执行完）

    f.failWith(() => undefined);
    const second = await run(f.deps, pending);
    expect(second).toMatchObject({ complete: true, delivered: true });
    expect(f.sent.filter((s) => s.kind === 'ArtifactReady')).toHaveLength(1);
    expect(f.sent.filter((s) => s.kind === 'DELIVERY')).toHaveLength(1);
    expect(statusOf(f)).toEqual([{ status: 'SUCCEEDED', code: undefined }]);
  });

  it('平台明确拒收（4xx）→ 报阶段失败：带协议错误码的沿用它，没有的记 E_RUNTIME；清单不动（以后只会再试上报）', async () => {
    const withCode = fixture();
    withCode.failWith((kind) =>
      kind === 'DELIVERY' ? new MdopOutboundHttpError('/mdop/deliveries', 400, 'E_LABEL_VIOLATION') : undefined,
    );
    const pending = pendingAll();
    const rejected = await run(withCode.deps, pending, 2);
    expect(rejected.rejected).toMatchObject({ step: 'delivery', code: 'E_LABEL_VIOLATION', failureReported: true });
    expect(statusOf(withCode)).toEqual([{ status: 'FAILED', code: 'E_LABEL_VIOLATION' }]);
    expect(withCode.sent.find((s) => s.kind === 'StageStatus')?.body).toMatchObject({ attempt: 2 });
    expect(outstandingReports(pending)).toEqual(['delivery', 'receipts']);

    const bare = fixture();
    bare.failWith((kind) => (kind === 'DELIVERY' ? new MdopOutboundHttpError('/mdop/deliveries', 403) : undefined));
    await run(bare.deps, pendingAll());
    expect(statusOf(bare)).toEqual([{ status: 'FAILED', code: 'E_RUNTIME' }]);
  });

  it('本节点判定不可投（制品已销毁）→ 不出站投递，报阶段失败', async () => {
    const f = fixture();
    f.artifacts.purge({ jobId: JOB, reason: 'purge-order', idempotencyKey: `purge:${JOB}` });
    const result = await run(f.deps, pendingAll());
    expect(result.rejected).toMatchObject({ step: 'delivery' });
    expect(f.sent.some((s) => s.kind === 'DELIVERY')).toBe(false);
    expect(statusOf(f)).toEqual([{ status: 'FAILED', code: 'E_RUNTIME' }]);
  });

  it('成功状态本身没送到 / 被平台以非法迁移拒掉 → 只是「状态待补」，不报失败', async () => {
    const f = fixture();
    f.failWith((kind) =>
      kind === 'StageStatus' ? new MdopOutboundHttpError('/mdop/messages', 400, 'E_RUNTIME') : undefined,
    );
    const pending = pendingAll();
    const result = await run(f.deps, pending);
    expect(result).toMatchObject({ complete: false, statusReported: false, delivered: true });
    expect(result.stalled?.step).toBe('status');
    expect(result.rejected).toBeUndefined();
    expect(result.outstanding).toEqual(['status']);
    expect(statusOf(f)).toEqual([]);
  });
});
