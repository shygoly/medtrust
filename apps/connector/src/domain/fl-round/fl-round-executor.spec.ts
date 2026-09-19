import { sm2 } from 'sm-crypto';
import { AuditService } from '../audit';
import { ContractView } from '../contract-view';
import { PolicyEnforcementPoint, PolicyViolation } from '../policy-enforcement';
import { FlRoundAgentClient, agentTokenMetadata } from './fl-round-agent-client';
import { FlRoundExecutor, ConnectorFlRoundTask } from './fl-round-executor';

const KEYPAIR = sm2.generateKeyPairHex();

const contract: ContractView = {
  id: 'c-fl',
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

function build(opts: { agentResult?: unknown; token?: string } = {}) {
  const audit = new AuditService();
  const calls: Array<{ params: unknown; token: string }> = [];
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
      sm2.doVerifySignature(payload.resultSm3, payload.signature, KEYPAIR.publicKey),
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

  it('元数据键固定为 x-agent-token', () => {
    expect(agentTokenMetadata('abc').get('x-agent-token')).toEqual(['abc']);
  });
});
