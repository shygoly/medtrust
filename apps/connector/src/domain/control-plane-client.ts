import { Injectable, Optional } from '@nestjs/common';
import { signSm2 } from './sm2-sign';
import { loadConnectorPrivateKey } from './connector-key';
import { CatalogProduct, CatalogProductResolver } from './catalog-product';
import { sm3Hex } from './sm3';
import { RwsAnalysis } from './types';
import { stableStringify } from './canonical-json';
import { SignedConnectorTask } from './connector-task-signature';
import { ContractView } from './contract-view';
import { signResultEndorsement } from './result-endorsement';
import type { RevocationList } from '@medtrust/wasm-algorithms';
import type { OperatorRevocationList } from '@medtrust/mdop';
import { validateCoverageReport, type CdmCoverageReport } from '@medtrust/database';

export interface ControlPlaneClientOptions {
  baseUrl?: string;
  participantId?: string;
  connectorToken?: string;
  /** 连接器自有 SM2 私钥（64 hex）。缺省从环境变量/本地 0600 文件加载。 */
  sm2PrivateKey?: string;
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
  /**
   * third-party-module-admission 闸 5:算法模块吊销名单,随每个批次(含空批次)下发。
   * 连接器只接受版本更高的名单(防回放),收下即清掉被吊销模块的缓存。
   */
  revocations?: RevocationList;
  /** mdop-kernel:算子清单（注册中心密钥签名）。 */
  mdopOperators?: Array<{
    ref: string;
    digest: string;
    manifest: Record<string, unknown>;
    signature: unknown;
  }>;
  /** mdop-kernel:MDOP 算子吊销名单（平台节点密钥签名，版本单调）。 */
  mdopRevocations?: OperatorRevocationList;
  /** mdop-kernel:平台 → 连接器的 MDOP 信封（合约要约、片段要约、凭证、调度、销毁指令）。 */
  mdop?: Array<import('@medtrust/mdop').Envelope>;
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
    // 连接器自持私钥：内联环境变量或本地 0600 文件（D-MDOP-3，平台不再代生成）。
    this.sm2PrivateKey = o.sm2PrivateKey ?? loadConnectorPrivateKey();
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

  /**
   * 本国已解析过的产品元数据（ndi-connector-catalog-query）。
   *
   * 只返回**本院实际解析过**的产品，不是平台全量目录——连接器对外只承诺
   * 「本院能提供什么」，不代替平台广播目录。
   */
  listCachedCatalogProducts(): CatalogProduct[] {
    return [...this.productCache.values()];
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
      const resultSm3 = aggregateSm3(aggregate);
      payload.aggregateHash = resultSm3;
      // on-chain-provider-endorsement:对结果摘要做结果级 SM2 背书,随结果上链。
      // 未配置院内私钥/指纹时不带背书(平台按渐进/fail-closed 开关处置),不伪造。
      const endorsement = signResultEndorsement(
        resultSm3,
        this.sm2PrivateKey,
        this.certFingerprint,
      );
      if (endorsement) Object.assign(payload, endorsement);
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

  /**
   * omop-data-source-access task 5.1：上报一个 CDM 数据源的覆盖元数据（只有版本与统计量）。
   * 发出前用与控制面**同一个**校验器自检——格式不对就不发，而不是指望对端拦。
   * 按 label 上报：控制面据数据产品的声明把它挂到本院引用该 label 的产品上。
   */
  async reportDataSourceCoverage(label: string, report: CdmCoverageReport): Promise<void> {
    const body = validateCoverageReport(report);
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/connector/data-sources/${encodeURIComponent(label)}/coverage`,
      {
        method: 'POST',
        headers: { ...this.headers(body), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`覆盖元数据上报失败: HTTP ${res.status} ${text}`);
    }
  }

  /** P1-9:连接器周期心跳上报(版本/任务状态/资源水位)。 */
  async sendHeartbeat(body: {
    version?: string;
    taskStatus?: Record<string, unknown>;
    resources?: Record<string, unknown>;
    /** mdop-kernel：能力通告（运行时 / system 算子 / 白名单摘要 / TEE / 协同协议）。 */
    mdop?: { [key: string]: unknown };
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
      headers['X-Connector-Signature'] = signSm2(payload, this.sm2PrivateKey);
      return headers;
    }
    if (process.env.CONNECTOR_TOKEN_AUTH_ALLOWED === 'true' && this.connectorToken) {
      headers['X-Connector-Token'] = this.connectorToken;
    }
    return headers;
  }
}
