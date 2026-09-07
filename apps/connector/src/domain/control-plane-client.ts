import { Injectable, Optional } from '@nestjs/common';
import { sm2 } from 'sm-crypto';
import { CatalogProduct, CatalogProductResolver } from './catalog-product';
import { sm3Hex } from './sm3';
import { RwsAnalysis } from './types';

export interface ControlPlaneClientOptions {
  baseUrl?: string;
  participantId?: string;
  connectorToken?: string;
}

export interface ConnectorPendingAssignment {
  assignmentId: string;
  taskId: string;
  purpose: string;
  workloadType: 'rws';
  analysis: RwsAnalysis;
  contract: {
    id: string;
    dataProductId: string;
    providerId: string;
    consumerId: string;
    purpose: string;
    retention: string;
    output: string;
    validUntil: string;
    status: 'active' | 'draft' | 'expired' | 'revoked';
  };
}

export interface ConnectorPendingFlAssignment {
  assignmentId: string;
  taskId: string;
  purpose: string;
  workloadType: 'federated_learning';
  flPredictionSpec: Record<string, unknown>;
  contract: ConnectorPendingAssignment['contract'];
}

/** 稳定序列化:与平台 RwsOrchestratorService.aggregateSm3 保持同一口径。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function aggregateSm3(aggregate: unknown): string {
  return sm3Hex(stableStringify(aggregate));
}

@Injectable()
export class ControlPlaneClient {
  private readonly baseUrl: string;
  private readonly participantId: string;
  private readonly connectorToken: string;
  private readonly requestTimeoutMs: number;
  private readonly certFingerprint: string;
  private readonly sm2PrivateKey: string;
  private readonly productCache = new Map<string, CatalogProduct>();

  constructor(@Optional() opts?: ControlPlaneClientOptions) {
    const o = opts ?? {};
    this.baseUrl = (o.baseUrl ?? process.env.CONTROL_PLANE_URL ?? 'http://localhost:5021/api/v1').replace(
      /\/$/,
      '',
    );
    this.participantId = o.participantId ?? process.env.CONNECTOR_PARTICIPANT_ID ?? '';
    this.connectorToken = o.connectorToken ?? process.env.CONNECTOR_PULL_TOKEN ?? 'dev-connector-token';
    this.requestTimeoutMs = Number(process.env.CONTROL_PLANE_TIMEOUT_MS ?? 15_000);
    this.certFingerprint = process.env.CONNECTOR_CERT_FINGERPRINT ?? '';
    this.sm2PrivateKey = process.env.CONNECTOR_SM2_PRIVATE_KEY ?? '';
  }

  /** fetch with a timeout — a hung control plane must not stall the poller. */
  private async fetchWithTimeout(
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    return fetch(url, {
      ...init,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
  }

  getParticipantId(): string {
    return this.participantId;
  }

  asCatalogResolver(): CatalogProductResolver {
    return (productId) => this.productCache.get(productId) ?? null;
  }

  isCatalogCached(productId: string): boolean {
    return this.productCache.has(productId);
  }

  async prefetchCatalogProduct(productId: string): Promise<CatalogProduct | null> {
    const cached = this.productCache.get(productId);
    if (cached) return cached;

    const res = await this.fetchWithTimeout(`${this.baseUrl}/connector/catalog/${productId}?participantId=${encodeURIComponent(this.participantId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) return null;

    const product = (await res.json()) as CatalogProduct;
    this.productCache.set(productId, product);
    return product;
  }

  async pullPendingRws(): Promise<ConnectorPendingAssignment[]> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/connector/rws/pending?participantId=${encodeURIComponent(this.participantId)}`,
      { headers: this.headers() },
    );
    if (!res.ok) {
      throw new Error(`拉取任务失败: HTTP ${res.status}`);
    }
    return (await res.json()) as ConnectorPendingAssignment[];
  }

  async pullPendingFl(): Promise<ConnectorPendingFlAssignment[]> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/connector/fl-prediction/pending?participantId=${encodeURIComponent(this.participantId)}`,
      { headers: this.headers() },
    );
    if (!res.ok) {
      throw new Error(`拉取 FL 任务失败: HTTP ${res.status}`);
    }
    return (await res.json()) as ConnectorPendingFlAssignment[];
  }

  async completeAssignment(
    assignmentId: string,
    body: { aggregate?: unknown; error?: string },
  ): Promise<void> {
    const payload: Record<string, unknown> = { ...body };
    if (body.aggregate) {
      // P1-6:回传结果携带 SM3 哈希,平台验哈希后才入库。
      payload.aggregateHash = aggregateSm3(body.aggregate);
    }
    const res = await this.fetchWithTimeout(`${this.baseUrl}/connector/rws/assignments/${assignmentId}/complete`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`回传结果失败: HTTP ${res.status} ${text}`);
    }
  }

  async completeFlAssignment(
    assignmentId: string,
    body: { partyResult?: unknown; error?: string },
  ): Promise<void> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/connector/fl-prediction/assignments/${assignmentId}/complete`,
      {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`回传 FL 结果失败: HTTP ${res.status} ${text}`);
    }
  }

  async reportProgress(
    assignmentId: string,
    stage: string,
    detail?: string,
  ): Promise<void> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/connector/rws/assignments/${assignmentId}/progress`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage, detail }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`进度上报失败: HTTP ${res.status} ${text}`);
    }
  }

  async reportFlProgress(
    assignmentId: string,
    stage: string,
    detail?: string,
  ): Promise<void> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/connector/fl-prediction/assignments/${assignmentId}/progress`,
      {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, detail }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`FL 进度上报失败: HTTP ${res.status} ${text}`);
    }
  }

  async uploadAuditDigest(digest: {
    count: number;
    firstPrevHash: string;
    lastEntryHash: string | null;
    blocked?: Array<{
      action: string;
      actor: string;
      detail?: string;
      entryHash?: string;
      prevHash?: string;
      at: Date;
    }>;
  }): Promise<void> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/connector/audit/digest`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(digest),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`审计摘要上报失败: HTTP ${res.status} ${text}`);
    }
  }

  /** P1-9:连接器周期心跳上报(版本/任务状态/资源水位)。 */
  async sendHeartbeat(body: {
    version?: string;
    taskStatus?: Record<string, unknown>;
    resources?: Record<string, unknown>;
  }): Promise<void> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/connector/heartbeat`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`心跳上报失败: HTTP ${res.status} ${text}`);
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Connector-Token': this.connectorToken,
      'X-Connector-Participant': this.participantId,
    };
    // P1-4:证书签名头(时间戳防重放)。配置了私钥+证书指纹才启用。
    if (this.sm2PrivateKey && this.certFingerprint) {
      const timestamp = Date.now().toString();
      const payload = `${timestamp}:${this.participantId}`;
      headers['X-Connector-Cert-Fingerprint'] = this.certFingerprint;
      headers['X-Connector-Timestamp'] = timestamp;
      headers['X-Connector-Signature'] = sm2.doSignature(payload, this.sm2PrivateKey);
    }
    return headers;
  }
}
