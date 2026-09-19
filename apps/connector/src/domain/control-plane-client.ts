import { Injectable, Optional } from '@nestjs/common';
import { sm2 } from 'sm-crypto';
import { CatalogProduct, CatalogProductResolver } from './catalog-product';
import { sm3Hex } from './sm3';
import { RwsAnalysis } from './types';
import { stableStringify } from './canonical-json';
import { SignedConnectorTask } from './connector-task-signature';
import { ContractView } from './contract-view';

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
  /** algorithm-sandbox:合约固定了模块时派发携带模块引用(D6)。 */
  module?: { analysisType: string; sm3: string };
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

/** algorithm-sandbox:控制面模块分发载荷(字节走 base64)。 */
export interface ConnectorModulePayload {
  analysisType: string;
  sm3: string;
  signature: string;
  abiVersion: number;
  bytes: string;
}

export interface ConnectorPendingFlAssignment {
  assignmentId: string;
  taskId: string;
  purpose: string;
  workloadType: 'federated_learning';
  flPredictionSpec: Record<string, unknown>;
  contract: ConnectorPendingAssignment['contract'];
}

function aggregateSm3(aggregate: unknown): string {
  return sm3Hex(stableStringify(aggregate));
}

/** 稳定序列化:与平台 canonical-json 同口径(聚合哈希 / 请求体 SM3 共用)。 */
export interface ConnectorTaskBatch {
  participantId: string;
  serverTime: string;
  waitMs: number;
  rws: SignedConnectorTask<ConnectorPendingAssignment>[];
  flPrediction: SignedConnectorTask<ConnectorPendingFlAssignment>[];
  flRounds: SignedConnectorTask<ConnectorFlRoundTask>[];
}

/** 平台下发的联邦训练轮次任务载荷（与 API 侧 ConnectorFlRoundTask 同形）。 */
export interface ConnectorFlRoundTask {
  roundTaskId: string;
  taskId: string;
  round: number;
  participantId: string;
  /** 本轮任务声明的用途（PEP 用它比对合约目的）。 */
  purpose: string;
  specYaml: string;
  globalAdapterJson: string;
  nodePlan: Array<{
    participantId: string;
    tier: string;
    device: string;
    offloadAggregation: boolean;
    localEpochs: number;
  }>;
  contract: ContractView & { dataProductId?: string };
}

export interface RoundCompletionBody {
  adapterDeltaJson?: string;
  sampleCount?: number;
  localLoss?: number;
  message?: string;
  resultSm3?: string;
  signature?: string;
  error?: string;
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
    // outbound-longpoll-agent-auth D5:不再有缺省令牌;未显式配置则为空串,
    // 且仅在 CONNECTOR_TOKEN_AUTH_ALLOWED=true 时才作为降级通道使用(见 headers())。
    this.connectorToken = o.connectorToken ?? process.env.CONNECTOR_PULL_TOKEN ?? '';
    this.requestTimeoutMs = Number(process.env.CONTROL_PLANE_TIMEOUT_MS ?? 15_000);
    this.certFingerprint = process.env.CONNECTOR_CERT_FINGERPRINT ?? '';
    this.sm2PrivateKey = process.env.CONNECTOR_SM2_PRIVATE_KEY ?? '';
  }

  /** fetch with a timeout — a hung control plane must not stall the poller. */
  private async fetchWithTimeout(
    url: string,
    init?: RequestInit,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<Response> {
    return fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
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

  /**
   * outbound-longpoll-agent-auth D2:统一长轮询领取待办(RWS / FL 预测 / 联邦训练轮次)。
   * 没有待办时服务端挂起请求直到超时或新任务到达;HTTP 超时 = waitMs + 10s。
   */
  async longPollTasks(waitMs: number): Promise<ConnectorTaskBatch> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/connector/tasks/pending?waitMs=${Math.max(0, Math.floor(waitMs))}`,
      { headers: this.headers() },
      Math.max(0, Math.floor(waitMs)) + 10_000,
    );
    if (!res.ok) {
      throw new Error(`长轮询领取任务失败: HTTP ${res.status}`);
    }
    return (await res.json()) as ConnectorTaskBatch;
  }

  /** 回传本院联邦训练轮次结果(结果 SM3 + 连接器 SM2 签名)。 */
  async completeFlRound(
    roundTaskId: string,
    body: RoundCompletionBody,
  ): Promise<void> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/connector/fl-rounds/${encodeURIComponent(roundTaskId)}/complete`,
      {
        method: 'POST',
        headers: { ...this.headers(body), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`回传训练轮次失败: HTTP ${res.status} ${text}`);
    }
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

  /** algorithm-sandbox D6:按 SM3 拉取签名算法模块(复用连接器鉴权)。 */
  async fetchModule(sm3: string): Promise<ConnectorModulePayload> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/connector/modules/${encodeURIComponent(sm3)}`,
      { headers: this.headers() },
    );
    if (!res.ok) {
      throw new Error(`拉取算法模块失败 sm3=${sm3}: HTTP ${res.status}`);
    }
    return (await res.json()) as ConnectorModulePayload;
  }

  async completeAssignment(
    assignmentId: string,
    body: { aggregate?: unknown; error?: string },
  ): Promise<void> {
    const payload: Record<string, unknown> = { ...body };
    if (body.aggregate) {
      // P1-6:回传结果携带 SM3 哈希,平台验哈希后才入库。
      // 平台对 JSON 解析后的对象验哈希:JSON 会丢弃 undefined 键、把非有限数变成 null,
      // 所以先按 JSON 规范化,再对"实际发出去的内容"算哈希。
      const aggregate = JSON.parse(JSON.stringify(body.aggregate)) as unknown;
      payload.aggregate = aggregate;
      payload.aggregateHash = aggregateSm3(aggregate);
    }
    const res = await this.fetchWithTimeout(`${this.baseUrl}/connector/rws/assignments/${assignmentId}/complete`, {
      method: 'POST',
      headers: { ...this.headers(payload), 'Content-Type': 'application/json' },
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
        headers: { ...this.headers(body), 'Content-Type': 'application/json' },
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
    const payload = { stage, detail };
    const res = await this.fetchWithTimeout(`${this.baseUrl}/connector/rws/assignments/${assignmentId}/progress`, {
      method: 'POST',
      headers: { ...this.headers(payload), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
    const payload = { stage, detail };
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/connector/fl-prediction/assignments/${assignmentId}/progress`,
      {
        method: 'POST',
        headers: { ...this.headers(payload), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
      headers: { ...this.headers(digest), 'Content-Type': 'application/json' },
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
      headers: { ...this.headers(body), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`心跳上报失败: HTTP ${res.status} ${text}`);
    }
  }

  /**
   * 出站请求头。
   *
   * 证书签名（缺省强制通道，outbound-longpoll-agent-auth D5）：签名载荷
   * `ts:participantId[:bodySm3]` —— 带请求体时覆盖请求体 SM3，防止代理篡改。
   * 令牌降级只在显式开启 `CONNECTOR_TOKEN_AUTH_ALLOWED=true` 且显式配置了
   * `CONNECTOR_PULL_TOKEN` 时使用；代码里没有缺省令牌。
   */
  private headers(body?: unknown): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Connector-Participant': this.participantId,
    };
    if (this.sm2PrivateKey && this.certFingerprint) {
      const timestamp = Date.now().toString();
      const bodySm3 =
        body === undefined || body === null
          ? ''
          : sm3Hex(stableStringify(body));
      const payload = bodySm3
        ? `${timestamp}:${this.participantId}:${bodySm3}`
        : `${timestamp}:${this.participantId}`;
      headers['X-Connector-Cert-Fingerprint'] = this.certFingerprint;
      headers['X-Connector-Timestamp'] = timestamp;
      headers['X-Connector-Signature'] = sm2.doSignature(payload, this.sm2PrivateKey);
      return headers;
    }
    if (process.env.CONNECTOR_TOKEN_AUTH_ALLOWED === 'true' && this.connectorToken) {
      headers['X-Connector-Token'] = this.connectorToken;
    }
    return headers;
  }
}
