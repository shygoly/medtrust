import { Injectable, Logger } from '@nestjs/common';
import { MdopError, canonicalSm3 } from '@medtrust/mdop';
import { signSm2 } from '../../domain/sm2-sign';
import { connectorPublicKey } from '../../domain/connector-key';

/**
 * 托管语料记录（服务计算：长生命周期持久化密封信封）。
 * 密态存盘，不随单次作业销毁，受合约有效期与 PurgeCorpusOrder 约束。
 */
export interface CorpusArtifactRecord {
  corpusHandle: string;
  contractId: string;
  corpusId: string;
  label: 'C2';
  digest: string;
  envelope: Record<string, unknown>;
  provider: string;
  registeredAt: string;
  expiresAt: string;
}

/**
 * 语料销毁签名回执。
 */
export interface CorpusPurgedReceipt {
  receipt_id: string;
  contract_id: string;
  corpus_id: string;
  node: string;
  reason: string;
  destroyed_at: string;
  idempotency_key: string;
  sig: { alg: string; kid: string; value: string };
}

@Injectable()
export class CorpusStore {
  private readonly logger = new Logger(CorpusStore.name);
  private readonly corpusMap = new Map<string, CorpusArtifactRecord>();
  private readonly purgedReceipts = new Map<string, CorpusPurgedReceipt>();

  constructor(private readonly deps: { node: string; privateKey?: string }) {}

  private privateKey(): string {
    const key = this.deps.privateKey ?? process.env.CONNECTOR_SM2_PRIVATE_KEY ?? '';
    if (!key) throw new MdopError('E_RUNTIME', {}, '节点未配置私钥，无法签发语料回执');
    return key;
  }

  put(record: CorpusArtifactRecord): void {
    if (record.label !== 'C2') {
      throw new MdopError('E_LABEL_VIOLATION', {}, '托管语料必须以 C2 密态信封形式存储');
    }
    this.corpusMap.set(record.corpusHandle, { ...record });
    this.logger.log(`语料登记入库: handle=${record.corpusHandle} provider=${record.provider}`);
  }

  get(corpusHandle: string): CorpusArtifactRecord | null {
    return this.corpusMap.get(corpusHandle) ?? null;
  }

  getByContractAndCorpus(contractId: string, corpusId: string): CorpusArtifactRecord | null {
    const handle = `corpus://${contractId}/${corpusId}`;
    return this.corpusMap.get(handle) ?? null;
  }

  listContract(contractId: string): CorpusArtifactRecord[] {
    return [...this.corpusMap.values()].filter((c) => c.contractId === contractId);
  }

  purge(input: {
    contractId: string;
    corpusId: string;
    reason: string;
    idempotencyKey: string;
    now?: Date;
  }): CorpusPurgedReceipt {
    const existing = this.purgedReceipts.get(input.idempotencyKey);
    if (existing) return existing;

    const handle = `corpus://${input.contractId}/${input.corpusId}`;
    const record = this.corpusMap.get(handle);
    if (record) {
      if (record.envelope && typeof record.envelope === 'object') {
        for (const k of Object.keys(record.envelope)) {
          delete (record.envelope as Record<string, unknown>)[k];
        }
      }
      this.corpusMap.delete(handle);
    }

    const now = input.now ?? new Date();
    const payload = {
      receipt_id: `corpus-purge:${input.contractId}:${input.corpusId}`,
      contract_id: input.contractId,
      corpus_id: input.corpusId,
      node: this.deps.node,
      reason: input.reason,
      destroyed_at: now.toISOString(),
      idempotency_key: input.idempotencyKey,
    };

    const privateKey = this.privateKey();
    const receipt: CorpusPurgedReceipt = {
      ...payload,
      sig: {
        alg: 'SM2-SM3',
        kid: canonicalSm3(connectorPublicKey(privateKey)).replace(/^sm3:/, ''),
        value: signSm2(canonicalSm3(payload), privateKey),
      },
    };

    this.purgedReceipts.set(input.idempotencyKey, receipt);
    this.logger.log(
      `语料销毁完成 contract=${input.contractId} corpus=${input.corpusId} reason=${input.reason}`,
    );
    return receipt;
  }

  sweepExpired(now: Date = new Date()): CorpusPurgedReceipt[] {
    const receipts: CorpusPurgedReceipt[] = [];
    for (const record of [...this.corpusMap.values()]) {
      if (Date.parse(record.expiresAt) > now.getTime()) continue;
      const receipt = this.purge({
        contractId: record.contractId,
        corpusId: record.corpusId,
        reason: 'corpus-expired',
        idempotencyKey: `expire:${record.contractId}:${record.corpusId}`,
        now,
      });
      receipts.push(receipt);
    }
    return receipts;
  }
}
