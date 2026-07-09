import { createHash } from 'crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GMCryptoService } from '../../security/crypto/gm-crypto.service';
import { consumerPublicKey } from './demo-consumer-keys';
import { type AdapterState } from './fed-adapter-merge';
import { verifyLoraDeliverableBundle } from './lora-deliverable-verify';
import {
  createLoraDeliverableStorage,
  isLocalStorage,
  tigrisConfigured,
  type LoraDeliverableStorage,
} from './lora-deliverable-storage';

export interface LoraDeliverableRecord {
  taskId: string;
  consumerId: string;
  encryptedDeltaRef: string;
  loraDeltaHash: string;
  format: 'medtrust/lora-adapter+v1';
  algorithm: 'SM4-CBC+SM2-envelope';
  encryptedData: string;
  encryptedDEK: string;
  sha256: string;
  byteSize: number;
  sealedAt: string;
}

@Injectable()
export class LoraDeliverableService {
  private readonly logger = new Logger(LoraDeliverableService.name);
  private readonly store = new Map<string, LoraDeliverableRecord>();
  private readonly storage: LoraDeliverableStorage;

  constructor(private readonly gm: GMCryptoService) {
    this.storage = createLoraDeliverableStorage();
    if (tigrisConfigured()) {
      this.logger.log(
        `LoRA deliverables → Tigris bucket=${process.env.BUCKET_NAME} prefix=${process.env.LORA_DELIVERABLE_PREFIX || 'deliverables/'}`,
      );
    } else if (isLocalStorage(this.storage)) {
      for (const { taskId, raw } of this.storage.listOnDisk()) {
        this.ingestRaw(taskId, raw);
      }
    }
  }

  async sealAndStore(params: {
    taskId: string;
    consumerId: string;
    adapter: AdapterState;
    loraDeltaHash: string;
  }): Promise<LoraDeliverableRecord> {
    const pubKey = consumerPublicKey(params.consumerId);
    if (!pubKey) {
      throw new Error(`No SM2 public key configured for consumer ${params.consumerId}`);
    }

    const inner = JSON.stringify({
      v: 1,
      taskId: params.taskId,
      loraDeltaHash: params.loraDeltaHash,
      adapter: params.adapter,
      sealedAt: new Date().toISOString(),
    });
    const envelope = this.gm.envelopeEncrypt(inner, pubKey);
    const digest = createHash('sha256')
      .update(`${envelope.encryptedData}:${envelope.encryptedDEK}`)
      .digest('hex');
    const encryptedDeltaRef = `ENC:${digest.slice(0, 16)}`;

    const record: LoraDeliverableRecord = {
      taskId: params.taskId,
      consumerId: params.consumerId,
      encryptedDeltaRef,
      loraDeltaHash: params.loraDeltaHash,
      format: 'medtrust/lora-adapter+v1',
      algorithm: 'SM4-CBC+SM2-envelope',
      encryptedData: envelope.encryptedData,
      encryptedDEK: envelope.encryptedDEK,
      sha256: digest,
      byteSize: Buffer.byteLength(inner, 'utf8'),
      sealedAt: new Date().toISOString(),
    };

    const json = JSON.stringify(record, null, 2);
    await this.storage.save(params.taskId, json);
    this.store.set(params.taskId, record);
    this.logger.log(
      `sealed LoRA deliverable task=${params.taskId} ref=${encryptedDeltaRef} bytes=${record.byteSize} backend=${tigrisConfigured() ? 'tigris' : 'local'}`,
    );
    return record;
  }

  get(taskId: string): LoraDeliverableRecord | undefined {
    return this.store.get(taskId);
  }

  async require(taskId: string): Promise<LoraDeliverableRecord> {
    const cached = this.get(taskId);
    if (cached) return cached;

    const raw = await this.storage.load(taskId);
    if (!raw) {
      throw new NotFoundException(`No encrypted LoRA deliverable for task ${taskId}`);
    }
    return this.ingestRaw(taskId, raw);
  }

  /** Round-trip check used in tests — decrypt with demo consumer private key. */
  decryptForDemo(record: LoraDeliverableRecord, privateKey: string): AdapterState {
    const plaintext = this.gm.envelopeDecrypt(
      record.encryptedData,
      record.encryptedDEK,
      privateKey,
    );
    const parsed = JSON.parse(plaintext) as { adapter: AdapterState };
    return parsed.adapter;
  }

  verifyDemo(
    record: LoraDeliverableRecord,
    privateKey: string,
    expectedLoraHash?: string,
  ) {
    return verifyLoraDeliverableBundle(this.gm, record, privateKey, expectedLoraHash);
  }

  private ingestRaw(taskId: string, raw: string): LoraDeliverableRecord {
    try {
      const record = JSON.parse(raw) as LoraDeliverableRecord;
      if (record.taskId) {
        this.store.set(record.taskId, record);
        return record;
      }
    } catch (err) {
      this.logger.warn(`skip corrupt deliverable task=${taskId}: ${err}`);
    }
    throw new NotFoundException(`No encrypted LoRA deliverable for task ${taskId}`);
  }
}

export function loraDeliverableFilename(taskId: string): string {
  const safe = taskId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  return `lora-adapter-${safe}.enc.json`;
}
