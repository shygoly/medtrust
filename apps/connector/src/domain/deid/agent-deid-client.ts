import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';
import { stableStringify } from '../canonical-json';
import { sm3BytesHex, sm3Hex } from '../sm3';
import { agentSharedToken, agentTokenMetadata } from '../fl-round/fl-round-agent-client';

export const DEID_PROTO_PATH = join(__dirname, '../../../../../packages/proto/deidentify.proto');

export interface AgentDeidRunInput {
  jobId: string;
  contractId: string;
  spec: Record<string, unknown>;
  saltRef: string;
  rows: readonly Record<string, unknown>[];
  rowLimit?: number;
  /** Phase 2：规格引用的词表（内容留在医院，这里只给 ref 与平台签名的摘要）。 */
  dictionaryRef?: string;
  dictionarySm3?: string;
}

export interface AgentDeidReceipt {
  ackStatus: string;
  rowCount: number;
  inputDigest: string;
  outputDigest: string;
  specSm3: string;
  agentReceipt: string;
  warnings: string[];
  message: string;
}

export interface AgentDeidRunResult {
  rows: Record<string, unknown>[];
  receipt: AgentDeidReceipt;
  /**
   * 收到字节的 SM3（按到达顺序逐块累加）。
   *
   * 输出摘要必须对**agent 实际产出的字节**取摘要，而不是对本进程重新序列化的行取摘要：
   * 两侧 JSON 编码器在数值/转义上的差异（如 `3.0` vs `3`）会让"语义一致"的两份数据
   * 得到不同摘要，从而把正常变换误判成篡改。字节口径不存在这个歧义。
   */
  outputSm3: string;
}

type DeidCall = grpc.ClientDuplexStream<unknown, {
  deidentified_jsonl?: Buffer;
  receipt?: {
    ack_status?: string;
    row_count?: number;
    input_digest?: string;
    output_digest?: string;
    spec_sm3?: string;
    agent_receipt?: string;
    warnings?: string[];
    message?: string;
  };
}>;

type DeidServiceClient = grpc.Client & {
  RunDeidentification(metadata: grpc.Metadata): DeidCall;
};

function endpoint(): string {
  return process.env.AGENT_GRPC_URL ?? '127.0.0.1:5024';
}

function specDigest(spec: Record<string, unknown>): string {
  return `sm3:${sm3Hex(stableStringify(spec))}`;
}

export function jsonLines(rows: readonly Record<string, unknown>[]): Buffer {
  return Buffer.from(rows.map((row) => stableStringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

function createClient(target: string): DeidServiceClient {
  const definition = protoLoader.loadSync(DEID_PROTO_PATH, {
    keepCase: true,
    longs: Number,
    defaults: true,
    oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(definition) as {
    medtrust: { deidentify: { v1: { DeidentificationAgent: grpc.ServiceClientConstructor } } };
  };
  const Service = pkg.medtrust.deidentify.v1.DeidentificationAgent;
  return new Service(target, grpc.credentials.createInsecure()) as unknown as DeidServiceClient;
}

/** Connector-side streaming client. It sends only a restricted projection, never SQL or a datasource ref. */
export class AgentDeidClient {
  constructor(
    private readonly target = endpoint(),
    private readonly clientFactory: (target: string) => DeidServiceClient = createClient,
  ) {}

  async run(input: AgentDeidRunInput): Promise<AgentDeidRunResult> {
    const token = agentSharedToken();
    if (!token) throw new Error('未配置 AGENT_SHARED_TOKEN:拒绝调用脱敏 agent(fail-closed)');
    const rowLimit = input.rowLimit ?? 100_000;
    if (input.rows.length > rowLimit) throw new Error(`脱敏输入超过 row_limit=${rowLimit}`);

    const call = this.clientFactory(this.target).RunDeidentification(agentTokenMetadata(token));
    const outputRows: Record<string, unknown>[] = [];
    const chunks: Buffer[] = [];
    const state: { receipt?: AgentDeidReceipt } = {};
    const done = new Promise<void>((resolve, reject) => {
      call.on('data', (message: {
        deidentified_jsonl?: Buffer;
        receipt?: {
          ack_status?: string;
          row_count?: number;
          input_digest?: string;
          output_digest?: string;
          spec_sm3?: string;
          agent_receipt?: string;
          warnings?: string[];
          message?: string;
        };
      }) => {
        if (message.deidentified_jsonl) {
          const chunk = Buffer.from(message.deidentified_jsonl);
          chunks.push(chunk);
          for (const line of chunk.toString('utf8').split('\n')) {
            if (!line.trim()) continue;
            const parsed = JSON.parse(line) as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
              return reject(new Error('agent 脱敏响应包含非对象行'));
            outputRows.push(parsed as Record<string, unknown>);
          }
        }
        if (message.receipt) {
          const value = message.receipt;
          state.receipt = {
            ackStatus: String(value.ack_status ?? ''),
            rowCount: Number(value.row_count ?? 0),
            inputDigest: String(value.input_digest ?? ''),
            outputDigest: String(value.output_digest ?? ''),
            specSm3: String(value.spec_sm3 ?? ''),
            agentReceipt: String(value.agent_receipt ?? ''),
            warnings: Array.isArray(value.warnings) ? value.warnings.map(String) : [],
            message: String(value.message ?? ''),
          };
        }
      });
      call.once('error', reject);
      call.once('end', () => resolve());
    });

    call.write({
      start: {
        job_id: input.jobId,
        contract_id: input.contractId,
        spec_sm3: specDigest(input.spec),
        spec_json: stableStringify(input.spec),
        salt_ref: input.saltRef,
        row_limit: rowLimit,
        ...(input.dictionaryRef ? { dictionary_ref: input.dictionaryRef } : {}),
        ...(input.dictionarySm3 ? { dictionary_sm3: input.dictionarySm3 } : {}),
      },
    });
    if (input.rows.length) call.write({ projected_jsonl: jsonLines(input.rows) });
    call.write({ end: true });
    call.end();
    await done;

    const finalReceipt = state.receipt;
    if (!finalReceipt) throw new Error('agent 脱敏未返回回执');
    if (finalReceipt.ackStatus !== 'OK')
      throw new Error(`agent 脱敏失败：${finalReceipt.message || finalReceipt.ackStatus}`);
    if (finalReceipt.rowCount !== outputRows.length) {
      throw new Error(`agent 脱敏回执行数不一致：${finalReceipt.rowCount} != ${outputRows.length}`);
    }
    return {
      rows: outputRows,
      receipt: finalReceipt,
      outputSm3: sm3BytesHex(Buffer.concat(chunks)),
    };
  }
}
