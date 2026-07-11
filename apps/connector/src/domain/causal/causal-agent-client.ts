import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';
import { AggregateResult } from '../types';
import {
  CausalInvokeFn,
  RunLocalCausalParams,
  RunLocalCausalResponse,
  parseCausalAgentResult,
} from './causal-response';

const protoPath = join(__dirname, '../../../../../packages/proto/rws_causal.proto');

type GrpcCausalClient = {
  RunLocalCausal: (
    req: { task_id: string; method: string; spec_json: string; cohort_json: string },
    cb: (err: Error | null, res: { ack_status: string; result_json: string; message: string }) => void,
  ) => void;
};

function defaultEndpoint(): string {
  return process.env.AGENT_GRPC_URL ?? '127.0.0.1:5024';
}

function createGrpcInvoke(endpoint: string): CausalInvokeFn {
  const def = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: Number,
    defaults: true,
    oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(def) as {
    medtrust: { rws_causal: { v1: { RwsCausalAgent: grpc.ServiceClientConstructor } } };
  };
  const Service = pkg.medtrust.rws_causal.v1.RwsCausalAgent;
  const client = new Service(endpoint, grpc.credentials.createInsecure()) as unknown as GrpcCausalClient;

  return (params) =>
    new Promise((resolve, reject) => {
      client.RunLocalCausal(
        {
          task_id: params.taskId,
          method: params.method,
          spec_json: params.specJson,
          cohort_json: params.cohortJson,
        },
        (err, res) => {
          if (err) return reject(err);
          resolve({
            ackStatus: res.ack_status,
            resultJson: res.result_json,
            message: res.message,
          });
        },
      );
    });
}

export class CausalAgentClient {
  private readonly invoke: CausalInvokeFn;

  constructor(invoke?: CausalInvokeFn, endpoint = defaultEndpoint()) {
    this.invoke = invoke ?? createGrpcInvoke(endpoint);
  }

  async runLocalCausal(params: RunLocalCausalParams): Promise<AggregateResult> {
    const res = await this.invoke(params);
    if (res.ackStatus !== 'OK') {
      throw new Error(res.message ?? 'agent RunLocalCausal 失败');
    }
    return parseCausalAgentResult(res.resultJson);
  }
}
