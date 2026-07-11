import { Injectable, Optional } from '@nestjs/common';
import { CatalogProduct, CatalogProductResolver } from './catalog-product';

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
  analysis: {
    type: 'adverse-event-signal' | 'cohort-count' | 'condition-prevalence';
    drug?: string;
  };
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

@Injectable()
export class ControlPlaneClient {
  private readonly baseUrl: string;
  private readonly participantId: string;
  private readonly connectorToken: string;
  private readonly productCache = new Map<string, CatalogProduct>();

  constructor(@Optional() opts?: ControlPlaneClientOptions) {
    const o = opts ?? {};
    this.baseUrl = (o.baseUrl ?? process.env.CONTROL_PLANE_URL ?? 'http://localhost:5021/api/v1').replace(
      /\/$/,
      '',
    );
    this.participantId = o.participantId ?? process.env.CONNECTOR_PARTICIPANT_ID ?? '';
    this.connectorToken = o.connectorToken ?? process.env.CONNECTOR_PULL_TOKEN ?? 'dev-connector-token';
  }

  getParticipantId(): string {
    return this.participantId;
  }

  asCatalogResolver(): CatalogProductResolver {
    return (productId) => this.productCache.get(productId) ?? null;
  }

  async prefetchCatalogProduct(productId: string): Promise<CatalogProduct | null> {
    const cached = this.productCache.get(productId);
    if (cached) return cached;

    const res = await fetch(`${this.baseUrl}/connector/catalog/${productId}?participantId=${encodeURIComponent(this.participantId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) return null;

    const product = (await res.json()) as CatalogProduct;
    this.productCache.set(productId, product);
    return product;
  }

  async pullPendingRws(): Promise<ConnectorPendingAssignment[]> {
    const res = await fetch(
      `${this.baseUrl}/connector/rws/pending?participantId=${encodeURIComponent(this.participantId)}`,
      { headers: this.headers() },
    );
    if (!res.ok) {
      throw new Error(`拉取任务失败: HTTP ${res.status}`);
    }
    return (await res.json()) as ConnectorPendingAssignment[];
  }

  async pullPendingFl(): Promise<ConnectorPendingFlAssignment[]> {
    const res = await fetch(
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
    const res = await fetch(`${this.baseUrl}/connector/rws/assignments/${assignmentId}/complete`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
    const res = await fetch(
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
    const res = await fetch(`${this.baseUrl}/connector/rws/assignments/${assignmentId}/progress`, {
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
    const res = await fetch(
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

  private headers(): Record<string, string> {
    return {
      Accept: 'application/json',
      'X-Connector-Token': this.connectorToken,
      'X-Connector-Participant': this.participantId,
    };
  }
}
