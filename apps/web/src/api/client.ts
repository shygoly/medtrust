// MedTrust API 客户端

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

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

  // Data Assets
  async getDataAssets() {
    return this.request<DataAsset[]>('/data-assets');
  }

  async createDataAsset(data: Partial<DataAsset>) {
    return this.request<DataAsset>('/data-assets', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Access Requests
  async getAccessRequests() {
    return this.request<AccessRequest[]>('/access-requests');
  }

  async createAccessRequest(data: Partial<AccessRequest>) {
    return this.request<AccessRequest>('/access-requests', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async approveAccessRequest(id: number) {
    return this.request<AccessRequest>(`/access-requests/${id}/approve`, {
      method: 'POST',
    });
  }
}

export const api = new ApiClient();

// Import types
import type { User, Tenant, DataAsset, AccessRequest, LoginCredentials, RegisterData, AuthResponse, ComputeTask } from '@/types';
