// omop-data-source-access 4.3 —— 连接器 → **真** agent gRPC 的训练轮次端到端。
//
// 需要一个在跑的 agent（apps/agent，带 torch），以共享凭证 agent-e2e-token 启动：
//   AGENT_SHARED_TOKEN=agent-e2e-token AGENT_LOCAL_PARTY=p-huashan python -m medtrust_agent.main
// 再以 AGENT_E2E_GRPC_URL=<host:port> 运行本文件；缺省跳过。
// 验证的是其它单测都绕过的那段：TS proto-loader 发出的 training_slice_json 字段
// 被 Python 桩收到，agent 只在这份切片上训练并回传增量。
import * as fs from 'fs';
import * as path from 'path';
import { sm2 } from 'sm-crypto';
import { verifySm2 } from '../sm2-sign';
import { AuditService } from '../audit';
import { ContractView } from '../contract-view';
import { DataProductLocalSource } from '../data-product-local-source';
import { Deidentifier } from '../deidentifier';
import { FhirGateway } from '../fhir-gateway';
import { LocalDataLoader } from '../local-data-loader';
import { defaultConnectorDataRoot } from '../local-data-path';
import { LocalStore } from '../local-store';
import { PolicyEnforcementPoint } from '../policy-enforcement';
import { FlRoundAgentClient } from './fl-round-agent-client';
import { FlRoundExecutor } from './fl-round-executor';

const ENDPOINT = process.env.AGENT_E2E_GRPC_URL;
const TOKEN = 'agent-e2e-token';
const root = defaultConnectorDataRoot();
const DATA_DIR = path.join(root, 'data', 'synthea', 'connectors', 'huashan');
const e2e = ENDPOINT && fs.existsSync(DATA_DIR) ? describe : describe.skip;

function roundSpec(): string {
  const scenario = JSON.parse(
    fs.readFileSync(path.join(root, 'packages', 'demo-scenario', 'src', 'ckd-scenario.json'), 'utf-8'),
  );
  const base = scenario.secretflowSpec;
  const { dpSgd: _dp, ...privacy } = base.privacy;
  const spec = {
    ...base,
    privacy,
    parties: [{ participantId: 'p-huashan', role: 'provider' }],
    modalities: [{ type: 'structured_ehr' }, { type: 'clinical_text' }],
    epochs: 1,
  };
  delete spec.fusionBridge;
  return JSON.stringify(spec);
}

e2e('联邦训练轮次：连接器 → 真 agent gRPC（训练切片端到端）', () => {
  const keypair = sm2.generateKeyPairHex();
  const saved = { ...process.env };
  beforeAll(() => {
    process.env.AGENT_SHARED_TOKEN = TOKEN;
    process.env.CONNECTOR_SM2_PRIVATE_KEY = keypair.privateKey;
  });
  afterAll(() => {
    process.env = saved;
  });

  it('切片经 gRPC 到达 agent，agent 只在其上训练并回传增量', async () => {
    const audit = new AuditService();
    const source = new DataProductLocalSource(
      new LocalStore(audit),
      new LocalDataLoader(new Deidentifier(), new FhirGateway()),
      audit,
    );
    source.registerProduct({
      id: 'dp-e2e-huashan',
      providerId: 'p-huashan',
      fhirSchema: { localDataPath: DATA_DIR },
    });
    const contract: ContractView = {
      id: 'c-e2e',
      dataProductId: 'dp-e2e-huashan',
      purpose: '联邦训练',
      retention: '阅后即焚',
      output: '仅模型增量',
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      status: 'active',
    };
    const executor = new FlRoundExecutor(
      new PolicyEnforcementPoint(audit),
      new FlRoundAgentClient(undefined, ENDPOINT),
      audit,
      'p-huashan',
      source,
    );

    const payload = await executor.runRound({
      roundTaskId: 'r-e2e',
      taskId: 't-e2e',
      round: 0,
      participantId: 'p-huashan',
      purpose: '联邦训练',
      specYaml: roundSpec(),
      globalAdapterJson: '',
      nodePlan: [
        { participantId: 'p-huashan', tier: 'pyu_only', device: 'cpu', offloadAggregation: false, localEpochs: 1 },
      ],
      contract,
    });

    const patients = fs.readdirSync(DATA_DIR).filter((f) => /^patient-.*\.json$/.test(f)).length;
    expect(payload.sampleCount).toBe(Math.min(patients, 256));
    expect(payload.adapterDeltaJson.length).toBeGreaterThan(10);
    expect(Number.isFinite(payload.localLoss)).toBe(true);
    expect(verifySm2(payload.resultSm3, payload.signature, keypair.publicKey)).toBe(true);
    const sliced = audit.all().find((e) => e.action === 'fl-training-slice');
    expect(sliced?.detail).toContain(`rows=${patients}`);
  }, 180_000);

  it('不带切片直接调 agent：agent 拒绝训练（不会退回任何本地数据）', async () => {
    const result = await new FlRoundAgentClient(undefined, ENDPOINT).runLocalRound(
      {
        taskId: 't-e2e-noslice::p-huashan',
        specYaml: roundSpec(),
        roundIndex: 0,
        nodePlan: [],
        trainingSliceJson: '',
      },
      TOKEN,
    );
    expect(result.adapterDeltaJson).toBe('');
    expect(result.message).toMatch(/未提供训练切片/);
  }, 60_000);
});
