// MedTrust API 客户端

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021/api/v1';

class ApiClient {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('medtrust_token', token);
    }
  }

  getToken(): string | null {
    if (this.token) return this.token;
    if (typeof window !== 'undefined') {
      return localStorage.getItem('medtrust_token');
    }
    return null;
  }

  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('medtrust_token');
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Auth
  async login(credentials: { email: string; password: string }) {
    return this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  }

  async register(data: { email: string; password: string; name?: string }) {
    return this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Tenants
  async getTenants() {
    return this.request<Tenant[]>('/tenants');
  }

  async getTenant(id: number) {
    return this.request<Tenant>(`/tenants/${id}`);
  }

  async createTenant(data: Partial<Tenant>) {
    return this.request<Tenant>('/tenants', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Compute Tasks
  async getComputeTasks() {
    return this.request<ComputeTask[]>('/compute-tasks');
  }

  async getComputeTask(id: string) {
    return this.request<ComputeTask>(`/compute-tasks/${id}`);
  }

  async createComputeTask(data: Partial<ComputeTask>) {
    return this.request<ComputeTask>('/compute-tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateComputeTaskStatus(id: number, status: string) {
    return this.request<ComputeTask>(`/compute-tasks/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async cancelComputeTask(id: string) {
    return this.request<void>(`/compute-tasks/${id}/cancel`, {
      method: 'POST',
    });
  }

  async getComputeTaskResult(id: string) {
    return this.request<any>(`/compute-tasks/${id}/result`);
  }

  async getComputeTaskLogs(id: string, params?: { limit?: number; offset?: number }) {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());
    const query = queryParams.toString();
    return this.request<any[]>(`/compute-tasks/${id}/logs${query ? `?${query}` : ''}`);
  }

  async retryComputeTask(id: string) {
    return this.request<ComputeTask>(`/compute-tasks/${id}/retry`, {
      method: 'POST',
    });
  }

  async deleteComputeTask(id: string) {
    return this.request<void>(`/compute-tasks/${id}`, {
      method: 'DELETE',
    });
  }

  // Audit Logs
  async getAuditLogs(params?: { action?: string; resource?: string; limit?: number }) {
    const queryParams = new URLSearchParams();
    if (params?.action) queryParams.append('action', params.action);
    if (params?.resource) queryParams.append('resource', params.resource);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    
    // 后端返回 [logs, total](getManyAndCount 元组);用 any 兼容新旧消费方。
    return this.request<any>(`/audit?${queryParams.toString()}`);
  }

  // Catalog (data products) — federated control plane. Replaces /data-assets.
  // The catalog holds metadata only; raw data stays on the provider's connector.
  /** @deprecated Use DataProduct catalog endpoints directly. */
  async getDataAssets() {
    return this.request<DataAsset[]>('/catalog');
  }

  /** @deprecated Use DataProduct catalog endpoints directly. */
  async createDataAsset(data: Partial<DataAsset>) {
    return this.request<DataAsset>('/catalog', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Digital contracts — federated control plane. Replaces /access-requests.
  // Authorization = issuing a digital contract (no separate one-shot approval step).
  /** @deprecated Use DigitalContract endpoints directly. */
  async getAccessRequests() {
    return this.request<AccessRequest[]>('/contracts');
  }

  /** @deprecated Use DigitalContract endpoints directly. */
  async createAccessRequest(data: Partial<AccessRequest>) {
    return this.request<AccessRequest>('/contracts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // In the federated model, approving a request = issuing a digital contract.
  /** @deprecated Use /contracts/:id/attest directly. */
  async approveAccessRequest(id: string | number) {
    return this.request<AccessRequest>(`/contracts/${id}/attest`, {
      method: 'POST',
    });
  }

  // Settlement ledger — role-gated server-side (provider/consumer/operator view).
  async getSettlements() {
    return this.request<any[]>('/settlements');
  }

  // SecretFlow 任务设计助手 — 自然语言 → SecretFlowTaskSpec 草稿（LLM 仅生成草稿，
  // 提交仍走 /secretflow/preview + /tasks）。
  async draftSecretFlowSpec(description: string, purpose?: string) {
    return this.request<SecretFlowDraftResponse>('/secretflow/assistant/draft', {
      method: 'POST',
      body: JSON.stringify(purpose ? { description, purpose } : { description }),
    });
  }

  // ── 七层能力图谱 (Atlas) ──────────────────────────────────────────────
  // 能力层系统对象读 + CRUD(写需 operator 角色,服务端门控)。
  async listCapability(layer: CapabilityLayer) {
    return this.request<CapabilityObject[]>(`/capability/${layer}`);
  }

  async getCapabilityObject(layer: CapabilityLayer, key: string) {
    return this.request<CapabilityObject | null>(`/capability/${layer}/${key}`);
  }

  async createCapabilityObject(layer: CapabilityLayer, dto: Partial<CapabilityObject>) {
    return this.request<CapabilityObject>(`/capability/${layer}`, {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }

  async updateCapabilityObject(layer: CapabilityLayer, key: string, dto: Partial<CapabilityObject>) {
    return this.request<CapabilityObject>(`/capability/${layer}/${key}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    });
  }

  async deleteCapabilityObject(layer: CapabilityLayer, key: string) {
    return this.request<{ deleted: true; key: string }>(`/capability/${layer}/${key}`, {
      method: 'DELETE',
    });
  }

  // 组合 + L2 合规裁决
  async createComposition(dto: Record<string, unknown>) {
    return this.request<Composition>('/composition', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }

  async evaluateCompliance(compositionId: string) {
    return this.request<ComplianceEvaluation>(`/compliance/evaluate/${compositionId}`, {
      method: 'POST',
    });
  }

  async getEvaluation(compositionId: string) {
    return this.request<ComplianceEvaluation>(`/compliance/evaluation/${compositionId}`);
  }
}

export interface SecretFlowDraftResponse {
  spec: {
    parties: { participantId: string; role: string }[];
    modalities: { type: string; dataProductId?: string; count?: number }[];
    llmBackbone: { modelType: string; modelNameOrPath: string };
    peftStrategy: { type: string; r: number; alpha: number; targetModules: string[] };
    privacy: { teeRequired: boolean; heuEnabled: boolean; dpSgd?: Record<string, number> };
    outputPolicy: { allowedArtifacts: string[] };
    [key: string]: unknown;
  };
  yaml: string;
  rationale: Partial<Record<'parties' | 'modalities' | 'llmBackbone' | 'peftStrategy' | 'privacy' | 'outputPolicy', string>>;
  warnings: string[];
  assumptions: string[];
}

export const api = new ApiClient();

// Import types
import type { User, Tenant, DataAsset, AccessRequest, LoginCredentials, RegisterData, AuthResponse, ComputeTask } from '@/types';
import type { CapabilityLayer, CapabilityObject, Composition, ComplianceEvaluation } from '@/types/capability.types';
