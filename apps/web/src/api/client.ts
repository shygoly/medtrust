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
    
    return this.request<{ logs: any[]; total: number }>(`/audit?${queryParams.toString()}`);
  }

  // Catalog (data products) — federated control plane. Replaces /data-assets.
  // The catalog holds metadata only; raw data stays on the provider's connector.
  async getDataAssets() {
    return this.request<DataAsset[]>('/catalog');
  }

  async createDataAsset(data: Partial<DataAsset>) {
    return this.request<DataAsset>('/catalog', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Digital contracts — federated control plane. Replaces /access-requests.
  // Authorization = issuing a digital contract (no separate one-shot approval step).
  async getAccessRequests() {
    return this.request<AccessRequest[]>('/contracts');
  }

  async createAccessRequest(data: Partial<AccessRequest>) {
    return this.request<AccessRequest>('/contracts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // In the federated model, approving a request = issuing a digital contract.
  // Kept for backward compatibility with the legacy requests page.
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
