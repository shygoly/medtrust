import { traceparentHeader, withSpan } from '../../observability/tracing';
import type { SpaceDirectory } from '../directory';
import type { ScenarioSubmission } from '../scenarios';

export interface ApiCallContext {
  userId: string;
  spaceId: string;
  token?: string;
}

export interface SubmitJobResult {
  jobId: string;
  status: string;
  template?: string;
  stages?: number;
  plan?: unknown;
}

export interface RegistrationJobSnapshot {
  jobId: string;
  status: string;
  template?: string;
  analysisKey?: string;
  planHash?: string | null;
  createdAt?: string;
  result?: unknown;
  chains?: unknown[];
}

export interface RegistrationReportBuildResult {
  jobId: string;
  reportFingerprint: string;
  syntheticOnly: boolean;
  files: {
    json: string;
    markdown: string;
    html: string;
    docx: string;
    evidenceZip: string;
  };
}

export const MEDTRUST_API_CLIENT = 'MEDTRUST_API_CLIENT';

export interface MedTrustApiClient {
  /**
   * 读目录（**元数据**）。
   *
   * R2 合规点：这里 MUST NOT 借用调用者 token —— 目录读取只走 agent 自己的凭证
   * （`CHAT_AGENT_SERVICE_TOKEN`；未配置时读的是公开目录端点 `/public/catalog`）。
   * 作业提交（`submitScenario`）才带调用者授权：那是"用户的动作"，不是 agent 替用户取数。
   */
  listDirectory(spaceId: string): Promise<SpaceDirectory>;
  submitScenario(submission: ScenarioSubmission, ctx: ApiCallContext): Promise<SubmitJobResult>;
  /**
   * 本人所属空间与角色（`GET /auth/spaces`）。
   *
   * **用调用者 token**：问的是"**你**是谁、属于哪些空间"——借用 agent 自有凭证去问
   * 会把授权主体搞错（返回的是 agent 的身份，不是用户的）。R2 讲的是"不替用户取数"，
   * 不是"不用用户身份"。
   */
  listMySpaces(token: string): Promise<MySpacesResult>;
  /** 本人可见的合约（`GET /contracts`，控制面按调用者 role/participant 过滤）。 */
  listContracts(token: string): Promise<ContractSummary[]>;
  /**
   * 本人（数据使用方）创建的合规预审组合（`GET /compositions`）。
   *
   * 合约申请必须引用一份属于本方的预审（控制面 D-CMP-2 强制），所以"能不能发起合约申请"
   * 的第一个真实条件就是"有没有预审"——这也是 agent 不替用户编一个 compositionId 的原因。
   */
  listCompositions(token: string): Promise<CompositionSummary[]>;
  /** 发起数字合约申请（`POST /contracts/requests`，控制面要求调用者角色 consumer）。 */
  requestContract(input: ContractRequestInput, ctx: ApiCallContext): Promise<ContractRequestResult>;
  /**
   * 按提供方预授权自动推进合约（`POST /contracts/:id/auto-offer`，D-MDOP-9）。
   *
   * **不是代签**：平台只把申请定稿并发出要约；签名仍由提供方连接器按院内本地策略决定。
   * 提供方未预授权 / 预审裁决为「需审批」时控制面会 4xx 拒绝——调用方按"走人工"处理。
   */
  autoOfferContract(contractId: string, ctx: ApiCallContext): Promise<AutoOfferResult>;
  /**
   * 产品级访问授权判定（`GET /data-access/check`，D-ACL-1）。
   *
   * **用调用者 token**：问的是"**你**能不能访问这个数据产品"。缺省由控制面按 JWT 里的
   * participantId 判定（agent 不需要自己知道用户属于哪个参与方——知道反而会猜错）。
   */
  checkDataProductAccess(
    input: DataAccessCheckInput,
    ctx: ApiCallContext,
  ): Promise<DataAccessCheckResult>;
  /** 作业详情只投影报告所需字段；原始作业/片段数据不进入助手上下文。 */
  getRegistrationJob(
    jobId: string,
    ctx: ApiCallContext,
  ): Promise<RegistrationJobSnapshot>;
  /** 以作业证据为输入构建确定性报告；不接受助手自由生成的数字。 */
  buildRegistrationReport(
    jobId: string,
    reportInput: Record<string, unknown> | undefined,
    ctx: ApiCallContext,
  ): Promise<RegistrationReportBuildResult>;
  /** 交付链接由控制面生成，卡片只展示服务端返回的地址。 */
  registrationReportDownloadUrl(
    jobId: string,
    format: 'json' | 'markdown' | 'html' | 'docx' | 'evidence-zip',
  ): string;
  /**
   * 写一条平台审计日志（`POST /audit`，控制面按调用者 JWT 归属租户与用户）。
   *
   * **用调用者 token**：审计条目必须落在**用户**名下（"谁的动作"是审计的全部意义），
   * 借 agent 自有凭证写进去就是把归属搞错。
   */
  recordAudit(entry: AuditEntryInput, ctx: ApiCallContext): Promise<void>;
}

/**
 * 平台审计条目的入参（对齐控制面 `CreateAuditLogDto`）。
 *
 * `action` 用控制面 `AuditAction` 的取值：AI 代用户提交作业 → `COMPUTE`；
 * 合约申请 → `CREATE`；被闸拦下/前置检查 → `READ`（该动作没有发生，只有"查阅与判定"）。
 * `resource` 沿用控制面的资源类型口径（`rws-task` / `contract` / `compliance-gate`），
 * 这样"按资源统计合约操作"能把 AI 这条路径一起统计进来（另立 `ai-chat-*` 会让统计漏掉它）。
 * AI 这个来源记在 `details.source = 'ai-chat-agent'`。
 */
export interface AuditEntryInput {
  action: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'APPROVE' | 'REJECT' | 'COMPUTE' | 'DOWNLOAD';
  resource: string;
  resourceId?: number;
  details?: Record<string, unknown>;
}

/** 合规预审组合摘要（`GET /compositions` 的逐行形状）。 */
export interface CompositionSummary {
  id: string;
  scenarioKey?: string;
  /** 最近一次 L2 裁决：pass / review / block（未评估时为 null） */
  verdict?: string | null;
  overallRisk?: string | null;
  createdAt?: string;
}

/** 合约申请入参（字段名对齐控制面 `RequestContractDto`）。 */
export interface ContractRequestInput {
  dataProductId: string;
  compositionId: string;
  purpose: string;
  retention: string;
  output: string;
  validDays: number;
  minCell?: number;
}

export interface ContractRequestResult {
  contractId: string;
  /** 控制面状态：申请成功后是 `draft`（等数据提供方签发） */
  status: string;
  /** 本仓控制面恒为 true：存在 **不是** 平台自动批准，只有提供方签发后才 active */
  requiresProviderApproval: boolean;
  providerId?: string;
  consumerId?: string;
  validUntil?: string;
}

/** 自动推进的结果（控制面 `POST /contracts/:id/auto-offer`）。 */
export interface AutoOfferResult {
  grantId: string;
  /** true = 要约已进发件箱（等连接器签）；false = 发件箱不可用，合约只定稿未发要约 */
  offered: boolean;
  offerId?: string;
  contract?: { id?: string; status?: string };
}

/** 访问授权判定的入参（字段名对齐控制面 `GET /data-access/check`）。 */
export interface DataAccessCheckInput {
  dataProductId: string;
  /** 缺省 = 问调用者自己 */
  participantId?: string;
  permission?: 'catalog' | 'compute';
  purpose?: string;
}

/**
 * 判定结果。`allowed` 是唯一权威结论，`reason` 说明为什么——
 * 两者的取值域由控制面 `DataAccessService.check()` 定义（no-grant / revoked / expired /
 * permission-missing / purpose-mismatch / provider-self / granted / product-unknown）。
 */
export interface DataAccessCheckResult {
  allowed: boolean;
  reason: string;
  dataProductId: string;
  participantId: string;
  providerId?: string;
  permissions: string[];
  grantId?: string;
  expiresAt?: string | null;
  revokeReason?: string | null;
}

export interface MySpacesResult {
  spaces: string[];
  spaceId?: string;
  memberships: Array<{ spaceId: string; role: string }>;
}

/**
 * 合约摘要（只取判定需要的字段，不透传整条记录）。
 *
 * 字段与控制面的准入判据一一对应（`assertUsableForJob` / `isHolderSigned`）：
 * 持有方签名 = `mdopTerms && holderSignature && platformCountersignature`，
 * 再加 `mdopStatus === 'active'` + 未过期 + 用途编码相符。
 */
export interface ContractSummary {
  id: string;
  providerId: string;
  consumerId: string;
  status: string;
  validUntil?: string;
  dataProductId?: string;
  /** MDOP 生命周期状态（`active` 才可用；与业务 status 不同） */
  mdopStatus?: string;
  /** 持有方已签名（三件套齐全） */
  holderSigned?: boolean;
  /** 规范化条款里的用途编码（与作业 purpose 比对） */
  purposeCode?: string;
  /** 消费方是否已确认规则知悉（approve 的前置条件） */
  consumerAcknowledgedAt?: string;
  /** 申请创建时间（ISO）：用来算"等了多久"（Phase 4 的审批进度） */
  createdAt?: string;
  validFrom?: string;
  retention?: string;
  minCell?: number;
  retentionDays?: number;
  rareConditionMaxPrevalence?: number;
  teePolicy?: 'none' | 'software' | 'hardware';
  recipients?: string[];
  allowedOperators?: string[];
}

interface HttpClientOptions {
  apiUrl: string;
  apiPrefix: string;
  timeoutMs?: number;
  /** agent 自有凭证（R2）：只用于目录等元数据读取，绝不取调用者 token */
  serviceToken?: string | null;
}

/**
 * 控制面 API 客户端。
 *
 * 目录来源：`GET {prefix}/public/catalog`（只读目录；**数据产品内容不取**）。
 * 提交：direct 直提场景端点；template 走 `plans/preview` → `jobs`（通用入口需 analysisKey 归属）。
 */
export class HttpMedTrustApiClient implements MedTrustApiClient {
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async listDirectory(spaceId: string): Promise<SpaceDirectory> {
    try {
      const response = await this.request<{
        items?: Array<{
          id?: string;
          urn?: string;
          title?: string;
          providerId?: string;
          productRoles?: unknown;
          fhirSchema?: { productRoles?: unknown } | null;
        }>;
      }>(
        'GET',
        `/public/catalog?spaceId=${encodeURIComponent(spaceId)}`,
        undefined,
        this.options.serviceToken ?? undefined,
      );

      const items = Array.isArray(response?.items) ? response.items : [];
      const dataProducts = items
        .filter((item) => typeof item.id === 'string')
        .map((item) => {
          const rawRoles = Array.isArray(item.productRoles)
            ? item.productRoles
            : Array.isArray(item.fhirSchema?.productRoles)
              ? item.fhirSchema.productRoles
              : [];
          const roles = rawRoles.filter(
            (role): role is string => typeof role === 'string' && role.trim().length > 0,
          );
          return {
            id: String(item.id),
            name: item.title ?? String(item.id),
            ...(item.providerId ? { ownerId: item.providerId } : {}),
            ...(roles.length > 0 ? { roles: [...new Set(roles)] } : {}),
          };
        });

      const participantIds = [
        ...new Set(
          items
            .map((item) => item.providerId)
            .filter((providerId): providerId is string => typeof providerId === 'string'),
        ),
      ];
      const participants = participantIds.map((id) => ({ id, name: id }));

      return { participants, dataProducts };
    } catch {
      // 目录不可用不应阻断对话：卡片会显式提示目录为空。
      return { participants: [], dataProducts: [] };
    }
  }

  async listMySpaces(token: string): Promise<MySpacesResult> {
    const response = await this.request<{
      spaces?: unknown;
      spaceId?: unknown;
      memberships?: Array<{ spaceId?: unknown; role?: unknown }>;
    }>('GET', '/auth/spaces', undefined, token);

    const spaces = Array.isArray(response?.spaces)
      ? response.spaces.filter((item): item is string => typeof item === 'string')
      : [];
    const memberships = Array.isArray(response?.memberships)
      ? response.memberships
          .filter((item) => typeof item?.spaceId === 'string')
          .map((item) => ({ spaceId: String(item.spaceId), role: String(item.role ?? '') }))
      : [];
    return {
      spaces,
      ...(typeof response?.spaceId === 'string' ? { spaceId: response.spaceId } : {}),
      memberships,
    };
  }

  async listContracts(token: string): Promise<ContractSummary[]> {
    const response = await this.request<unknown>('GET', '/contracts', undefined, token);
    const items = Array.isArray(response) ? response : [];
    return items
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => {
        const terms = (item.mdopTerms ?? {}) as Record<string, unknown>;
        return {
          id: String(item.id ?? ''),
          providerId: String(item.providerId ?? ''),
          consumerId: String(item.consumerId ?? ''),
          status: String(item.status ?? ''),
          ...(typeof item.validUntil === 'string' ? { validUntil: item.validUntil } : {}),
          ...(typeof item.dataProductId === 'string' ? { dataProductId: item.dataProductId } : {}),
          ...(typeof item.mdopStatus === 'string' ? { mdopStatus: item.mdopStatus } : {}),
          holderSigned: Boolean(
            item.mdopTerms && item.holderSignature && item.platformCountersignature,
          ),
          ...(typeof terms.purposeCode === 'string'
            ? { purposeCode: terms.purposeCode }
            : typeof item.purpose === 'string'
              ? { purposeCode: item.purpose }
              : {}),
          ...(typeof item.consumerAcknowledgedAt === 'string'
            ? { consumerAcknowledgedAt: item.consumerAcknowledgedAt }
            : {}),
          ...(typeof item.createdAt === 'string' ? { createdAt: item.createdAt } : {}),
          ...(typeof item.createdAt === 'string' ? { validFrom: item.createdAt } : {}),
          ...(typeof item.retention === 'string' ? { retention: item.retention } : {}),
          ...(typeof (item.outputPolicy as { minCell?: unknown } | undefined)?.minCell === 'number'
            ? { minCell: (item.outputPolicy as { minCell: number }).minCell }
            : {}),
          ...(Array.isArray((item.mdopTerms as { recipients?: unknown } | undefined)?.recipients)
            ? {
                recipients: (
                  (item.mdopTerms as {
                    recipients: Array<{ party?: unknown }>;
                  }).recipients
                )
                  .map((recipient) => recipient.party)
                  .filter((party): party is string => typeof party === 'string'),
              }
            : {}),
          ...(Array.isArray((item.mdopTerms as { allowedOpDigests?: unknown } | undefined)?.allowedOpDigests)
            ? {
                allowedOperators: (
                  (item.mdopTerms as { allowedOpDigests: unknown[] }).allowedOpDigests
                ).filter((op): op is string => typeof op === 'string'),
              }
            : {}),
        };
      })
      .filter((item) => item.id.length > 0);
  }

  async listCompositions(token: string): Promise<CompositionSummary[]> {
    const response = await this.request<unknown>('GET', '/compositions', undefined, token);
    const items = Array.isArray(response) ? response : [];
    return items
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        id: String(item.id ?? ''),
        ...(typeof item.scenarioKey === 'string' ? { scenarioKey: item.scenarioKey } : {}),
        verdict: typeof item.verdict === 'string' ? item.verdict : null,
        ...(typeof item.overallRisk === 'string' ? { overallRisk: item.overallRisk } : {}),
        ...(typeof item.createdAt === 'string' ? { createdAt: item.createdAt } : {}),
      }))
      .filter((item) => item.id.length > 0);
  }

  async requestContract(
    input: ContractRequestInput,
    ctx: ApiCallContext,
  ): Promise<ContractRequestResult> {
    const created = await this.request<{
      id?: unknown;
      status?: unknown;
      providerId?: unknown;
      consumerId?: unknown;
      validUntil?: unknown;
    }>('POST', '/contracts/requests', input, ctx.token);
    return {
      contractId: String(created.id ?? ''),
      status: String(created.status ?? 'draft'),
      // 控制面没有"平台自动批准"：申请是草稿，生效判据是提供方签发（mdopStatus=active）。
      requiresProviderApproval: true,
      ...(typeof created.providerId === 'string' ? { providerId: created.providerId } : {}),
      ...(typeof created.consumerId === 'string' ? { consumerId: created.consumerId } : {}),
      ...(typeof created.validUntil === 'string' ? { validUntil: created.validUntil } : {}),
    };
  }

  async recordAudit(entry: AuditEntryInput, ctx: ApiCallContext): Promise<void> {
    await this.request<unknown>(
      'POST',
      '/audit',
      {
        action: entry.action,
        resource: entry.resource,
        ...(entry.resourceId !== undefined ? { resourceId: entry.resourceId } : {}),
        ...(entry.details ? { details: entry.details } : {}),
      },
      ctx.token,
    );
  }

  async autoOfferContract(contractId: string, ctx: ApiCallContext): Promise<AutoOfferResult> {
    const response = await this.request<{
      grantId?: unknown;
      offered?: unknown;
      offerId?: unknown;
      contract?: { id?: unknown; status?: unknown };
    }>('POST', `/contracts/${encodeURIComponent(contractId)}/auto-offer`, {}, ctx.token);
    return {
      grantId: String(response?.grantId ?? ''),
      offered: response?.offered === true,
      ...(typeof response?.offerId === 'string' ? { offerId: response.offerId } : {}),
      ...(response?.contract
        ? {
            contract: {
              ...(typeof response.contract.id === 'string' ? { id: response.contract.id } : {}),
              ...(typeof response.contract.status === 'string'
                ? { status: response.contract.status }
                : {}),
            },
          }
        : {}),
    };
  }

  async checkDataProductAccess(
    input: DataAccessCheckInput,
    ctx: ApiCallContext,
  ): Promise<DataAccessCheckResult> {
    const query = new URLSearchParams({ dataProductId: input.dataProductId });
    if (input.participantId) query.set('participantId', input.participantId);
    if (input.permission) query.set('permission', input.permission);
    if (input.purpose) query.set('purpose', input.purpose);
    const response = await this.request<DataAccessCheckResult>(
      'GET',
      `/data-access/check?${query.toString()}`,
      undefined,
      ctx.token,
    );
    return {
      ...response,
      permissions: Array.isArray(response?.permissions) ? response.permissions : [],
    };
  }

  async getRegistrationJob(
    jobId: string,
    ctx: ApiCallContext,
  ): Promise<RegistrationJobSnapshot> {
    const response = await this.request<{
      job?: {
        id?: unknown;
        status?: unknown;
        planHash?: unknown;
        createdAt?: unknown;
      };
      result?: unknown;
      chains?: unknown;
    }>('GET', `/mdop/jobs/${encodeURIComponent(jobId)}`, undefined, ctx.token);
    const job = response?.job ?? {};
    return {
      jobId: String(job.id ?? jobId),
      status: String(job.status ?? 'UNKNOWN'),
      ...(typeof job.planHash === 'string' ? { planHash: job.planHash } : {}),
      ...(typeof job.createdAt === 'string' ? { createdAt: job.createdAt } : {}),
      ...(response?.result !== undefined ? { result: response.result } : {}),
      ...(Array.isArray(response?.chains) ? { chains: response.chains } : {}),
    };
  }

  async buildRegistrationReport(
    jobId: string,
    reportInput: Record<string, unknown> | undefined,
    ctx: ApiCallContext,
  ): Promise<RegistrationReportBuildResult> {
    return this.request<RegistrationReportBuildResult>(
      'POST',
      `/mdop/jobs/${encodeURIComponent(jobId)}/registration-report/build`,
      { reportInput },
      ctx.token,
    );
  }

  registrationReportDownloadUrl(
    jobId: string,
    format: 'json' | 'markdown' | 'html' | 'docx' | 'evidence-zip',
  ): string {
    return `${this.options.apiUrl}${this.options.apiPrefix}/mdop/jobs/${encodeURIComponent(jobId)}/registration-report?format=${encodeURIComponent(format)}`;
  }

  async submitScenario(
    submission: ScenarioSubmission,
    ctx: ApiCallContext,
  ): Promise<SubmitJobResult> {
    if (submission.mode === 'direct') {
      if (!submission.endpoint) throw new Error(`场景 ${submission.scenarioId} 缺少提交端点`);
      const created = await this.request<SubmitJobResult>(
        'POST',
        submission.endpoint,
        submission.payload,
        ctx.token,
      );
      return created;
    }

    if (!submission.template) throw new Error(`场景 ${submission.scenarioId} 缺少模板 id`);
    const plan = await this.request<Record<string, unknown>>(
      'POST',
      '/mdop/plans/preview',
      { template: submission.template, input: submission.templateInput },
      ctx.token,
    );
    const created = await this.request<SubmitJobResult>(
      'POST',
      '/mdop/jobs',
      { ...plan, analysisKey: submission.analysisKey },
      ctx.token,
    );
    return { ...created, plan };
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    return withSpan(
      'controlplane.request',
      // 只放方法与路径模板：**不放请求体**（含数据产品/参与方取值，属于用户输入）
      { 'http.method': method, 'http.route': path, 'peer.service': 'medtrust-api' },
      async (span) => {
        try {
          const traceparent = traceparentHeader();
          const response = await fetch(
            `${this.options.apiUrl}${this.options.apiPrefix}${path}`,
            {
              method,
              headers: {
                'content-type': 'application/json',
                ...(token ? { authorization: `Bearer ${token}` } : {}),
                // W3C 追踪上下文：让控制面能把这条调用接到同一条 trace 上
                ...(traceparent ? { traceparent } : {}),
              },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
              signal: controller.signal,
            },
          );
          span?.setAttribute('http.status_code', response.status);
          const text = await response.text();
          const parsed = text ? (JSON.parse(text) as T & { message?: unknown }) : ({} as T);
          if (!response.ok) {
            const detail =
              typeof (parsed as { message?: unknown }).message === 'string'
                ? String((parsed as { message?: unknown }).message)
                : text.slice(0, 200);
            // 带 status 的错：上游要能区分「登录态失效（401/403）」与「查询暂时不可用（网络/5xx）」。
            // 前者是**确定性的拒绝**，不能按"查不动 → 不拦"处理（否则会带着坏 token 去提交）。
            const error = new Error(`${response.status} ${detail}`) as Error & { status?: number };
            error.status = response.status;
            throw error;
          }
          return parsed as T;
        } finally {
          clearTimeout(timer);
        }
      },
    );
  }
}
