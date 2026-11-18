// MedTrust API 客户端

import { classifyRefreshStatus, type RefreshOutcome } from '@/lib/session-errors';
import type { AttestationLedgerRecord } from '@/lib/attestations';
import { SPACE_COOKIE, SPACE_HEADER, clearSpaceCookie, readCookie } from '@/lib/space-context';

// 生产构建为同源相对路径 /api/v1（nginx 在服务器本机转给 API）；本地开发直连 :5021。
/**
 * 站内信（D-NOTIF-1）。收件人是**参与方**（机构待办），已读按参与方记。
 * `details.waitSeconds` 在审批类通知里带"申请创建 → 签发"的秒数（Phase 4 的 <24h 口径）。
 */
export interface NotificationItem {
  id: string;
  recipientParticipantId: string;
  type: string;
  title: string;
  body?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  actorParticipantId?: string | null;
  status: 'unread' | 'read';
  createdAt: string;
  readAt?: string | null;
  details?: Record<string, unknown> | null;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021/api/v1';

const TOKEN_KEY = 'medtrust_token';
import { isTokenExpiringSoon } from '@/lib/token';

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

  /**
   * 聊天链路专用：确保 access token 未过期（15m TTL）。
   *
   * chat-agent 是独立服务，不经过本客户端的「401 → refresh → 重试」；发消息前用它续签一次。
   * 续签失败时返回原 token（让服务端如实 401，而不是让前端假装成功）。
   */
  async ensureFreshToken(): Promise<string | null> {
    const token = this.getToken();
    if (!token || !isTokenExpiringSoon(token)) return token;
    const outcome = await this.refreshSession();
    return outcome === 'refreshed' ? this.getToken() : token;
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

  /**
   * 发一次请求。`withSpace` 为 false 时不带 `X-Space-Id`（用于空间上下文被拒后的重放）。
   * 返回本次实际带的 spaceId，供调用方判断"这次拒绝是不是空间上下文引起的"。
   */
  private async send(
    endpoint: string,
    options: RequestInit,
    withSpace: boolean,
  ): Promise<{ response: Response; spaceId: string | null }> {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    // P9：请求级空间上下文（cookie 携带，与 SSR 同源；后端 SpaceGuard 校验归属）。
    let spaceId: string | null = null;
    if (withSpace && typeof document !== 'undefined' && !headers[SPACE_HEADER]) {
      spaceId = readCookie(SPACE_COOKIE);
      if (spaceId) headers[SPACE_HEADER] = spaceId;
    }

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, { ...options, headers });
    return { response, spaceId };
  }

  private async toError(response: Response): Promise<Error & { status: number }> {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    const err = new Error(error.message || `HTTP ${response.status}`) as Error & { status: number };
    err.status = response.status;
    return err;
  }

  private async rawRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const first = await this.send(endpoint, options, true);

    // 空间 cookie 与本人成员关系不符时，后端 SpaceGuard 回 403「无权访问该空间」。
    // 那是**空间上下文**的问题，不是会话失效——早先这种情况被当成 403 会话拒绝，
    // 于是清掉有效会话弹回 /login?expired=1，而坏 cookie 还在，用户登不回来（死循环）。
    // 这里去掉空间头重放一次：成功说明会话是好的，顺手清掉过期 cookie（下次不再带）。
    if (first.response.status === 403 && first.spaceId) {
      const retry = await this.send(endpoint, options, false);
      if (retry.response.ok) {
        clearSpaceCookie();
        return retry.response.json();
      }
      throw await this.toError(retry.response);
    }

    if (!first.response.ok) {
      throw await this.toError(first.response);
    }

    return first.response.json();
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
  /** P2-5：切换空间并换发访问令牌。 */
  async switchSpace(spaceId: string) {
    return this.request<{ spaces: string[]; spaceId: string; access_token: string }>(
      '/auth/switch-space',
      { method: 'POST', body: JSON.stringify({ spaceId }) },
    );
  }

  /** P7.2：空间主题（级联解析后的结果）。 */
  async getSpaceTheme(spaceId: string) {
    return this.request<Record<string, unknown>>(
      '/spaces/' + encodeURIComponent(spaceId) + '/theme',
    );
  }

  /** P9.2：当前登录用户所属空间与生效空间（切换器数据源）。 */
  async getMySpaces() {
    return this.request<{
      spaces: string[];
      spaceId: string;
      userId: number;
      memberships?: Array<{ spaceId: string; role: string }>;
    }>('/auth/spaces');
  }

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
      /** 本人所属空间与当前默认空间：用于把 cookie 与成员关系对账（见 reconcileSpaceId）。 */
      spaces?: string[];
      spaceId?: string | null;
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
  /** @deprecated Use listCatalogProducts / getCatalogProduct. */
  async getDataAssets(type?: "data" | "service") {
    return this.listCatalogProducts(type);
  }

  /** @deprecated Use createCatalogProduct. */
  async createDataAsset(data: Partial<DataAsset> | CatalogProductInput) {
    return this.createCatalogProduct(data as CatalogProductInput);
  }

  async listCatalogProducts(type?: "data" | "service") {
    const q = type ? `?type=${type}` : "";
    return this.request<CatalogProduct[]>(`/catalog${q}`);
  }

  async getCatalogProduct(id: string) {
    return this.request<CatalogProduct>(`/catalog/${encodeURIComponent(id)}`);
  }

  async createCatalogProduct(data: CatalogProductInput) {
    return this.request<CatalogProduct>("/catalog", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateCatalogProduct(id: string, data: CatalogProductUpdateInput) {
    return this.request<CatalogProduct>(`/catalog/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async archiveCatalogProduct(id: string) {
    return this.request<CatalogProduct>(
      `/catalog/${encodeURIComponent(id)}/archive`,
      { method: "POST" },
    );
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
    return this.request<ContractListItem[]>('/contracts');
  }

  // ── 产品级访问授权（D-ACL-1）：能不能碰这份数据产品 ──────────────────────
  async listAccessGrants(
    params: {
      dataProductId?: string;
      granteeParticipantId?: string;
      status?: 'active' | 'revoked';
    } = {},
  ) {
    const q = new URLSearchParams();
    if (params.dataProductId) q.set('dataProductId', params.dataProductId);
    if (params.granteeParticipantId)
      q.set('granteeParticipantId', params.granteeParticipantId);
    if (params.status) q.set('status', params.status);
    const qs = q.toString();
    return this.request<AccessGrantRow[]>(`/data-access/grants${qs ? `?${qs}` : ''}`);
  }

  async grantAccess(dto: {
    dataProductId: string;
    granteeParticipantId: string;
    permissions?: AccessPermission[];
    purpose?: string;
    expiresAt?: string;
    note?: string;
  }) {
    return this.request<AccessGrantRow>('/data-access/grants', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }

  /** 回收访问权：必须给原因（追加式留痕，不删行）。 */
  async revokeAccess(grantId: string, reason: string) {
    return this.request<AccessGrantRow>(
      `/data-access/grants/${encodeURIComponent(grantId)}/revoke`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
  }

  // ── 访问申请（使用方发起 → 提供方批准；D-ACL-1 补） ──────────────────
  async listDataAccessRequests(status?: "pending" | "approved" | "rejected" | "withdrawn") {
    return this.request<AccessRequestRow[]>(
      `/data-access/requests${status ? `?status=${status}` : ''}`,
    );
  }

  async requestDataAccess(dto: {
    dataProductId: string;
    permissions?: AccessPermission[];
    purpose?: string;
    note?: string;
  }) {
    return this.request<AccessRequestRow>('/data-access/requests', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }

  /** 批准申请：服务端落授权行（含审计）。到期日可选。 */
  async approveDataAccessRequest(id: string, opts: { note?: string; expiresAt?: string } = {}) {
    return this.request<{ request: AccessRequestRow; grant: AccessGrantRow }>(
      `/data-access/requests/${encodeURIComponent(id)}/approve`,
      { method: 'POST', body: JSON.stringify(opts) },
    );
  }

  async rejectDataAccessRequest(id: string, reason: string) {
    return this.request<AccessRequestRow>(
      `/data-access/requests/${encodeURIComponent(id)}/reject`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
  }

  async withdrawDataAccessRequest(id: string) {
    return this.request<AccessRequestRow>(
      `/data-access/requests/${encodeURIComponent(id)}/withdraw`,
      { method: 'POST', body: JSON.stringify({}) },
    );
  }

  /** 公开机构大厅（授权选择器与机构名解析用；只含元数据）。 */
  async listInstitutions() {
    return this.request<{ items: InstitutionRow[]; total: number }>('/public/institutions');
  }

  // ── 站内信（D-NOTIF-1）：机构待办的收件箱 ────────────────────────────────
  /** 我的通知（默认全部；status=unread 只看未读）。 */
  /** SSE 通知流：用 fetch 读取，才能带 Authorization；EventSource 不支持自定义头。 */
  async openNotificationStream(signal: AbortSignal): Promise<Response> {
    const { response } = await this.send(
      '/notifications/stream',
      { signal, headers: { Accept: 'text/event-stream' } },
      true,
    );
    return response;
  }

  async listNotifications(params: { status?: 'unread' | 'read'; limit?: number } = {}) {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.limit) q.set('limit', String(params.limit));
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return this.request<NotificationItem[]>(`/notifications${suffix}`);
  }

  async getUnreadNotificationCount() {
    return this.request<{ unread: number }>('/notifications/unread-count');
  }

  async markNotificationRead(id: string) {
    return this.request<NotificationItem>(`/notifications/${encodeURIComponent(id)}/read`, {
      method: 'POST',
    });
  }

  async markAllNotificationsRead() {
    return this.request<{ updated: number }>('/notifications/read-all', { method: 'POST' });
  }

  // ── MDOP 作业（mdop-kernel §9）────────────────────────────────────────────

  /** 提交 L1.5 失衡检测的 MDOP 作业（计划模板 rws.l15.disproportionality）。 */
  async submitMdopL15(data: {
    purpose: string;
    applicant: { org: string; project: string };
    contracts: string[];
    drug: string;
    designType:
      | 'cross-sectional'
      | 'cohort'
      | 'case-control'
      | 'nested-case-control'
      | 'case-cohort'
      | 'case-crossover';
    rationale: string;
    sap?: {
      significanceLevel?: number;
      power?: number;
      sampleSizeAssumption?: number;
      sampleSizeJustification?: string;
      multiplicityAlphaAdjustment?: string;
    };
    cohortDefinition?: { inclusion?: string[]; exclusion?: string[] };
    missingnessDeclaration?: {
      mechanism: 'MCAR' | 'MAR' | 'MNAR';
      imputationStrategy: string;
    };
    temporalWindow?: {
      maxDaysAfterStart?: number;
      allowSameDay?: boolean;
      requireTemporalOrder?: boolean;
    };
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

  /** 批次 2：队列规模（年龄带）走 MDOP 通道。 */
  async submitMdopCohortCount(data: {
    purpose: string;
    applicant: { org: string; project: string };
    contracts: string[];
    holders: Array<{ participantId: string; dataProductId: string }>;
    strataKeys?: string[];
    drug?: string;
    minCell?: number;
    ethicsRef?: string;
    notBefore: string;
    notAfter: string;
  }) {
    return this.request<{ jobId: string; status: string; template: string }>('/mdop/jobs/cohort-count', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /** 批次 2：慢病标签现患走 MDOP 通道（分类键可省，包侧有默认词典）。 */
  async submitMdopConditionPrevalence(data: {
    purpose: string;
    applicant: { org: string; project: string };
    contracts: string[];
    holders: Array<{ participantId: string; dataProductId: string }>;
    categoryKeys?: string[];
    drug?: string;
    minCell?: number;
    ethicsRef?: string;
    notBefore: string;
    notAfter: string;
  }) {
    return this.request<{ jobId: string; status: string; template: string }>(
      '/mdop/jobs/condition-prevalence',
      { method: 'POST', body: JSON.stringify(data) },
    );
  }

  /** 批次 2：不良反应信号走 MDOP 通道（分类键可省，包侧有默认器官系统词典）。 */
  async submitMdopAeSignal(data: {
    purpose: string;
    applicant: { org: string; project: string };
    contracts: string[];
    holders: Array<{ participantId: string; dataProductId: string }>;
    categoryKeys?: string[];
    drug?: string;
    minCell?: number;
    ethicsRef?: string;
    notBefore: string;
    notAfter: string;
  }) {
    return this.request<{ jobId: string; status: string; template: string }>('/mdop/jobs/ae-signal', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /** L2 比较效果走 MDOP 通道：站内定点效应量，平台做随机效应合并。 */
  async submitMdopComparativeEffect(data: {
    purpose: string;
    applicant: { org: string; project: string };
    contracts: string[];
    holders: Array<{ participantId: string; dataProductId: string }>;
    drug: string;
    outcome: string;
    outcomeKind?: 'adverse_event' | 'condition';
    stratifyBy?: Array<'ageBand' | 'sex'>;
    minCell?: number;
    ethicsRef?: string;
    notBefore: string;
    notAfter: string;
  }) {
    return this.request<{ jobId: string; status: string; template: string }>(
      '/mdop/jobs/comparative-effect',
      { method: 'POST', body: JSON.stringify(data) },
    );
  }

  /** L3 倾向评分走 MDOP：站内配对或加权，出域只有效应量和标准误。 */
  async submitMdopCausalPsm(data: {
    purpose: string;
    applicant: { org: string; project: string };
    contracts: string[];
    holders: Array<{ participantId: string; dataProductId: string }>;
    drug: string;
    comparator: string;
    outcome: string;
    outcomeKind?: 'adverse_event' | 'condition';
    method?: 'psm' | 'iptw';
    stratifyBy?: Array<'ageBand' | 'sex'>;
    minCell?: number;
    /** D-RWS-10：请求方显式声明；MDOP 通道只接受 'within-stratum'，其他值后端 400。 */
    matchingStrategy: 'within-stratum' | 'cross-stratum-nearest';
    ethicsRef?: string;
    notBefore: string;
    notAfter: string;
  }) {
    return this.request<{ jobId: string; status: string; template: string }>(
      '/mdop/jobs/causal-psm',
      { method: 'POST', body: JSON.stringify(data) },
    );
  }

  /** L3 生存分析走 MDOP：站内 Cox 与分箱曲线，出域是 log HR、标准误和过阈值的箱。 */
  async submitMdopCausalSurvival(data: {
    purpose: string;
    applicant: { org: string; project: string };
    contracts: string[];
    holders: Array<{ participantId: string; dataProductId: string }>;
    drug: string;
    comparator: string;
    outcome: string;
    outcomeKind?: 'adverse_event' | 'condition';
    binWidthDays?: number;
    minCell?: number;
    /** D-RWS-10：请求方显式声明；MDOP 通道只接受 'within-stratum'，其他值后端 400。 */
    matchingStrategy: 'within-stratum' | 'cross-stratum-nearest';
    ethicsRef?: string;
    notBefore: string;
    notAfter: string;
  }) {
    return this.request<{ jobId: string; status: string; template: string }>(
      '/mdop/jobs/causal-survival',
      { method: 'POST', body: JSON.stringify(data) },
    );
  }

  /** L0 算法校验走 MDOP：站内 AUC、校准箱和决策曲线，平台只合并 AUC。 */
  async submitMdopAlgorithmValidation(data: {
    purpose: string;
    applicant: { org: string; project: string };
    contracts: string[];
    holders: Array<{ participantId: string; dataProductId: string }>;
    scoreField?: string;
    labelField?: string;
    minCell?: number;
    ethicsRef?: string;
    notBefore: string;
    notAfter: string;
  }) {
    return this.request<{ jobId: string; status: string; template: string }>(
      '/mdop/jobs/algorithm-validation',
      { method: 'POST', body: JSON.stringify(data) },
    );
  }

  /** 通用作业入口：载荷就是编辑器里的那份逻辑计划，另加台账归属键。 */
  async submitMdopJob(data: Record<string, unknown>) {
    return this.request<{ jobId: string; status: string }>('/mdop/jobs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * 编译作业并发起片段要约（FLOW-MDOP-01 第二步）。
   * SUBMITTED → 编译写阶段/plan_hash；成功后同请求内自动 offerTickets。
   */
  async compileMdopJob(jobId: string) {
    return this.request<{
      jobId: string;
      status: string;
      planHash: string;
      fragments: Array<{ node: string; stages: number; edges: number }>;
      ticketId?: string;
      offeredNodes?: string[];
    }>(`/mdop/jobs/${encodeURIComponent(jobId)}/compile`, { method: 'POST' });
  }

  /** 模板向导：只展开计划，不创建作业。 */
  async previewMdopPlan(template: string, input: unknown) {
    return this.request<Record<string, unknown>>('/mdop/plans/preview', {
      method: 'POST',
      body: JSON.stringify({ template, input }),
    });
  }

  /** 提交 L4 联邦预测的 MDOP 作业（计划模板 rws.l4.fl-prediction）。 */
  async submitMdopFlPrediction(data: {
    purpose: string;
    applicant: { org: string; project: string };
    contracts: string[];
    hospitals: Array<{ participantId: string; dataProductId: string }>;
    spec: Record<string, unknown>;
    minCell?: number;
    notBefore: string;
    notAfter: string;
  }) {
    return this.request<{ jobId: string; status: string; template: string }>(
      '/mdop/jobs/fl-prediction',
      { method: 'POST', body: JSON.stringify(data) },
    );
  }

  /** 提交注册型单臂试验外部对照（研究 profile、SAP 与 ContractBundle 冻结）。 */
  async submitMdopExternalControlRegistration(data: {
    purpose: string;
    applicant: { org: string; project: string };
    study: {
      studyId: string;
      product: string;
      indication: string;
      design: 'single-arm-with-external-control';
      objective: 'superiority';
      evidenceRole: 'primary' | 'supportive' | 'exploratory';
      estimand: 'ATT';
      estimator: 'IPTW-ATT';
      timeZero: string;
      outcome: string;
      profileVersion: string;
      protocolVersion: string;
      sapVersion: string;
      synthetic: boolean;
      p0DecisionsFrozen: boolean;
    };
    trial: { participantId: string; dataProductId: string; contractId: string };
    controls: Array<{
      participantId: string;
      dataProductId: string;
      contractId: string;
    }>;
    covariates: string[];
    missingness: 'MCAR' | 'MAR' | 'MNAR';
    effectMeasure: 'risk-ratio' | 'risk-difference';
    truthRr?: number;
    contractBundle: { id: string; version: string; minCell: number };
    teeNode: string;
    minCell?: number;
    ethicsRef?: string;
    notBefore: string;
    notAfter: string;
  }) {
    return this.request<{
      jobId: string;
      status: string;
      template: string;
      stages: number;
    }>('/mdop/jobs/external-control-registration', {
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
        contractBundleId?: string | null;
        contractBundleVersion?: string | null;
        contracts?: string[];
        contractBindings?: Array<{
          contractId: string;
          participantId: string;
          dataProductId: string;
          role: string;
          stages: string[];
        }> | null;
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
        /** L4 联邦预测（FlRunResult）：没有 analysisType/buckets，按下面这组字段渲染。 */
        modelType?: string;
        modelHash?: string;
        roundsCompleted?: number;
        totalRounds?: number;
        aggregateMetrics?: Record<string, number | undefined>;
        partyContributions?: Array<{
          participantId: string;
          sampleCount: number;
          roundsParticipated: number;
          localMetrics?: Record<string, number | undefined>;
          localModelHash?: string;
          modelParams?: Record<string, unknown>;
        }>;
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
    return this.request<
      Array<{
        id: string;
        purpose?: string;
        status?: string;
        createdAt?: string;
        rejectReason?: string | null;
        applicant?: { org?: string; project?: string } | null;
        contracts?: string[] | null;
        logicalPlan?: {
          stages?: Array<{
            op?: string;
            params?: { uri?: string };
            inputs?: Array<{ from?: string }>;
          }>;
        } | null;
      }>
    >("/mdop/jobs");
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

  /** 使用方确认规则知悉（P0-7）。医院签发前必须先有这条记录。 */
  async acknowledgeContract(contractId: string) {
    return this.request<any>(`/contracts/${contractId}/acknowledge`, {
      method: 'POST',
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

  /** 申请方撤回待审批申请（撤回 ≠ 驳回：不是医院的审批结论）。 */
  async withdrawContractDraft(contractId: string, reason?: string) {
    return this.request<any>(`/contracts/${contractId}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
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

  /** 运营方：连接器入网申请。 */
  async listConnectorEnrollments(status = "") {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request<
      Array<{
        id: string;
        connectorId: string;
        participantId: string;
        subjectPublicKey: string;
        status: "pending" | "approved" | "rejected";
        fingerprint?: string | null;
        rejectReason?: string | null;
        createdAt: string;
      }>
    >(`/connectors/enrollments${q}`);
  }

  async approveConnectorEnrollment(id: string) {
    return this.request(`/connectors/enrollments/${id}/approve`, { method: "POST" });
  }

  async rejectConnectorEnrollment(id: string, reason: string) {
    return this.request(`/connectors/enrollments/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  async listRegisteredConnectors() {
    return this.request<
      Array<{ connectorId: string; participantId: string; sm2Fingerprint: string; revoked: boolean }>
    >("/connectors");
  }

  async deregisterConnector(connectorId: string) {
    return this.request(`/connectors/${encodeURIComponent(connectorId)}`, { method: "DELETE" });
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

  /**
   * 存证账本：真实上链的存证指针（类别 / 哈希 / 交易号 / 区块 / 时间）。
   * 服务端按角色控权——运营 / 合规见全部，提供方 / 使用方只见自己参与的对象。
   */
  async listAttestations() {
    return this.request<AttestationLedgerRecord[]>('/attestations');
  }
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

/** 控制面目录产品（仅元数据；行级数据在连接器本地）。 */
/**
 * 合约列表项（`GET /contracts`）。字段与后端 `ContractListItem` 对齐：
 * 有效状态 + 审批/知悉能力 + 签署进展 + 参与方登记名与产品标题（缺失为 null）。
 */
export interface ContractListItem {
  id: string;
  dataProductId: string;
  providerId: string;
  consumerId: string;
  purpose: string;
  retention: string;
  output: string;
  outputPolicy?: { preset?: string; minCell?: number; allowedArtifacts?: string[] } | null;
  pinnedModules?: Record<string, unknown> | null;
  validUntil?: string;
  status?: "draft" | "active" | "expired" | "revoked" | "approved";
  effectiveStatus?: "draft" | "active" | "expired" | "revoked" | "approved";
  canApprove?: boolean;
  canAcknowledge?: boolean;
  consumerAcknowledgedAt?: string | null;
  holderSigned?: boolean;
  mdopStatus?: string | null;
  hash?: string | null;
  attestationTxHash?: string | null;
  preReview?: {
    verdict?: string;
    overallRisk?: string;
    evaluatedAt?: string;
  } | null;
  requestedBy?: {
    userId?: number | string | null;
    name?: string | null;
    email?: string | null;
    at?: string;
  } | null;
  decision?: {
    outcome?: "approved" | "rejected" | "withdrawn";
    at?: string;
    by?: { name?: string | null; email?: string | null } | null;
    note?: string | null;
  } | null;
  revocation?: {
    at?: string;
    reason?: string;
    by?: { name?: string | null; email?: string | null } | null;
  } | null;
  /** 参与方登记显示名（`cp_participant.org`）；未登记为 null。 */
  consumerDisplayName?: string | null;
  providerDisplayName?: string | null;
  /** 数据产品标题；查不到为 null，界面回退 dataProductId。 */
  dataProductTitle?: string | null;
  createdAt?: string;
}

export interface CatalogProduct {
  id: string;
  urn?: string;
  homeSpace?: string;
  providerId: string;
  /** 控制面附带的提供方登记显示名；不可解析时省略（界面回退演示名表再回退 id）。 */
  providerDisplayName?: string;
  title: string;
  productType?: "data" | "service";
  classification?: string;
  classificationTag?: {
    level: string;
    categoryCode: string;
    version?: string;
  } | null;
  status?: "active" | "archived" | "draft";
  rightsConfirmed: boolean;
  recordCount: number;
  fhirSchema?: Record<string, unknown> | null;
  productRoles?: string[] | null;
  coverage?: Record<string, unknown> | null;
  listingScope?: "internal" | "regional";
  listingConsent?: {
    grantedBy: string;
    grantedAt: string;
    basis: string;
    signature?: string;
  } | null;
  serviceSpec?: {
    statistic: string;
    minSample: number;
    inputSchema?: unknown;
    outputSchema?: unknown;
    gate?: { minCell?: number; minCellRare?: number };
    allowedPurposes?: string[];
  } | null;
  serviceCapacity?: number | null;
  provenance?: {
    participantCountBand?: string;
    namedParties?: string[];
  } | null;
  createdAt?: string;
  updatedAt?: string | null;
}

export type CatalogProductInput = {
  providerId: string;
  title: string;
  productType?: "data" | "service";
  classification?: string;
  classificationTag?: CatalogProduct["classificationTag"];
  rightsConfirmed: boolean;
  recordCount?: number;
  fhirSchema?: Record<string, unknown> | null;
  productRoles?: string[];
  listingScope?: "internal" | "regional";
  listingConsent?: CatalogProduct["listingConsent"];
  serviceSpec?: CatalogProduct["serviceSpec"];
  serviceCapacity?: number | null;
  provenance?: CatalogProduct["provenance"];
};

export type CatalogProductUpdateInput = Partial<
  Omit<CatalogProductInput, "providerId" | "rightsConfirmed">
> & {
  rightsConfirmed?: boolean;
};

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
  /** D-RWS-10 / P-EVD-11 — L3 因果匹配策略封闭枚举（L3 必填、非 L3 给了即拒；
   * 声明值与通道实际配对行为的一致性由后端按迁移台账 fail-closed 校验）。 */
  matchingStrategy?: 'within-stratum' | 'cross-stratum-nearest';
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
import type { AccessGrantRow, AccessPermission, AccessRequestRow, InstitutionRow } from '@/lib/data-access';
