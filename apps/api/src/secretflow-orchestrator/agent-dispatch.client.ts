import { Injectable, Logger } from '@nestjs/common';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { secretflowProtoPath } from '@medtrust/proto';
import { NodePlan } from './types';

export interface SubmitFLTaskResult {
  taskId: string;
  ackStatus: string;
  taskStreamUrl: string;
  message: string;
}

export interface AgentTaskResult {
  taskId: string;
  state: string;
  roundsCompleted: number;
  metricsJson: string;
  loraDeltaHash: string;
  encryptedDeltaRef: string;
  attestationReportHash: string;
  privacySummaryJson: string;
  modelCardJson: string;
  runtime: string;
}

interface GrpcClient extends grpc.Client {
  SubmitFLTask: (req: unknown, cb: (err: grpc.ServiceError | null, res: any) => void) => void;
  GetTaskResult: (req: unknown, cb: (err: grpc.ServiceError | null, res: any) => void) => void;
}

/**
 * gRPC client to a Local Data Agent (design §4.1 SubmitFLTask).
 *
 * Loads the shared proto at runtime (no codegen). The orchestrator is the gRPC
 * client; each participant's agent is the server. The agent's address is taken
 * from the per-node plan or AGENT_GRPC_URL (single-host demo default).
 */
@Injectable()
export class AgentDispatchClient {
  private readonly logger = new Logger(AgentDispatchClient.name);
  private readonly ServiceCtor: grpc.ServiceClientConstructor;
  private readonly clients = new Map<string, GrpcClient>();

  constructor() {
    const def = protoLoader.loadSync(secretflowProtoPath, {
      keepCase: true,
      longs: Number,
      defaults: true,
      oneofs: true,
    });
    const pkg = grpc.loadPackageDefinition(def) as any;
    this.ServiceCtor = pkg.medtrust.secretflow.v1.SecretFlowAgent;
  }

  private clientFor(target: string): GrpcClient {
    let client = this.clients.get(target);
    if (!client) {
      client = new this.ServiceCtor(
        target,
        grpc.credentials.createInsecure(),
      ) as unknown as GrpcClient;
      this.clients.set(target, client);
    }
    return client;
  }

  /** Resolve the agent endpoint for a task (single-host demo: one endpoint). */
  endpoint(): string {
    return process.env.AGENT_GRPC_URL || '127.0.0.1:5024';
  }

  submitFLTask(params: {
    taskId: string;
    specYaml: string;
    transpiledPayload: string;
    globalPublicKey?: string;
    nodePlan: NodePlan[];
    target?: string;
  }): Promise<SubmitFLTaskResult> {
    const target = params.target ?? this.endpoint();
    const request = {
      task_id: params.taskId,
      spec_yaml: params.specYaml,
      transpiled_payload: params.transpiledPayload,
      global_public_key: params.globalPublicKey ?? '',
      node_plan: params.nodePlan.map((n) => ({
        participant_id: n.participantId,
        tier: n.tier,
        device: n.device,
        offload_aggregation: n.offloadAggregation,
        local_epochs: n.localEpochs,
      })),
    };
    return new Promise((resolve, reject) => {
      this.clientFor(target).SubmitFLTask(request, (err, res) => {
        if (err) {
          this.logger.error(`SubmitFLTask failed for ${params.taskId}: ${err.message}`);
          return reject(err);
        }
        resolve({
          taskId: res.task_id,
          ackStatus: res.ack_status,
          taskStreamUrl: res.task_stream_url,
          message: res.message,
        });
      });
    });
  }

  getTaskResult(taskId: string, target?: string): Promise<AgentTaskResult> {
    const endpoint = target ?? this.endpoint();
    return new Promise((resolve, reject) => {
      this.clientFor(endpoint).GetTaskResult({ task_id: taskId }, (err, res) => {
        if (err) {
          return reject(err);
        }
        resolve({
          taskId: res.task_id,
          state: res.state,
          roundsCompleted: res.rounds_completed,
          metricsJson: res.metrics_json,
          loraDeltaHash: res.lora_delta_hash,
          encryptedDeltaRef: res.encrypted_delta_ref,
          attestationReportHash: res.attestation_report_hash,
          privacySummaryJson: res.privacy_summary_json,
          modelCardJson: res.model_card_json,
          runtime: res.runtime,
        });
      });
    });
  }
}
