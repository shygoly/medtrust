import { sm2 } from 'sm-crypto';
import { ConnectorWorkerService } from './connector-worker.service';
import { TaskProgressReporter } from './task-progress-reporter';
import { ControlPlaneClient } from './control-plane-client';
import { ConnectorTaskRunner } from './connector-task-runner';
import { DataProductLocalSource } from './data-product-local-source';
import { FlTaskRunner } from './fl-prediction/fl-task-runner';
import { AuditService } from './audit';
import {
  SignedConnectorTask,
  connectorTaskSignaturePayload,
  connectorTaskSm3,
} from './connector-task-signature';

const keypair = sm2.generateKeyPairHex();
const PARTICIPANT = 'p-ruijin';

/** 平台侧签名(测试内用同一套口径签,连接器用固定公钥验)。 */
function sign<T>(
  kind: 'rws' | 'fl-prediction' | 'fl-round',
  taskId: string,
  payload: T,
  over: Partial<SignedConnectorTask<T>> = {},
): SignedConnectorTask<T> {
  const base = {
    participantId: PARTICIPANT,
    taskKind: kind,
    taskId,
    issuedAt: new Date().toISOString(),
    payload,
  };
  const sm3 = connectorTaskSm3(base);
  return {
    kind,
    participantId: PARTICIPANT,
    taskId,
    issuedAt: base.issuedAt,
    payload,
    sm3,
    signature: sm2.doSignature(connectorTaskSignaturePayload(sm3), keypair.privateKey),
    algorithm: 'SM2-SM3',
    ...over,
  } as SignedConnectorTask<T>;
}

const rwsPayload = {
  assignmentId: 'a1',
  taskId: 't1',
  purpose: 'PV',
  workloadType: 'rws' as const,
  analysis: { type: 'cohort-count' },
  contract: {
    id: 'c1',
    dataProductId: 'dp1',
    providerId: PARTICIPANT,
    consumerId: 'p-meddata',
    purpose: 'PV',
    retention: '阅后即焚',
    output: '仅聚合',
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    status: 'active' as const,
  },
};

function buildWorker(controlPlane: Record<string, unknown>, audit: unknown) {
  const productSource = { registerProduct: jest.fn() };
  const runner = {
    run: jest.fn().mockResolvedValue({
      analysisType: 'cohort-count',
      cohortSize: 5,
      buckets: [],
      execution: { isolation: 'none' },
    }),
  };
  const progress = new TaskProgressReporter();
  const flRunner = { run: jest.fn().mockResolvedValue(undefined) };
  const worker = new ConnectorWorkerService(
    controlPlane as unknown as ControlPlaneClient,
    productSource as unknown as DataProductLocalSource,
    runner as unknown as ConnectorTaskRunner,
    flRunner as unknown as FlTaskRunner,
    progress,
    audit as AuditService,
  );
  return { worker, runner, productSource };
}

function baseControlPlane(batch: unknown) {
  return {
    getParticipantId: () => PARTICIPANT,
    longPollTasks: jest.fn().mockResolvedValue({
      participantId: PARTICIPANT,
      serverTime: new Date().toISOString(),
      waitMs: 0,
      rws: [],
      flPrediction: [],
      flRounds: [],
      ...(batch as object),
    }),
    pullPendingRws: jest.fn(),
    pullPendingFl: jest.fn(),
    isCatalogCached: jest.fn().mockReturnValue(true),
    prefetchCatalogProduct: jest.fn().mockResolvedValue({
      id: 'dp1',
      providerId: PARTICIPANT,
      fhirSchema: { localDataPath: 'data/synthea/ingested-clinical-text' },
    }),
    completeAssignment: jest.fn().mockResolvedValue(undefined),
    completeFlAssignment: jest.fn().mockResolvedValue(undefined),
    completeFlRound: jest.fn().mockResolvedValue(undefined),
    reportProgress: jest.fn().mockResolvedValue(undefined),
    reportFlProgress: jest.fn().mockResolvedValue(undefined),
    uploadAuditDigest: jest.fn().mockResolvedValue(undefined),
    sendHeartbeat: jest.fn().mockResolvedValue(undefined),
  };
}

describe('ConnectorWorkerService — 长轮询 (outbound-longpoll-agent-auth D2/D4)', () => {
  const ORIGINAL_ENV = { ...process.env };
  beforeEach(() => {
    process.env.CONNECTOR_PLATFORM_CA_PUBKEY = keypair.publicKey;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('领到已签名任务 → 执行并回传', async () => {
    const controlPlane = baseControlPlane({ rws: [sign('rws', 'a1', rwsPayload)] });
    const audit = new AuditService();
    const { worker, runner, productSource } = buildWorker(controlPlane, audit);

    await worker.pollOnce(0);

    expect(controlPlane.longPollTasks).toHaveBeenCalled();
    expect(controlPlane.prefetchCatalogProduct).toHaveBeenCalledWith('dp1');
    expect(productSource.registerProduct).toHaveBeenCalled();
    expect(runner.run).toHaveBeenCalled();
    expect(controlPlane.completeAssignment).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ aggregate: expect.any(Object) }),
    );
  });

  it('验签失败 → 不执行,记 task-signature-invalid 并上报失败', async () => {
    const forged = sign('rws', 'a1', rwsPayload, { signature: 'deadbeef' });
    const controlPlane = baseControlPlane({ rws: [forged] });
    const audit = new AuditService();
    const { worker, runner } = buildWorker(controlPlane, audit);

    await worker.pollOnce(0);

    expect(runner.run).not.toHaveBeenCalled();
    const entry = audit.all().find((e) => e.action === 'task-signature-invalid');
    expect(entry?.allowed).toBe(false);
    expect(controlPlane.completeAssignment).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ error: expect.stringContaining('验签失败') }),
    );
  });

  it('任务发给别院 → 拒绝', async () => {
    const foreign = sign('rws', 'a1', rwsPayload, { participantId: 'p-huashan' });
    const controlPlane = baseControlPlane({ rws: [foreign] });
    const audit = new AuditService();
    const { worker, runner } = buildWorker(controlPlane, audit);
    await worker.pollOnce(0);
    expect(runner.run).not.toHaveBeenCalled();
    expect(
      audit.all().find((e) => e.action === 'task-signature-invalid')?.detail,
    ).toContain('wrong-participant');
  });

  it('同一 taskId 重复下发只执行一次(去重)', async () => {
    const dup = sign('rws', 'a1', rwsPayload);
    const controlPlane = baseControlPlane({ rws: [dup] });
    const audit = new AuditService();
    const { worker, runner } = buildWorker(controlPlane, audit);
    await worker.pollOnce(0);
    await worker.pollOnce(0);
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('空批次不做事', async () => {
    const controlPlane = baseControlPlane({});
    const audit = new AuditService();
    const { worker, runner } = buildWorker(controlPlane, audit);
    await worker.pollOnce(0);
    expect(runner.run).not.toHaveBeenCalled();
    expect(controlPlane.completeAssignment).not.toHaveBeenCalled();
  });
});
