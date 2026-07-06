import { createHash } from 'crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';

export interface LoraDeliverableStorage {
  save(taskId: string, json: string): Promise<void>;
  load(taskId: string): Promise<string | null>;
}

export function deliverableObjectKey(taskId: string, prefix = defaultPrefix()): string {
  const safe = taskId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
  return `${prefix}${safe}.enc.json`;
}

export function defaultPrefix(): string {
  const raw = process.env.LORA_DELIVERABLE_PREFIX || 'deliverables/';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

export function tigrisConfigured(): boolean {
  return Boolean(
    process.env.BUCKET_NAME &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY,
  );
}

export function createLoraDeliverableStorage(): LoraDeliverableStorage {
  if (tigrisConfigured()) {
    return new TigrisLoraDeliverableStorage();
  }
  return new LocalLoraDeliverableStorage(
    process.env.LORA_DELIVERABLE_DIR || join(process.cwd(), 'data', 'deliverables'),
  );
}

class LocalLoraDeliverableStorage implements LoraDeliverableStorage {
  constructor(private readonly dataDir: string) {
    mkdirSync(this.dataDir, { recursive: true });
  }

  async save(taskId: string, json: string): Promise<void> {
    writeFileSync(join(this.dataDir, `${taskId}.enc.json`), json);
  }

  async load(taskId: string): Promise<string | null> {
    const path = join(this.dataDir, `${taskId}.enc.json`);
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf8');
  }

  /** Eager load for local dev — not part of the interface. */
  listOnDisk(): Array<{ taskId: string; raw: string }> {
    if (!existsSync(this.dataDir)) return [];
    const out: Array<{ taskId: string; raw: string }> = [];
    for (const name of readdirSync(this.dataDir)) {
      if (!name.endsWith('.enc.json')) continue;
      try {
        const raw = readFileSync(join(this.dataDir, name), 'utf8');
        out.push({ taskId: name.replace(/\.enc\.json$/, ''), raw });
      } catch {
        // skip corrupt files
      }
    }
    return out;
  }
}

class TigrisLoraDeliverableStorage implements LoraDeliverableStorage {
  private readonly bucket = process.env.BUCKET_NAME!;
  private readonly prefix = defaultPrefix();
  private readonly client: S3Client;

  constructor() {
    const config: S3ClientConfig = {
      region: process.env.AWS_REGION || 'auto',
      endpoint: process.env.AWS_ENDPOINT_URL_S3 || 'https://t3.storage.dev',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    };
    this.client = new S3Client(config);
  }

  async save(taskId: string, json: string): Promise<void> {
    const key = deliverableObjectKey(taskId, this.prefix);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: json,
        ContentType: 'application/json',
        Metadata: {
          taskId,
          sha256: createHash('sha256').update(json).digest('hex'),
        },
      }),
    );
  }

  async load(taskId: string): Promise<string | null> {
    const key = deliverableObjectKey(taskId, this.prefix);
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!res.Body) return null;
      return await res.Body.transformToString('utf8');
    } catch (err: unknown) {
      const code = (err as { name?: string; $metadata?: { httpStatusCode?: number } }).name;
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (code === 'NoSuchKey' || status === 404) return null;
      throw err;
    }
  }
}

export function isLocalStorage(storage: LoraDeliverableStorage): storage is LocalLoraDeliverableStorage {
  return storage instanceof LocalLoraDeliverableStorage;
}
