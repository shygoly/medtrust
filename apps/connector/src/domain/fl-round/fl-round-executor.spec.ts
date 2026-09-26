import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sm2 } from 'sm-crypto';
import { verifySm2 } from '../sm2-sign';
import { AuditService } from '../audit';
import { ContractView } from '../contract-view';
import { CdmAnalysisNotOpenError, DataProductLocalSource } from '../data-product-local-source';
import { Deidentifier } from '../deidentifier';
import { FhirGateway } from '../fhir-gateway';
import { LocalDataLoader } from '../local-data-loader';
import { LocalStore } from '../local-store';
import { PolicyEnforcementPoint, PolicyViolation } from '../policy-enforcement';
import { FlRoundAgentClient, RunLocalRoundParams, agentTokenMetadata } from './fl-round-agent-client';
import { FlRoundExecutor, ConnectorFlRoundTask } from './fl-round-executor';
import { TRAINING_SLICE_SCHEMA, TrainingSlice } from './training-slice';

const KEYPAIR = sm2.generateKeyPairHex();

// 本院数据产品：连接器本地的去标识记录（agent 看不到这个目录）。
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-round-product-'));
fs.writeFileSync(
  path.join(DATA_DIR, 'records.json'),
  JSON.stringify([
    { subjectKey: 'sk_2', conditions: ['慢性肾病'], medications: [], adverseEvents: [], observations: { Glucose: 7.2 } },
    { subjectKey: 'sk_1', conditions: ['高血压'], medications: [], adverseEvents: [] },
    { subjectKey: 'sk_3', conditions: ['Chronic kidney disease stage 3'], medications: [], adverseEvents: [] },
  ]),
);
afterAll(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const contract: ContractView = {
  id: 'c-fl',
  dataProductId: 'dp-fl-huashan',
  purpose: '联邦训练',
  retention: '阅后即焚',
  output: '仅模型增量',
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  status: 'active',
};

const roundTask: ConnectorFlRoundTask = {
  roundTaskId: 'r-1',
  taskId: 't-fl',
  round: 0,
  participantId: 'p-huashan',
  purpose: '联邦训练',
  specYaml: JSON.stringify({
    parties: [{ participantId: 'p-huashan', role: 'provider' }],
    outputPolicy: { allowedArtifacts: ['model_weights'] },
  }),
  globalAdapterJson: '',
  nodePlan: [
    {
      participantId: 'p-huashan',
      tier: 'teeu_full',
      device: 'H100',
      offloadAggregation: false,
      localEpochs: 2,
    },
  ],
  contract,
};

function productSource(audit: AuditService, store = new LocalStore(audit)) {
  const source = new DataProductLocalSource(
    store,
    new LocalDataLoader(new Deidentifier(), new FhirGateway()),
    audit,
  );
  source.registerProduct({
    id: 'dp-fl-huashan',
    providerId: 'p-huashan',
    fhirSchema: { localDataPath: DATA_DIR },
  });
  source.registerProduct({
    id: 'dp-fl-cdm',
    providerId: 'p-huashan',
    fhirSchema: { dataSource: { type: 'omop-cdm', label: 'huashan-cdm' } },
  });
  return source;
}

function build(
  opts: { agentResult?: unknown; token?: string; withSource?: boolean; store?: LocalStore } = {},
) {
  const audit = new AuditService();
  const calls: Array<{ params: RunLocalRoundParams; token: string }> = [];
  const client = new FlRoundAgentClient(async (params, metadata) => {
    calls.push({ params, token: String(metadata.get('x-agent-token')[0] ?? '') });
    return (
      (opts.agentResult as never) ?? {
        participantId: 'p-huashan',
        adapterDeltaJson: '{"w":[0.1]}',
        sampleCount: 42,
        localLoss: 0.31,
        message: 'OK',
      }
    );
  });
  const executor = new FlRoundExecutor(
    new PolicyEnforcementPoint(audit),
    client,
    audit,
    'p-huashan',
    opts.withSource === false ? undefined : productSource(audit, opts.store),
  );
  return { executor, audit, calls };
}

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('FlRoundExecutor — 竞逐轮次经连接器中转 (D3/D6)', () => {
  beforeEach(() => {
    process.env.AGENT_SHARED_TOKEN = 'shared-secret';
    process.env.CONNECTOR_SM2_PRIVATE_KEY = KEYPAIR.privateKey;
  });

  it('PEP 通过后带共享凭证调用本院 agent,并返回可验签的结果', async () => {
    const { executor, audit, calls } = build();
    const payload = await executor.runRound(roundTask);

    // 带共享凭证(院内调用鉴权 D6)
    expect(calls).toHaveLength(1);
    expect(calls[0].token).toBe('shared-secret');
    expect(payload.sampleCount).toBe(42);
    expect(payload.localLoss).toBeCloseTo(0.31);
    expect(payload.resultSm3).toMatch(/^[0-9a-f]{64}$/);

    // 结果签名可用连接器证书公钥验证(平台侧校验)
    expect(
      verifySm2(payload.resultSm3, payload.signature, KEYPAIR.publicKey),
    ).toBe(true);

    const run = audit.all().find((e) => e.action === 'fl-round-run');
    expect(run?.allowed).toBe(true);
    expect(run?.detail).toContain('samples=42');
  });

  it('未配置共享凭证 → 拒绝调用 agent(fail-closed)', async () => {
    delete process.env.AGENT_SHARED_TOKEN;
    const { executor, calls } = build();
    await expect(executor.runRound(roundTask)).rejects.toThrow(
      /AGENT_SHARED_TOKEN/,
    );
    expect(calls).toHaveLength(0);
  });

  it('未配置连接器私钥 → 拒绝回传结果', async () => {
    delete process.env.CONNECTOR_SM2_PRIVATE_KEY;
    const { executor } = build();
    await expect(executor.runRound(roundTask)).rejects.toThrow(
      /CONNECTOR_SM2_PRIVATE_KEY/,
    );
  });

  it('合约目的不符 → PEP 拒绝,不调用 agent', async () => {
    const { executor, calls } = build();
    const wrong = {
      ...roundTask,
      purpose: '别的用途',
      contract,
    };
    await expect(executor.runRound(wrong)).rejects.toBeInstanceOf(PolicyViolation);
    expect(calls).toHaveLength(0);
  });

  it('合约过期 → PEP 拒绝', async () => {
    const { executor } = build();
    const expired = {
      ...roundTask,
      contract: {
        ...contract,
        validUntil: new Date(Date.now() - 1_000).toISOString(),
      },
    };
    await expect(executor.runRound(expired)).rejects.toThrow(/过期/);
  });

  it('agent 未返回增量 → 失败', async () => {
    const { executor } = build({
      agentResult: {
        participantId: 'p-huashan',
        adapterDeltaJson: '',
        sampleCount: 0,
        localLoss: 0,
        message: 'no data',
      },
    });
    await expect(executor.runRound(roundTask)).rejects.toThrow(/未返回本地增量/);
  });

  it('训练数据由连接器按合约的数据产品投影后随请求给出（agent 不自行取数，4.3）', async () => {
    const store = new LocalStore(new AuditService());
    store.replaceAll([
      { subjectKey: 'other-task-row', ageBand: '50-59', conditions: [], medications: [], adverseEvents: [] },
    ]);
    const { executor, audit, calls } = build({ store });
    await executor.runRound(roundTask);

    const slice = JSON.parse(calls[0].params.trainingSliceJson) as TrainingSlice;
    expect(slice.schema).toBe(TRAINING_SLICE_SCHEMA);
    expect(slice.rows).toHaveLength(3);
    expect(slice.rows[1][6]).toBe(7.2); // sk_2 的 Glucose
    expect(slice.labels).toEqual([0, 1, 1]); // sk_1 高血压 / sk_2 慢性肾病 / sk_3 CKD
    expect(calls[0].params.trainingSliceJson).not.toMatch(/sk_|慢性肾病|高血压/);
    // 共享本地存储原样未动：训练轮次不会把别的在跑任务的数据换掉。
    expect(store.count()).toBe(1);
    const sliceAudit = audit.all().find((e) => e.action === 'fl-training-slice');
    expect(sliceAudit?.detail).toMatch(/product=dp-fl-huashan schema=esrd-proxy@1 rows=3 features=7/);
  });

  it('合约未指向数据产品 → 拒绝，不调用 agent（agent 不得自行取数）', async () => {
    const { executor, calls } = build();
    const noProduct = { ...roundTask, contract: { ...contract, dataProductId: undefined } };
    await expect(executor.runRound(noProduct)).rejects.toThrow(/未指向数据产品/);
    expect(calls).toHaveLength(0);
  });

  it('没有装配数据产品源 → 拒绝（fail-closed），不调用 agent', async () => {
    const { executor, calls } = build({ withSource: false });
    await expect(executor.runRound(roundTask)).rejects.toThrow(/未装配数据产品源/);
    expect(calls).toHaveLength(0);
  });

  it('合约指向 CDM 数据产品 → 拒绝（分析语义未开放），不读文件、不调用 agent', async () => {
    const { executor, calls } = build();
    const cdm = { ...roundTask, contract: { ...contract, dataProductId: 'dp-fl-cdm' } };
    await expect(executor.runRound(cdm)).rejects.toBeInstanceOf(CdmAnalysisNotOpenError);
    expect(calls).toHaveLength(0);
  });

  it('元数据键固定为 x-agent-token', () => {
    expect(agentTokenMetadata('abc').get('x-agent-token')).toEqual(['abc']);
  });
});
