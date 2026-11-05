import { sm2 } from 'sm-crypto';
import { signSm2 } from './sm2-sign';
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
import { DeidSpecStore, type SignedDeidSpec } from './deid/spec-package';
import { DeidDictionaryStore } from './deid/dictionary-manifest';
import {
  deidDictionarySignaturePayload,
  deidSpecSignaturePayload,
  publicKeyKid,
} from '@medtrust/mdop';
import { sm3Hex } from './sm3';
import { stableStringify } from './canonical-json';

const keypair = sm2.generateKeyPairHex();
const PARTICIPANT = 'p-demohospb';

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
    signature: signSm2(connectorTaskSignaturePayload(sm3), keypair.privateKey, keypair.publicKey),
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

function buildWorker(
  controlPlane: Record<string, unknown>,
  audit: unknown,
  deidSpecs?: DeidSpecStore,
  deidDictionaries?: DeidDictionaryStore,
) {
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
    undefined, // flRoundExecutor
    undefined, // modules
    undefined, // mdopOperators
    undefined, // mdopNode
    deidSpecs,
    deidDictionaries,
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
    process.env.CONNECTOR_PLATFORM_NODE_PUBKEY = keypair.publicKey;
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
    const foreign = sign('rws', 'a1', rwsPayload, { participantId: 'p-demohospa' });
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

describe('ConnectorWorkerService — 脱敏规格下发 (connector-agent-deidentification)', () => {
  const ORIGINAL_ENV = { ...process.env };
  const DEID_KEYS = sm2.generateKeyPairHex();
  const DEID_SPEC = {
    version: 1,
    id: 'deid.ckd.v3',
    scope: { product: 'urn:tds:sp:ckd-cohort', level: 'C0_internal' },
    transforms: [
      { field: 'patientId', op: 'hmac_pseudonym', params: { saltRef: 'hosp-kms:ckd', outLen: 16 } },
      { field: 'name', op: 'drop' },
    ],
    denyIfTransformMissing: ['patientId', 'name'],
  };

  function deidPackage(version = 1): SignedDeidSpec {
    const specJson = stableStringify(DEID_SPEC);
    const specSm3 = sm3Hex(specJson);
    return {
      specId: 'deid.ckd.v3',
      version,
      specJson,
      specSm3,
      signature: signSm2(deidSpecSignaturePayload(specSm3), DEID_KEYS.privateKey, DEID_KEYS.publicKey),
      keyId: publicKeyKid(DEID_KEYS.publicKey),
      issuedAt: new Date(Date.now() - 1000).toISOString(),
      notAfter: new Date(Date.now() + 86_400_000).toISOString(),
      signaturePayload: deidSpecSignaturePayload(specSm3),
    };
  }

  beforeEach(() => {
    process.env.CONNECTOR_PLATFORM_NODE_PUBKEY = keypair.publicKey;
    process.env.CONNECTOR_REGISTRY_PUBKEY = DEID_KEYS.publicKey;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('批次里的规格包被验签并装载', async () => {
    const pkg = deidPackage();
    const controlPlane = baseControlPlane({ deidSpecs: [pkg] });
    const store = new DeidSpecStore();
    const { worker } = buildWorker(controlPlane, new AuditService(), store);

    await worker.pollOnce(0);

    expect(store.requireActive('deid.ckd.v3').version).toBe(1);
  });

  it('签名不对的规格包 → 拒收，且不污染已有规格', async () => {
    const forged = { ...deidPackage(2), signature: 'deadbeef' };
    const controlPlane = baseControlPlane({ deidSpecs: [deidPackage(1), forged] });
    const store = new DeidSpecStore();
    const audit = new AuditService();
    const { worker } = buildWorker(controlPlane, audit, store);

    await worker.pollOnce(0);

    expect(store.requireActive('deid.ckd.v3').version).toBe(1);
    expect(audit.all().some((e) => e.action === 'deid-spec-rejected')).toBe(true);
  });

  it('同一批次里先收吊销 → 被吊销的规格不装载（顺序不能反）', async () => {
    const pkg = deidPackage();
    const controlPlane = baseControlPlane({
      deidRevocations: {
        version: 1,
        issuedAt: new Date().toISOString(),
        revoked: [
          {
            specSm3: pkg.specSm3,
            specId: pkg.specId,
            version: pkg.version,
            reason: '口径撤回',
            revokedAt: new Date().toISOString(),
            revokedBy: 'platform',
          },
        ],
      },
      deidSpecs: [pkg],
    });
    const store = new DeidSpecStore();
    const { worker } = buildWorker(controlPlane, new AuditService(), store);

    await worker.pollOnce(0);

    expect(store.list()).toHaveLength(0);
    expect(() => store.requireActive('deid.ckd.v3')).toThrow(/SPEC_NOT_AVAILABLE/);
  });
});

describe('ConnectorWorkerService — 词表清单下发 (Phase 2)', () => {
  const ORIGINAL_ENV = { ...process.env };
  const KEYS = sm2.generateKeyPairHex();
  const DICT_SM3 = sm3Hex('张三\n李四\n');

  function manifest(version = 2) {
    return {
      dictionaryId: 'deid:cn-names',
      version,
      sm3: DICT_SM3,
      byteSize: 32,
      keyId: publicKeyKid(KEYS.publicKey),
      issuedAt: new Date(Date.now() - 1000).toISOString(),
      notAfter: new Date(Date.now() + 86_400_000).toISOString(),
      signature: signSm2(deidDictionarySignaturePayload(DICT_SM3), KEYS.privateKey, KEYS.publicKey),
      signaturePayload: deidDictionarySignaturePayload(DICT_SM3),
    };
  }

  beforeEach(() => {
    process.env.CONNECTOR_PLATFORM_NODE_PUBKEY = keypair.publicKey;
    process.env.CONNECTOR_REGISTRY_PUBKEY = KEYS.publicKey;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('批次里的词表清单被验签并装载', async () => {
    const controlPlane = baseControlPlane({ deidDictionaries: [manifest()] });
    const store = new DeidDictionaryStore();
    const { worker } = buildWorker(controlPlane, new AuditService(), undefined, store);

    await worker.pollOnce(0);

    expect(store.require('deid:cn-names:v2').sm3).toBe(DICT_SM3);
  });

  it('签名不对的清单被拒收，且留审计痕', async () => {
    const controlPlane = baseControlPlane({
      deidDictionaries: [{ ...manifest(3), signature: 'deadbeef' }],
    });
    const store = new DeidDictionaryStore();
    const audit = new AuditService();
    const { worker } = buildWorker(controlPlane, audit, undefined, store);

    await worker.pollOnce(0);

    expect(store.list()).toHaveLength(0);
    expect(audit.all().some((e) => e.action === 'deid-dictionary-rejected')).toBe(true);
  });

  it('同批次先收吊销 → 被吊销的词表不装载', async () => {
    const controlPlane = baseControlPlane({
      deidDictionaryRevocations: {
        version: 1,
        issuedAt: new Date().toISOString(),
        revoked: [
          {
            dictionaryId: 'deid:cn-names',
            version: 2,
            sm3: DICT_SM3,
            reason: '词表撤回',
            revokedAt: new Date().toISOString(),
            revokedBy: 'compliance-01',
          },
        ],
      },
      deidDictionaries: [manifest()],
    });
    const store = new DeidDictionaryStore();
    const { worker } = buildWorker(controlPlane, new AuditService(), undefined, store);

    await worker.pollOnce(0);

    expect(store.list()).toHaveLength(0);
  });
});
