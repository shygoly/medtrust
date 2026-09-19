// outbound-longpoll-agent-auth D6 —— 连接器在**院内**调用本院计算后端的训练轮次接口。
//
// 控制面不再直接调用 agent（D1）；agent 只在院内网络上监听，且每次调用必须带
// 共享凭证 `x-agent-token`（缺省或错误 → UNAUTHENTICATED）。
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';
import { AGENT_TOKEN_METADATA_KEY } from './agent-auth';

const protoPath = join(__dirname, '../../../../../../packages/proto/secretflow.proto');

export const DEFAULT_AGENT_GRPC_URL = '127.0.0.1:5024';

export interface RunLocalRoundParams {
  taskId: string;
  specYaml: string;
  roundIndex: number;
  globalAdapterJson?: string;
  nodePlan: Array<{
    participantId: string;
    tier: string;
    device: string;
    offloadAggregation: boolean;
    localEpochs: number;
  }>;
}

export interface RunLocalRoundResult {
  participantId: string;
  adapterDeltaJson: string;
  sampleCount: number;
  localLoss: number;
  message: string;
}

export type RunLocalRoundInvoke = (
  params: RunLocalRoundParams,
  metadata: grpc.Metadata,
) => Promise<RunLocalRoundResult>;

type GrpcSecretFlowClient = grpc.Client & {
  RunLocalRound: (
    req: unknown,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    cb: (err: grpc.ServiceError | null, res: any) => void,
  ) => void;
};

export function agentEndpoint(): string {
  return process.env.AGENT_GRPC_URL || DEFAULT_AGENT_GRPC_URL;
}

/** 本院共享凭证（缺失时由 FlRoundExecutor 直接拒绝，不发起调用）。 */
export function agentSharedToken(): string {
  return process.env.AGENT_SHARED_TOKEN ?? '';
}

export function agentTokenMetadata(token: string): grpc.Metadata {
  const metadata = new grpc.Metadata();
  metadata.set(AGENT_TOKEN_METADATA_KEY, token);
  return metadata;
}

function createGrpcInvoke(endpoint: string): RunLocalRoundInvoke {
  const def = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: Number,
    defaults: true,
    oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(def) as unknown as {
    medtrust: {
      secretflow: { v1: { SecretFlowAgent: grpc.ServiceClientConstructor } };
    };
  };
  const Service = pkg.medtrust.secretflow.v1.SecretFlowAgent;
  const client = new Service(
    endpoint,
    grpc.credentials.createInsecure(),
  ) as unknown as GrpcSecretFlowClient;

  return (params, metadata) =>
    new Promise<RunLocalRoundResult>((resolve, reject) => {
      client.RunLocalRound(
        {
          task_id: params.taskId,
          spec_yaml: params.specYaml,
          round_index: params.roundIndex,
          global_adapter_json: params.globalAdapterJson ?? '',
          node_plan: params.nodePlan.map((n) => ({
            participant_id: n.participantId,
            tier: n.tier,
            device: n.device,
            offload_aggregation: n.offloadAggregation,
            local_epochs: n.localEpochs,
          })),
        },
        metadata,
        {},
        (err, res) => {
          if (err) return reject(err);
          resolve({
            participantId: res.participant_id,
            adapterDeltaJson: res.adapter_delta_json,
            sampleCount: res.sample_count,
            localLoss: res.local_loss,
            message: res.message,
          });
        },
      );
    });
}

export class FlRoundAgentClient {
  private readonly invoke: RunLocalRoundInvoke;

  constructor(invoke?: RunLocalRoundInvoke, endpoint = agentEndpoint()) {
    this.invoke = invoke ?? createGrpcInvoke(endpoint);
  }

  async runLocalRound(
    params: RunLocalRoundParams,
    token: string,
  ): Promise<RunLocalRoundResult> {
    return this.invoke(params, agentTokenMetadata(token));
  }
}
