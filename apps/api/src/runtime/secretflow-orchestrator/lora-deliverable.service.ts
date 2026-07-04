import { createHash } from 'crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GMCryptoService } from '../../security/crypto/gm-crypto.service';
import { consumerPublicKey } from './demo-consumer-keys';
import { type AdapterState } from './fed-adapter-merge';

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
  private readonly dataDir =
    process.env.LORA_DELIVERABLE_DIR || join(process.cwd(), 'data', 'deliverables');

  constructor(private readonly gm: GMCryptoService) {
    mkdirSync(this.dataDir, { recursive: true });
    this.loadFromDisk();
  }

  sealAndStore(params: {
    taskId: string;
    consumerId: string;
    adapter: AdapterState;
    loraDeltaHash: string;
  }): LoraDeliverableRecord {
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

    this.store.set(params.taskId, record);
    writeFileSync(join(this.dataDir, `${params.taskId}.enc.json`), JSON.stringify(record, null, 2));
    this.logger.log(
      `sealed LoRA deliverable task=${params.taskId} ref=${encryptedDeltaRef} bytes=${record.byteSize}`,
    );
    return record;
  }

  get(taskId: string): LoraDeliverableRecord | undefined {
    return this.store.get(taskId);
  }

  require(taskId: string): LoraDeliverableRecord {
    const hit = this.get(taskId);
    if (!hit) {
      throw new NotFoundException(`No encrypted LoRA deliverable for task ${taskId}`);
    }
    return hit;
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

  private loadFromDisk(): void {
    if (!existsSync(this.dataDir)) return;
    for (const name of readdirSync(this.dataDir)) {
      if (!name.endsWith('.enc.json')) continue;
      try {
        const raw = readFileSync(join(this.dataDir, name), 'utf8');
        const record = JSON.parse(raw) as LoraDeliverableRecord;
        if (record.taskId) {
          this.store.set(record.taskId, record);
        }
      } catch (err) {
        this.logger.warn(`skip corrupt deliverable file ${name}: ${err}`);
      }
    }
  }
}

export function loraDeliverableFilename(taskId: string): string {
  const safe = taskId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  return `lora-adapter-${safe}.enc.json`;
}
