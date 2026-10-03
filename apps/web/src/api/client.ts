// MedTrust API 客户端

import { classifyRefreshStatus, type RefreshOutcome } from '@/lib/session-errors';

// 生产构建为同源相对路径 /api/v1（nginx 在服务器本机转给 API）；本地开发直连 :5021。
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021/api/v1';

const TOKEN_KEY = 'medtrust_token';
const REFRESH_TOKEN_KEY = 'medtrust_refresh_token';
const USER_KEY = 'medtrust_user';

class ApiClient {
  private token: string | null = null;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<RefreshOutcome> | null = null;

  setTokens(token: string, refreshToken?: string) {
    this.token = token;
    if (refreshToken) this.refreshToken = refreshToken;
    if (typeof window !== 'undefined') {
      localStorage.setItem(TOKEN_KEY, token);
      if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    }
  }

  // 兼容旧调用点(setToken 只更新 access token)。
  setToken(token: string) {
    this.setTokens(token);
  }

  getToken(): string | null {
    if (this.token) return this.token;
    if (typeof window !== 'undefined') {
      return localStorage.getItem(TOKEN_KEY);
    }
    return null;
  }

  getRefreshToken(): string | null {
    if (this.refreshToken) return this.refreshToken;
    if (typeof window !== 'undefined') {
      return localStorage.getItem(REFRESH_TOKEN_KEY);
    }
    return null;
  }

  clearTokens() {
    this.token = null;
    this.refreshToken = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  }

  // 兼容旧调用点。
  clearToken() {
    this.clearTokens();
  }

  // P0-7:401 → refresh → 原请求重试一次;refresh 被服务端拒绝才踢出。
  // 网络失败/网关 5xx 只是暂时不可用:保留会话,让调用方稍后重试(见 session-errors)。
  // 用单飞 Promise 避免并发 401 同时触发多个 refresh。
  private async refreshSession(): Promise<RefreshOutcome> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async (): Promise<RefreshOutcome> => {
      const raw = this.getRefreshToken();
      if (!raw) return 'rejected';
      try {
        const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: raw }),
        });
        const outcome = classifyRefreshStatus(response.status);
        if (outcome !== 'refreshed') return outcome;
        const data = (await response.json()) as {
          access_token: string;
          refresh_token?: string;
          user?: unknown;
        };
        this.setTokens(data.access_token, data.refresh_token);
        if (data.user && typeof window !== 'undefined') {
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        }
        return 'refreshed';
      } catch {
        return 'unavailable';
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  private async rawRequest<T>(
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
      const err = new Error(error.message || `HTTP ${response.status}`) as Error & { status: number };
      err.status = response.status;
      throw err;
    }

    return response.json();
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    try {
      return await this.rawRequest<T>(endpoint, options);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      const isRefreshCall = endpoint === '/auth/refresh';
      if (status !== 401 || isRefreshCall || typeof window === 'undefined') {
        throw err;
      }
      // 尝试静默刷新并重放原请求一次。
      const outcome = await this.refreshSession();
      if (outcome === 'refreshed') {
        return this.rawRequest<T>(endpoint, options);
      }
      if (outcome === 'unavailable') {
        throw Object.assign(new Error('网络不稳定，请稍后重试'), { status: 503 });
      }
      this.clearTokens();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login?expired=1';
      }
      throw Object.assign(new Error('会话已过期，请重新登录'), { status: 401 });
    }
  }

  // Auth
  async getCaptcha() {
    return this.request<{ captchaId: string; image: string; expiresInSeconds: number }>('/auth/captcha');
  }

  async login(credentials: { account: string; password: string; captchaId?: string; captchaCode?: string; mfaCode?: string }) {
    return this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  }

  async sendSmsCode(phone: string) {
    return this.request<{ ok: boolean }>('/auth/sms/send', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    });
  }

  async smsLogin(phone: string, code: string) {
    return this.request<AuthResponse>('/auth/login/sms', {
      method: 'POST',
      body: JSON.stringify({ phone, code }),
    });
  }

  async createCaChallenge(account: string) {
    return this.request<{ challengeId: string; challenge: string; expiresInSeconds: number }>(
      '/auth/ca/challenge',
      {
        method: 'POST',
        body: JSON.stringify({ account }),
      },
    );
  }

  async caLogin(account: string, challengeId: string, signature: string) {
    return this.request<AuthResponse>('/auth/login/ca', {
      method: 'POST',
      body: JSON.stringify({ account, challengeId, signature }),
    });
  }

  async register(data: { email: string; password: string; name?: string }) {
    return this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // 我的收藏(P1-11)
  async getFavorites() {
    return this.request<{ items: Array<{ id: number; productId: string; createdAt: string; product: { id: string; urn: string; title: string; providerId: string; productType: string; status: string } | null }>; total: number }>('/account/favorites');
  }

  async addFavorite(productId: string) {
    return this.request<{ ok: boolean; duplicate?: boolean }>(`/account/favorites/${productId}`, {
      method: 'POST',
    });
  }

  async removeFavorite(productId: string) {
    return this.request<{ ok: boolean }>(`/account/favorites/${productId}`, {
      method: 'DELETE',
    });
  }

  // MFA(P2-4)
  async setupMfa() {
    return this.request<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup', {
      method: 'POST',
    });
  }

  async enableMfa(code: string) {
    return this.request<{ ok: boolean }>('/auth/mfa/enable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async disableMfa(code: string) {
    return this.request<{ ok: boolean }>('/auth/mfa/disable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  // 丝路数港互认(P2-2)
  async searchSilkRoadSubjects(uscc: string) {
    return this.request<Array<{ subjectId: string; nodeId: string; orgName?: string; uscc?: string; region?: string; legalPerson?: string; status: string }>>(
      `/account/interop/silk-road/subjects?uscc=${encodeURIComponent(uscc)}`,
    );
  }

  async importSilkRoadSubject(subjectId: string) {
    return this.request<{ application: CertificationApplication }>(
      `/account/interop/silk-road/subjects/${subjectId}/import`,
      { method: 'POST' },
    );
  }

  async syncSilkRoadSubjects() {
    return this.request<{ imported: number }>('/admin/interop/silk-road/sync', { method: 'POST' });
  }

  async getSilkRoadSubjects(search?: string) {
    const q = search ? `?search=${encodeURIComponent(search)}` : '';
    return this.request<Array<{ subjectId: string; nodeId: string; orgName?: string; uscc?: string; region?: string; legalPerson?: string; status: string }>>(`/admin/interop/silk-road/subjects${q}`);
  }

  async pushSilkRoadCatalog() {
    return this.request<{ pushed: number }>('/admin/interop/silk-road/push-catalog', { method: 'POST' });
  }

  async reportSilkRoadAudit() {
    return this.request<{ reported: boolean }>('/admin/interop/silk-road/report-audit', { method: 'POST' });
  }

  // 公开门户(P1-10)
  async getPublicCatalog() {
    return this.request<{ items: Array<{ id: string; urn: string; title: string; providerId: string; productType: string; classification?: string; recordCount: number; rightsConfirmed: boolean }>; total: number }>('/public/catalog');
  }

  async getPublicInstitutions() {
    return this.request<{ items: Array<{ id: string; org: string; role?: string; region?: string; subjectVerified: boolean; dataVerified: boolean }>; total: number }>('/public/institutions');
  }

  // 机构认证(P1-4/P1-5/P1-6)
  async getMyCertification() {
    return this.request<{ application: CertificationApplication | null }>('/account/certification');
  }

  async saveCertification(data: Record<string, unknown>) {
    return this.request<{ application: CertificationApplication }>('/account/certification', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async uploadCertFile(input: {
    kind: 'license' | 'logo';
    fileName: string;
    contentType: string;
    dataBase64: string;
  }) {
    return this.request<{ key: string; url?: string }>('/account/upload', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  // 用户 CA 身份凭证(P1-7)
  async issueUserCa(identityName: string, publicKey: string) {
    return this.request<{ certificate: { fingerprint: string; validUntil: string } }>(
      '/account/certification/ca',
      {
        method: 'POST',
        body: JSON.stringify({ identityName, publicKey }),
      },
    );
  }

  async revokeUserCa() {
    return this.request<{ ok: boolean }>('/account/certification/ca/revoke', {
      method: 'POST',
    });
  }

  // P1-6:读取已上传证照/LOGO(带 Authorization 的 blob),返回可预览 object URL。
  async getAccountFileObjectUrl(key: string): Promise<string | null> {
    const url = `${API_BASE_URL}/account/files?key=${encodeURIComponent(key)}`;
    const token = this.getToken();
    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }

  // 审计报告导出(P2-5)
  async exportAudit(params?: { action?: string; resource?: string; startDate?: string; endDate?: string; limit?: number; offset?: number }) {
    const q = new URLSearchParams();
    if (params?.action) q.append('action', params.action);
    if (params?.resource) q.append('resource', params.resource);
    if (params?.startDate) q.append('startDate', params.startDate);
    if (params?.endDate) q.append('endDate', params.endDate);
    if (params?.limit) q.append('limit', String(params.limit));
    if (params?.offset) q.append('offset', String(params.offset));
    return this.request<any>(`/audit/export?${q.toString()}`);
  }

  // P2-5:审计证据包(ZIP)。以 fetch + Bearer 拉取 blob,返回下载对象。
  async downloadAuditEvidencePackage(params?: { action?: string; resource?: string; startDate?: string; endDate?: string; limit?: number }) {
    const q = new URLSearchParams();
    if (params?.action) q.append('action', params.action);
    if (params?.resource) q.append('resource', params.resource);
    if (params?.startDate) q.append('startDate', params.startDate);
    if (params?.endDate) q.append('endDate', params.endDate);
    if (params?.limit) q.append('limit', String(params.limit));
    const url = `${API_BASE_URL}/audit/evidence-package?${q.toString()}`;
    const token = this.getToken();
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('证据包导出失败');
    return res.blob();
  }

  // 运营管理(P0-11/P1-9)
  async getAdminUsers(params?: { search?: string; role?: string; status?: string; limit?: number; offset?: number }) {
    const q = new URLSearchParams();
    if (params?.search) q.append('search', params.search);
    if (params?.role) q.append('role', params.role);
    if (params?.status) q.append('status', params.status);
    if (params?.limit) q.append('limit', String(params.limit));
    if (params?.offset) q.append('offset', String(params.offset));
    return this.request<{ items: AdminUser[]; total: number }>(`/admin/users?${q.toString()}`);
  }

  async updateUser(id: number, patch: { name?: string; participantId?: string; participantRole?: string; status?: string }) {
    return this.request<AdminUser>(`/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async adminResetPassword(id: number, newPassword: string) {
    return this.request<AdminUser>(`/admin/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    });
  }

  // P2-6 基础设施管理(admin)。空间创建/删除唯一入口为 /spaces(operator 门禁);
  // 此处空间为 admin 只读视角。
  async getSpaces() {
    return this.request<Array<{ id: string; name: string; description?: string; status: string; createdAt: string }>>('/admin/infra/spaces');
  }

  async getCertificates() {
    return this.request<Array<{ sm2Fingerprint: string; participantId: string; connectorId: string; spaceId: string; validUntil: string; revoked: boolean; issuedAt: string }>>('/admin/infra/certificates');
  }

  async revokeCertificate(fingerprint: string) {
    return this.request<{ ok: boolean }>(`/admin/infra/certificates/${fingerprint}/revoke`, {
      method: 'POST',
    });
  }

  async getCaInfo() {
    return this.request<{ spaceId: string; caPublicKey: string; issuedCount: number; revokedCount: number }>('/admin/infra/ca/info');
  }

  async getOpenPlatformApps() {
    return this.request<Array<{ id: string; appId: string; name: string; scopes?: string[]; status: string; createdAt: string }>>('/admin/infra/open-platform/apps');
  }

  async createOpenPlatformApp(data: { name: string; scopes?: string[] }) {
    return this.request<{ appId: string; appSecret: string; name: string; scopes: string[] }>('/admin/infra/open-platform/apps', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async revokeOpenPlatformApp(id: string) {
    return this.request<{ ok: boolean }>(`/admin/infra/open-platform/apps/${id}/revoke`, {
      method: 'POST',
    });
  }

  async getSystemStatus() {
    return this.request<{
      node: string;
      platform: string;
      arch: string;
      uptimeSeconds: number;
      env: Record<string, string | null>;
      generatedAt: string;
    }>('/admin/system/status');
  }

  async getAdminCertifications(params?: { status?: string; limit?: number; offset?: number }) {
    const q = new URLSearchParams();
    if (params?.status) q.append('status', params.status);
    if (params?.limit) q.append('limit', String(params.limit));
    if (params?.offset) q.append('offset', String(params.offset));
    return this.request<{ items: CertificationApplication[]; total: number }>(`/admin/certifications?${q.toString()}`);
  }

  async reviewCertification(id: string, approve: boolean, note?: string) {
    return this.request<{ application: CertificationApplication }>(`/admin/certifications/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ approve, note }),
    });
  }

  async forgotPassword(email: string) {
    return this.request<{ ok: boolean }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    return this.request<{ ok: boolean }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, code, newPassword }),
    });
  }

  async sendSmsResetCode(phone: string) {
    return this.request<{ ok: boolean }>('/auth/sms/reset-code', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    });
  }

  async resetPasswordBySms(phone: string, code: string, newPassword: string) {
    return this.request<{ ok: boolean }>('/auth/reset-password/sms', {
      method: 'POST',
      body: JSON.stringify({ phone, code, newPassword }),
    });
  }

  async refresh() {
    return this.request<AuthResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: this.getRefreshToken() || '' }),
    });
  }

  async logout() {
    const raw = this.getRefreshToken();
    if (!raw) return { ok: true };
    try {
      return await this.request<{ ok: boolean }>('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: raw }),
      });
    } catch {
      // 登出为尽力而为:网络失败也继续清理本地会话。
      return { ok: true };
    }
  }

  async exchangeSsoTicket(ticket: string) {
    return this.request<AuthResponse>('/auth/sso/exchange', {
      method: 'POST',
      body: JSON.stringify({ ticket }),
    });
  }

  async getProfile() {
    return this.request<{
      userId: number;
      email: string;
      participantId?: string;
      role?: "provider" | "consumer" | "operator" | "compliance" | "admin";
    }>('/auth/profile');
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
  async getDataAssets(type?: "data" | "service") {
    const q = type ? `?type=${type}` : '';
    return this.request<DataAsset[]>(`/catalog${q}`);
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

  // RBQM 中心化监查 — KRI 定义 / 站点观测 / QTL 越限（合规·运营方门控）。
  async getKriDefinitions() {
    return this.request<any[]>('/rbqm/kris');
  }
  async getKriObservations(studyId?: string) {
    const q = studyId ? `?studyId=${encodeURIComponent(studyId)}` : '';
    return this.request<any[]>(`/rbqm/observations${q}`);
  }
  async getQtlBreaches(status?: string) {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request<any[]>(`/rbqm/breaches${q}`);
  }
  async acknowledgeQtlBreach(id: string) {
    return this.request<any>(`/rbqm/breaches/${id}/acknowledge`, { method: 'POST' });
  }

  // RWS 编排 — 药企发起 → 连接器出站拉取执行
  async submitRwsTask(data: {
    title?: string;
    purpose: string;
    analysis: RwsAnalysisSubmission;
    contractIds: string[];
  }) {
    return this.request<RwsOrchestrationRecord>('/rws/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listRwsTasks() {
    return this.request<RwsOrchestrationRecord[]>('/rws/tasks');
  }

  /** Provider: inbound RWS assignments for this hospital's connector. */
  async listRwsInbox() {
    return this.request<ProviderInboxItem[]>('/rws/inbox');
  }

  async getRwsTask(taskId: string) {
    return this.request<RwsOrchestrationRecord>(`/rws/tasks/${taskId}`);
  }

  /**
   * rws-study-protocol-spec Phase 3 — revise a protocol into a new version.
   * Bumps protocolVersion, requires revisionReason, drops existing assignments
   * (the revised protocol must be re-dispatched), and resets frozenAt.
   */
  async reviseRwsTask(taskId: string, data: {
    analysis: RwsAnalysisSubmission;
    revisionReason: string;
    contractIds?: string[];
  }) {
    return this.request<RwsOrchestrationRecord>(`/rws/tasks/${taskId}/revise`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async submitFlPredictionTask(data: {
    title?: string;
    flPredictionSpec: import('@/lib/fl-prediction-presets').FlPredictionTaskSpec;
    contractIds: string[];
    computeTaskId?: number;
  }) {
    return this.request<FlPredictionOrchestrationRecord>('/fl-prediction/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listFlPredictionTasks() {
    return this.request<FlPredictionOrchestrationRecord[]>('/fl-prediction/tasks');
  }

  /** Provider: inbound FL assignments for this hospital's connector. */
  async listFlInbox() {
    return this.request<ProviderInboxItem[]>('/fl-prediction/inbox');
  }

  async getFlPredictionTask(taskId: string) {
    return this.request<FlPredictionOrchestrationRecord>(`/fl-prediction/tasks/${taskId}`);
  }

  async getFlWeightBundle(taskId: string) {
    return this.request<import('@/lib/fl-local-infer').FlWeightBundle>(
      `/fl-prediction/tasks/${encodeURIComponent(taskId)}/weight-bundle`,
    );
  }

  async listContracts() {
    return this.request<any[]>('/contracts');
  }

  // ── MDOP 作业（mdop-kernel §9）────────────────────────────────────────────

  /** 提交 L1.5 失衡检测的 MDOP 作业（计划模板 rws.l15.disproportionality）。 */
  async submitMdopL15(data: {
    purpose: string;
    applicant: { org: string; project: string };
    contracts: string[];
    drug: string;
    hospitals: Array<{ participantId: string; dataProductId: string }>;
    cohort?: string;
    minCell?: number;
    ethicsRef?: string;
    notBefore: string;
    notAfter: string;
  }) {
    return this.request<{ jobId: string; status: string; template: string }>('/mdop/jobs/l15', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /** MDOP 作业详情（阶段状态、片段哈希、凭证与回执）。 */
  async getMdopJob(jobId: string) {
    return this.request<{
      job: {
        id: string;
        status: string;
        purpose: string;
        planHash?: string | null;
        rejectReason?: string | null;
      };
      stages: Array<{
        stageId: string;
        node: string;
        opRef: string;
        status: string;
        attempt: number;
        lastError?: string | null;
      }>;
      fragments: Array<{ node: string; fragmentHash: string }>;
      /** 回执链逐节点连续性（平台侧判据；C2 作业还含可信空间节点）。 */
      chains?: Array<{ node: string; valid: boolean; length: number; brokenAt?: string }>;
      /** 链头锚定记录（`payload.status === 'pending'` 表示链不可达、进补偿队列，不是已锚）。 */
      anchors?: Array<{ node: string; payload: Record<string, unknown> }>;
      /** 凭证摘要：各院批准的是「在哪份代码下执行」（C2 作业才有 attestation）。 */
      ticket?: {
        ticketId: string;
        status: string;
        attestation: Record<string, { tee: string; measurement: string; min_tcb?: string }>;
      } | null;
      /** 平台侧合并结果（C3 交付物）；未收齐投递时为 null。 */
      result?: {
        analysisType?: string;
        cohortSize?: number;
        buckets?: Array<Record<string, unknown>>;
        warnings?: Array<{ code: string; detail: string }>;
        /** 疫苗接种后不良事件 SCRI 才有：风险期 / 对照期与分层计数。 */
        windows?: { risk: [number, number]; control: [number, number] };
        strata?: Array<Record<string, unknown>>;
      } | null;
    }>(`/mdop/jobs/${encodeURIComponent(jobId)}`);
  }

  /** 读取某合约的 MDOP 条款（含证明策略）——控制台据此展示/校验 C2 资格（任务 7.1）。 */
  async describeMdopContract(contractId: string) {
    return this.request<{
      contract: Record<string, unknown>;
      canonical: string;
      holderSignature?: string | null;
      platformCountersignature?: string | null;
      mdopStatus: string;
      recipients: string[];
    }>(`/contracts/${encodeURIComponent(contractId)}/mdop`);
  }

  /**
   * 发起 MDOP 要约（任务 7.1）。带 `attestationPolicy` 即声明「该合约允许数据密文出域至可信空间节点」——
   * 这会改变条款与哈希，需要各方重新签署。
   */
  async offerMdopContract(
    contractId: string,
    opts: {
      attestationPolicy?: {
        tee: string[];
        minTcb?: string | Record<string, string>;
        allowedMeasurements?: string[];
      };
      review?: { mode: 'auto' | 'manual'; deadlineHours: number };
    } = {},
  ) {
    return this.request<{ contractId: string; canonical: string; offerId: string }>(
      `/contracts/${encodeURIComponent(contractId)}/mdop/offer`,
      { method: 'POST', body: JSON.stringify(opts) },
    );
  }

  /** MDOP 作业列表（控制台）。 */
  async listMdopJobs() {
    return this.request<Array<{ id: string; purpose?: string; status?: string }>>("/mdop/jobs");
  }

  /** Consumer 申请数字合约（draft 状态，待 provider 审批） */
  async requestContract(data: {
    dataProductId: string;
    /** 合规预审组合 ID（D-CMP-2）：必须引用本方创建的预审，否则后端拒绝。 */
    compositionId: string;
    purpose: string;
    retention: string;
    output: string;
    minCell?: number;
    outputPolicy?: {
      preset?: string;
      minCell?: number;
    };
    validDays: number;
  }) {
    return this.request<any>('/contracts/requests', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /** Provider 直接签发数字合约（active 状态） */
  async issueContract(data: {
    dataProductId: string;
    providerId: string;
    consumerId: string;
    purpose: string;
    retention: string;
    output: string;
    minCell?: number;
    outputPolicy?: {
      preset?: string;
      minCell?: number;
    };
    validDays: number;
  }) {
    return this.request<any>('/contracts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /** Provider 审批 draft 合约 → active；预审裁决为需审批时须附确认理由（D-CMP-2）。 */
  async approveContractDraft(
    contractId: string,
    preReviewAck?: { reason: string },
  ) {
    return this.request<any>(`/contracts/${contractId}/approve`, {
      method: 'POST',
      body: JSON.stringify(preReviewAck ? { preReviewAck } : {}),
    });
  }

  /** Provider 拒绝 draft 合约 */
  async rejectContractDraft(contractId: string) {
    return this.request<any>(`/contracts/${contractId}/reject`, {
      method: 'POST',
    });
  }

  /** P1-3:Provider 解除 active 合约(二次确认+原因)。 */
  async revokeContract(contractId: string, reason?: string) {
    return this.request<any>(`/contracts/${contractId}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  /** P1-7:合约完整性校验。 */
  async getContractIntegrity(contractId: string) {
    return this.request<any>(`/contracts/${contractId}/integrity`);
  }

  /** P1-9:连接器心跳聚合状态。 */
  async listConnectorStatus() {
    return this.request<
      Array<{
        id: string;
        participantId: string;
        healthStatus: string;
        lastSeen?: string;
        lastHeartbeat?: {
          version?: string;
          taskStatus?: Record<string, unknown>;
          resources?: Record<string, unknown>;
        } | null;
      }>
    >("/connectors/status");
  }

  async createContract(data: Record<string, unknown>) {
    return this.request<any>('/contracts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async orchestrateSecretFlow(body: Record<string, unknown>) {
    return this.request<any>('/secretflow/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async listSecretFlowTasks() {
    return this.request<any[]>('/secretflow/tasks');
  }

  async getSecretFlowTask(taskId: string) {
    return this.request<any>(`/secretflow/tasks/${taskId}`);
  }

  async getSecretFlowResult(taskId: string) {
    return this.request<any>(`/secretflow/tasks/${taskId}/result`);
  }

  async getSecretFlowSettlement(taskId: string) {
    return this.request<any>(`/secretflow/tasks/${taskId}/settlement`);
  }

  /** SM2-envelope encrypted LoRA adapter bundle (consumer JWT required). */
  async getLoraDeliverable(taskId: string) {
    return this.request<LoraDeliverableBundle>(
      `/secretflow/tasks/${taskId}/deliverables/lora-adapter`,
    );
  }

  async downloadLoraDeliverableFile(taskId: string): Promise<void> {
    const bundle = await this.getLoraDeliverable(taskId);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = bundle.filename ?? `lora-adapter-${taskId}.enc.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async verifyDemoLoraDeliverable(taskId: string) {
    return this.request<LoraVerifyReport>(
      `/secretflow/tasks/${taskId}/deliverables/lora-adapter/verify-demo`,
      { method: 'POST' },
    );
  }

  // SecretFlow 任务设计助手 — 自然语言 → SecretFlowTaskSpec 草稿（LLM 仅生成草稿，
  // 提交仍走 /secretflow/preview + /tasks）。
  async draftSecretFlowSpec(description: string, purpose?: string) {
    return this.request<SecretFlowDraftResponse>('/secretflow/assistant/draft', {
      method: 'POST',
      body: JSON.stringify(purpose ? { description, purpose } : { description }),
    });
  }

  // 结果解读（AGT-04）— 已发布的聚合结果（C3）→ 解读草稿。推理走平台自托管端点，
  // 入参是严格白名单（见 lib/c3-interpret-payload.ts），不要透传整份 result。
  async interpretC3Result(question: string, result: Record<string, unknown>) {
    return this.request<{
      draft: string;
      facts: string[];
      vendor: string;
      model: string;
      label: string;
      generatedAt: string;
    }>('/result-interpreter/interpret', {
      method: 'POST',
      body: JSON.stringify({ question, result }),
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

  /** 「用此预审申请合约」选择器：当前使用方创建的预审 + 最近裁决（D-CMP-2）。 */
  async listMyCompositions() {
    return this.request<
      Array<{
        id: string;
        scenarioKey: string;
        verdict: string | null;
        overallRisk: string | null;
        createdAt: string;
      }>
    >('/compositions');
  }

  async getBlockchainAttestations() {
    return this.request<ApiAttestation[]>('/blockchain/attestations');
  }
}

export interface ApiAttestation {
  id: number;
  attestation_type?: string;
  status?: string;
  data_id?: string | null;
  data_hash?: string;
  transaction_hash?: string | null;
  block_number?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface LoraDeliverableBundle {
  taskId: string;
  filename: string;
  format: string;
  algorithm: string;
  encryptedDeltaRef: string;
  loraDeltaHash: string;
  sha256: string;
  byteSize: number;
  sealedAt: string;
  encryptedData: string;
  encryptedDEK: string;
  decryptionNote?: string;
}

export type LoraVerifyStepStatus = 'ok' | 'fail' | 'skip';

export interface LoraVerifyStep {
  id: string;
  label: string;
  status: LoraVerifyStepStatus;
  detail?: string;
}

export interface LoraVerifyReport {
  ok: boolean;
  steps: LoraVerifyStep[];
  taskId?: string;
  consumerId?: string;
  demoKeyLabel?: string;
  format?: string;
  algorithm?: string;
  expectedLoraHash?: string;
  computedLoraHash?: string;
  innerLoraHash?: string;
  adapterTensorKeys?: string[];
  adapterTensorCount?: number;
  plaintextByteSize?: number;
  bundleSha256?: string;
  cliHint?: string;
  error?: string;
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

/** Provider connector inbox row (本院收到的分派). */
export interface ProviderInboxItem {
  kind: 'rws' | 'fl_prediction';
  assignmentId: string;
  taskId: string;
  title: string;
  purpose: string;
  consumerId: string;
  workloadLabel: string;
  contractId: string;
  status: string;
  error?: string;
  latestProgress?: { at: string; stage: string; detail?: string };
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  resultHint?: string;
}

export interface RwsOrchestrationRecord {
  taskId: string;
  title: string;
  purpose: string;
  analysis: RwsAnalysisSubmission;
  consumerId: string;
  contractIds: string[];
  status: 'pending' | 'running' | 'completed' | 'partial' | 'failed';
  assignments: {
    assignmentId: string;
    providerId: string;
    status: string;
    startedAt?: string;
    completedAt?: string;
    progress?: { at: string; stage: string; detail?: string }[];
    aggregate?: { cohortSize: number; buckets: { key: string; count: number }[] };
    error?: string;
    /** algorithm-sandbox:该院实际执行隔离与模块指纹(如实标注)。 */
    executionIsolation?: 'none' | 'wasm-sandbox';
    moduleSm3?: string;
    /** on-chain-provider-endorsement:该院对其结果摘要的连接器 SM2 背书。 */
    endorsement?: {
      resultSm3: string;
      certFingerprint: string;
      verified: true;
    };
    /** third-party-module-admission:该院这次跑的模块的准入层级与平台审查背书。 */
    moduleAdmission?: {
      tier: 'A' | 'B';
      review?: {
        reviewer: string;
        reviewedAt: string;
        reproducibleBuildRef: string;
        confidential: boolean;
      };
    };
  }[];
  merged?: {
    cohortSize: number;
    buckets: {
      key: string;
      count: number;
      rate: number;
      b?: number;
      c?: number;
      d?: number;
      prr?: number;
      ror?: number;
      signal?: boolean;
    }[];
    /** rws-algorithm-validation L0: per-provider collection + attestation. */
    l0Validation?: L0ValidationMerged;
    /** L2/L3 meta (DerSimonian–Laird), nested under metaPooled; merged:true 时携带效应量 + 森林图。 */
    metaPooled?: {
      merged: boolean;
      pooledEffect?: number;
      pooledOr?: number;
      pooledHr?: number;
      ci95?: [number, number];
      heterogeneity?: { q: number; df: number; tau2: number; i2Percent: number };
      forest?: { siteId: string; effect: number; ci95: [number, number]; weightPercent: number }[];
    };
  };
  /** L0 顶层存证摘要（hoisted from merged.l0Validation.attestation). */
  attestation?: { txHash: string; block: number; hash: string };
  /** rws-study-protocol-spec §1.2: protocol version (default 1, bumps on /revise). */
  protocolVersion?: number;
  /** rws-study-protocol-spec §1.6/§4.1: admission-time advisory warnings. */
  protocolWarnings?: string[];
  /** rws-study-protocol-spec Phase 3: first-dispatch freeze timestamp (ISO). */
  frozenAt?: string;
  /** rws-study-protocol-spec Phase 3: last revision reason (set by /revise). */
  revisionReason?: string;
  /** rws-study-protocol-spec Phase 3: last revision timestamp (ISO). */
  revisedAt?: string;
  createdAt: string;
  completedAt?: string;
  /** algorithm-sandbox:任务级取所有医院中最弱的一级。 */
  executionIsolation?: 'none' | 'wasm-sandbox';
}

/**
 * RWS analysis submission — discriminated by `type`.
 * - L1.5–L4 analyses carry `drug?` etc. (existing behavior).
 * - L0 (`algorithm-validation`) carries the operational definition +
 *   target variable + gold-standard set version.
 *
 * The L0 `algorithm.expression` is opaque on the control plane: the
 * connector grammar-validates the closed-grammar AST (CTL-10). The UI
 * accepts any JSON object here; structural errors surface as a 400 from
 * the backend.
 */
export interface RwsAnalysisSubmission {
  type: string;
  drug?: string;
  /** L0 algorithm-validation payload. */
  algorithm?: { id: string; version: string; expression: unknown };
  variableDefinitionId?: string;
  goldStandardSetVersion?: string;
  allowedArtifacts?: string[];
  // rws-study-protocol-spec Phase 2/3 fields (all optional on the wire; the
  // backend validator enforces presence by analysis type/level).
  level?: string;
  outcome?: string;
  method?: string;
  tte?: {
    exposureArm: string;
    comparatorArm: string;
    timeZeroRule: string;
    inclusion: string[];
    exclusion: string[];
    outcome: { type: string; event: string; censoring?: string };
    graceDays?: number;
    washoutDays?: number;
    matchingCovariates?: string[];
  };
  designType?: RwsDesignType;
  rationale?: string;
  sap?: SapPlan;
  missingness?: MissingnessDeclaration;
  sensitivityAnalyses?: SensitivityAnalysisDeclaration[];
  outcomeAlgorithm?: { id: string; version: string; expression: unknown };
  exposureAlgorithm?: { id: string; version: string; expression: unknown };
  comparatorAlgorithm?: { id: string; version: string; expression: unknown };
}

/** rws-study-protocol-spec §2.5 — design type closed set (EVIDENCE.md §4). */
export type RwsDesignType =
  | 'cross-sectional'
  | 'cohort'
  | 'case-control'
  | 'nested-case-control'
  | 'case-cohort'
  | 'case-crossover';

export const RWS_DESIGN_TYPES: readonly RwsDesignType[] = [
  'cross-sectional',
  'cohort',
  'case-control',
  'nested-case-control',
  'case-cohort',
  'case-crossover',
];

/** rws-study-protocol-spec §3.1/§3.2 SAP. */
export interface SapPlan {
  significanceLevel: number;
  power?: number;
  sampleSizeAssumption?: number;
  sampleSizeJustification?: string;
  multiplicityAlphaAdjustment?: string;
}

/** rws-study-protocol-spec §3.4 missingness (mechanism + strategy paired). */
export interface MissingnessDeclaration {
  mechanism: 'MCAR' | 'MAR' | 'MNAR';
  imputationStrategy: string;
}

/** rws-study-protocol-spec §3.5 sensitivity-analysis declaration. */
export interface SensitivityAnalysisDeclaration {
  id: string;
  description: string;
}

/** L0 2×2 confusion matrix (TP/FP/TN/FN). Distinct from L1.5's {a,b,c,d}. */
export interface L0ConfusionMatrix {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

export interface L0MetricWithCi {
  point: number;
  ci95: [number, number];
}

export interface L0ValidationMetrics {
  sensitivity: L0MetricWithCi;
  specificity: L0MetricWithCi;
  ppv: L0MetricWithCi;
  npv: L0MetricWithCi;
}

/**
 * Per-provider L0 result. When `suppressed` is true, `metrics` is absent
 * — structurally distinct from "the algorithm performed poorly" (D3).
 * `goldStandardProvenance === 'synthetic'` flags results that MUST NOT
 * be used for regulatory submission (§7.3).
 */
export interface L0ValidationResult {
  algorithmId: string;
  algorithmVersion: string;
  providerId: string;
  variableDefinitionId: string;
  goldStandardSetVersion: string;
  confusionMatrix: L0ConfusionMatrix;
  metrics?: L0ValidationMetrics;
  suppressed: boolean;
  suppressionReason?: string;
  attestationLevel: string;
  goldStandardProvenance?: 'real' | 'synthetic';
}

export interface L0ValidationMerged {
  merged: boolean;
  kind: 'l0_validation';
  results: L0ValidationResult[];
  resultHash: string;
  attestation: { txHash: string; block: number; hash: string };
}

/** P0-11 运营方用户管理视图. */
export interface AdminUser {
  id: number;
  email: string;
  name?: string;
  participantId?: string;
  participantRole?: 'provider' | 'consumer' | 'operator' | 'compliance' | 'admin' | null;
  status?: 'active' | 'disabled' | 'pending';
  emailVerified?: boolean;
  lastLoginAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** P1-3/P1-5 机构认证申请(用户中心「账号与身份」). */
export interface CertificationApplication {
  id?: string;
  userId?: number;
  status?: 'draft' | 'submitted' | 'approved' | 'rejected';
  orgType?: string;
  licenseImages?: string[];
  orgName?: string;
  uscc?: string;
  validPeriod?: 'long-term' | 'custom';
  validUntil?: string;
  region?: string;
  address?: string;
  businessScope?: string;
  orgIntro?: string;
  industry?: string;
  capitalWanYuan?: number;
  regDate?: string;
  logoKey?: string;
  caIdentityName?: string;
  caPublicKey?: string;
  caCertFingerprint?: string;
  source?: 'manual' | 'silk-road';
  interopSubjectId?: string;
  reviewerId?: number;
  reviewNote?: string;
  reviewedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FlPredictionOrchestrationRecord {
  taskId: string;
  title: string;
  purpose: string;
  flPredictionSpec: {
    modelType: string;
    targetColumn: string;
    aggregation: string;
    rounds: number;
    modality: string;
  };
  consumerId: string;
  contractIds: string[];
  computeTaskId?: number;
  status: 'pending' | 'running' | 'completed' | 'partial' | 'failed';
  assignments: {
    assignmentId: string;
    providerId: string;
    status: string;
    startedAt?: string;
    completedAt?: string;
    progress?: { at: string; stage: string; detail?: string }[];
    partyResult?: {
      sampleCount: number;
      trainingMode?: 'sklearn' | 'mock' | 'local-logistic';
      localMetrics?: { auc?: number; f1?: number; precision?: number; recall?: number };
      localModelHash?: string;
    };
    error?: string;
  }[];
  merged?: Record<string, unknown>;
  resultSummary?: {
    auc?: number;
    f1?: number;
    modelHash?: string;
    roundsCompleted?: number;
  };
  createdAt: string;
  completedAt?: string;
}

export const api = new ApiClient();

// Import types
import type { User, Tenant, DataAsset, AccessRequest, LoginCredentials, RegisterData, AuthResponse, ComputeTask } from '@/types';
import type { CapabilityLayer, CapabilityObject, Composition, ComplianceEvaluation } from '@/types/capability.types';
