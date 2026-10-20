import type { SpaceDirectory } from '../agent/directory';
import type { ScenarioSubmission } from '../agent/scenarios';
import type {
  ApiCallContext,
  AuditEntryInput,
  AutoOfferResult,
  CompositionSummary,
  DataAccessCheckInput,
  DataAccessCheckResult,
  ContractSummary,
  ContractRequestInput,
  ContractRequestResult,
  MedTrustApiClient,
  MySpacesResult,
  RegistrationJobSnapshot,
  RegistrationReportBuildResult,
  SubmitJobResult,
} from '../agent/tools/api-client';

export const FAKE_DIRECTORY: SpaceDirectory = {
  participants: [
    { id: 'p-sponsor', name: '申办方 A' },
    { id: 'p-hosp-a', name: '医院 A' },
    { id: 'p-hosp-b', name: '医院 B' },
    { id: 'p-grid-a', name: '供电局 A' },
    { id: 'p-grid-b', name: '供电局 B' },
  ],
  dataProducts: [
    { id: 'dp-trial', name: '试验组数据', ownerId: 'p-sponsor' },
    { id: 'dp-controls', name: '对照组数据', ownerId: 'p-hosp-a' },
    { id: 'dp-hosp-b', name: '医院 B 数据', ownerId: 'p-hosp-b' },
    { id: 'dp-load-a', name: '负荷数据 A', ownerId: 'p-grid-a' },
    { id: 'dp-load-b', name: '负荷数据 B', ownerId: 'p-grid-b' },
  ],
};

/** 默认：覆盖 p-sponsor↔p-hosp-a 的**可用**合约（对齐控制面 assertUsableForJob 的五条判据）。 */
export const FAKE_USABLE_CONTRACT: ContractSummary = {
  id: 'ct-fake-1',
  providerId: 'p-hosp-a',
  consumerId: 'p-sponsor',
  dataProductId: 'dp-controls',
  status: 'active',
  mdopStatus: 'active',
  validUntil: '2027-01-14T00:00:00.000Z',
  holderSigned: true,
  // 刻意**不带** purposeCode：检查器只在"确知用途不符"时阻断，
  // 未知就不拦（免得测试里改个 purpose 文案就整片变红）。用途不符有专门用例。
};

/**
 * 默认可见合约**全集**：agent 侧的覆盖判据要求同一份合约覆盖本次作业的全部参与方
 * （控制面只按 contractId 校验，覆盖是 agent 侧的加固），所以每个参与方组合要各有一份。
 * 少了哪一对，对应的场景用例就会在提交前被闸拦下——这正是这张表存在的意义。
 */
export const FAKE_USABLE_CONTRACTS: ContractSummary[] = [
  FAKE_USABLE_CONTRACT,
  {
    ...FAKE_USABLE_CONTRACT,
    id: 'ct-fake-trial',
    providerId: 'p-sponsor',
    consumerId: 'pharma-demo',
    dataProductId: 'dp-trial',
  },
  {
    ...FAKE_USABLE_CONTRACT,
    id: 'ct-fake-2',
    providerId: 'p-hosp-b',
    consumerId: 'p-hosp-a',
  },
  {
    ...FAKE_USABLE_CONTRACT,
    id: 'ct-fake-3',
    providerId: 'p-grid-b',
    consumerId: 'p-grid-a',
  },
  {
    ...FAKE_USABLE_CONTRACT,
    id: 'ct-fake-grid-a',
    providerId: 'p-grid-a',
    consumerId: 'p-grid-b',
    dataProductId: 'dp-load-a',
  },
  {
    ...FAKE_USABLE_CONTRACT,
    id: 'ct-fake-grid-b',
    providerId: 'p-grid-b',
    consumerId: 'p-grid-a',
    dataProductId: 'dp-load-b',
  },
];

export interface FakeApiOptions {
  directory?: SpaceDirectory;
  result?: SubmitJobResult;
  failWith?: string;
  /** 前 N 次提交失败（缺省：只要给了 failWith 就一直失败） */
  failTimes?: number;
  /** 本人可见合约（缺省：一份可用合约）。传 [] 表示"确定没有合约"。 */
  contracts?: ContractSummary[];
  /** 本人所属空间（缺省 sh-med / consumer） */
  mySpaces?: MySpacesResult;
  /** 让合规相关查询抛错（模拟控制面不可达 → 判定为 unknown，不应阻断） */
  complianceFailWith?: string;
  /** 本方创建的合规预审（缺省：一份已通过的预审）。传 [] 表示"还没有预审"。 */
  compositions?: CompositionSummary[];
  /** 发起合约申请的失败信息（模拟控制面 4xx/5xx） */
  contractRequestFailWith?: string;
  /** 审计写入失败（模拟控制面审计端点不可用） */
  auditFailWith?: string;
  /**
   * 让合规相关查询返回 401（模拟 access token 过期）。
   * 与 `complianceFailWith` 的区别：这是**确定性鉴权拒绝**，闸应当拦并提示重新登录，
   * 不能按"查不动 → 不拦"处理。
   */
  complianceUnauthorized?: boolean;
  /**
   * 预授权自动推进（Phase 3 / D-MDOP-9）：
   * - `'auto-sign'`（缺省）：控制面接受自动推进，且**院内连接器立刻自动签**（合约随即可用）；
   * - `'offer-only'`：接受自动推进但连接器是人工复核策略（要约发出、合约仍不可用）；
   * - `'reject'`：控制面拒绝（提供方未预授权 / 预审需审批）→ agent 退回人工路径。
   */
  autoOffer?: 'auto-sign' | 'offer-only' | 'reject';
  /**
   * 数据产品访问授权（产品级 ACL，D-ACL-1）。缺省：演示用的产品都已授权给本方。
   * 传 {} 表示"什么都没有"——fail-closed 语义下即全部拒绝。
   */
  dataAccess?: Record<string, DataAccessCheckResult> | 'fail';
  registrationJob?: RegistrationJobSnapshot;
  registrationReport?: RegistrationReportBuildResult;
}

/** 默认：一份已过 L2 裁决的合规预审（合约申请必须引用它，D-CMP-2）。 */
export const FAKE_COMPOSITION: CompositionSummary = {
  id: 'comp-fake-1',
  scenarioKey: 'rws.external-control',
  verdict: 'pass',
  createdAt: '2026-10-01T00:00:00.000Z',
};

/** 默认：演示用的两个数据产品都授权给本方（ACL 是 fail-closed，桩必须显式给授权）。 */
export const FAKE_DATA_ACCESS: Record<string, DataAccessCheckResult> = {
  'dp-trial': {
    allowed: true,
    reason: 'granted',
    dataProductId: 'dp-trial',
    participantId: 'p-sponsor',
    providerId: 'p-sponsor',
    permissions: ['compute'],
    grantId: 'grant-fake-1',
    expiresAt: null,
  },
  'dp-controls': {
    allowed: true,
    reason: 'granted',
    dataProductId: 'dp-controls',
    participantId: 'p-sponsor',
    providerId: 'p-hosp-a',
    permissions: ['compute'],
    grantId: 'grant-fake-2',
    expiresAt: null,
  },
  'dp-hosp-b': {
    allowed: true,
    reason: 'granted',
    dataProductId: 'dp-hosp-b',
    participantId: 'p-sponsor',
    providerId: 'p-hosp-b',
    permissions: ['compute'],
    grantId: 'grant-fake-3',
    expiresAt: null,
  },
  'dp-load-a': {
    allowed: true,
    reason: 'granted',
    dataProductId: 'dp-load-a',
    participantId: 'p-sponsor',
    providerId: 'p-grid-a',
    permissions: ['compute'],
    grantId: 'grant-fake-4',
    expiresAt: null,
  },
  'dp-load-b': {
    allowed: true,
    reason: 'granted',
    dataProductId: 'dp-load-b',
    participantId: 'p-sponsor',
    providerId: 'p-grid-b',
    permissions: ['compute'],
    grantId: 'grant-fake-5',
    expiresAt: null,
  },
};

/** 测试替身：记录提交调用，可注入目录 / 结果 / 失败。 */
export class FakeApiClient implements MedTrustApiClient {
  readonly submissions: Array<{ submission: ScenarioSubmission; ctx: ApiCallContext }> = [];
  readonly directoryCalls: Array<{ spaceId: string }> = [];
  readonly contractRequests: Array<{ input: ContractRequestInput; ctx: ApiCallContext }> = [];
  /** 真正发出去的审计条目（平台审计链的入口，e2e 据此断言"动作有留痕"） */
  readonly auditEntries: Array<{ entry: AuditEntryInput; ctx: ApiCallContext }> = [];
  /** 测试里"数据提供方签发的合约"（本仓由医院连接器完成，桩里用这个模拟） */
  private readonly issuedContracts: ContractSummary[] = [];
  /** 可变的产品级授权表（`grantDataAccess()` 会在用例中途改它，模拟“提供方刚开了权限”） */
  private readonly dataAccessTable: Record<string, DataAccessCheckResult>;
  readonly registrationReportBuilds: Array<{
    jobId: string;
    reportInput: Record<string, unknown>;
    ctx: ApiCallContext;
  }> = [];

  private remainingFailures: number;
  private requestedSeq = 0;
  private readonly requestedInputs = new Map<string, ContractRequestInput>();

  constructor(private readonly options: FakeApiOptions = {}) {
    this.remainingFailures = options.failWith
      ? (options.failTimes ?? Number.POSITIVE_INFINITY)
      : 0;
    this.dataAccessTable =
      options.dataAccess && options.dataAccess !== 'fail'
        ? { ...options.dataAccess }
        : { ...FAKE_DATA_ACCESS };
  }

  /** 模拟数据提供方授予访问权（产品级 ACL）：从此刻起 `check` 会返回 allowed。 */
  grantDataAccess(dataProductId: string, permissions: string[] = ['compute']): void {
    this.dataAccessTable[dataProductId] = {
      allowed: true,
      reason: 'granted',
      dataProductId,
      participantId: 'p-sponsor',
      providerId: 'p-hosp-a',
      permissions,
      grantId: `grant-${dataProductId}`,
      expiresAt: null,
    };
  }

  async listDirectory(spaceId: string): Promise<SpaceDirectory> {
    this.directoryCalls.push({ spaceId });
    return this.options.directory ?? FAKE_DIRECTORY;
  }

  async listMySpaces(_token: string): Promise<MySpacesResult> {
    if (this.options.complianceUnauthorized) throw httpError(401, 'Unauthorized');
    if (this.options.complianceFailWith) throw new Error(this.options.complianceFailWith);
    return (
      this.options.mySpaces ?? {
        spaces: ['sh-med'],
        spaceId: 'sh-med',
        memberships: [{ spaceId: 'sh-med', role: 'consumer' }],
      }
    );
  }

  async listContracts(_token: string): Promise<ContractSummary[]> {
    if (this.options.complianceUnauthorized) throw httpError(401, 'Unauthorized');
    if (this.options.complianceFailWith) throw new Error(this.options.complianceFailWith);
    return [...(this.options.contracts ?? FAKE_USABLE_CONTRACTS), ...this.issuedContracts];
  }

  /**
   * 模拟**数据提供方签发**：把一份草稿合约变成可用的合约（`holderSigned` + `mdopStatus=active`）。
   *
   * 这一步在真实系统里由医院侧连接器用本院私钥签 `ContractAgree` 完成（D-MDOP-4），
   * agent 侧没有、也不该有这条路径；桩里只用来把「申请 → 签发 → 提交」这条链跑通。
   */
  issueContract(contractId: string, over: Partial<ContractSummary> = {}): ContractSummary {
    const issued: ContractSummary = {
      ...FAKE_USABLE_CONTRACT,
      id: contractId,
      status: 'active',
      mdopStatus: 'active',
      holderSigned: true,
      ...over,
    };
    this.issuedContracts.push(issued);
    return issued;
  }

  async recordAudit(entry: AuditEntryInput, ctx: ApiCallContext): Promise<void> {
    if (this.options.auditFailWith) throw new Error(this.options.auditFailWith);
    this.auditEntries.push({ entry, ctx });
  }

  async checkDataProductAccess(
    input: DataAccessCheckInput,
    _ctx: ApiCallContext,
  ): Promise<DataAccessCheckResult> {
    if (this.options.complianceUnauthorized) throw httpError(401, 'Unauthorized');
    if (this.options.dataAccess === 'fail') throw new Error('ECONNREFUSED');
    return (
      this.dataAccessTable[input.dataProductId] ?? {
        allowed: false,
        reason: 'no-grant',
        dataProductId: input.dataProductId,
        participantId: 'p-sponsor',
        providerId: 'p-hosp-a',
        permissions: [],
      }
    );
  }

  async autoOfferContract(contractId: string, _ctx: ApiCallContext): Promise<AutoOfferResult> {
    if (this.options.autoOffer === 'reject') {
      throw new Error('400 提供方尚未预授权该使用方访问该数据产品（no-grant），自动推进不适用');
    }
    const mode = this.options.autoOffer ?? 'auto-sign';
    if (mode === 'auto-sign') {
      // 模拟"院内连接器按本地策略自动签"：合约当即变成已签名、active、可用的那份
      const requested = this.requestedInputs.get(contractId);
      const product = (this.options.directory ?? FAKE_DIRECTORY).dataProducts.find(
        (item) => item.id === requested?.dataProductId,
      );
      this.issueContract(contractId, {
        consumerId: 'pharma-demo',
        ...(product?.ownerId ? { providerId: product.ownerId } : {}),
        ...(requested?.dataProductId ? { dataProductId: requested.dataProductId } : {}),
      });
    }
    return {
      grantId: 'grant-fake-auto',
      offered: true,
      offerId: `offer:${contractId}:fake`,
      contract: { id: contractId, status: 'active' },
    };
  }

  async listCompositions(_token: string): Promise<CompositionSummary[]> {
    if (this.options.complianceUnauthorized) throw httpError(401, 'Unauthorized');
    if (this.options.complianceFailWith) throw new Error(this.options.complianceFailWith);
    return this.options.compositions ?? [FAKE_COMPOSITION];
  }

  async requestContract(
    input: ContractRequestInput,
    ctx: ApiCallContext,
  ): Promise<ContractRequestResult> {
    this.contractRequests.push({ input, ctx });
    if (this.options.contractRequestFailWith) {
      throw new Error(this.options.contractRequestFailWith);
    }
    this.requestedSeq += 1;
    const contractId = `ct-requested-${this.requestedSeq}`;
    this.requestedInputs.set(contractId, input);
    return {
      contractId,
      status: 'draft',
      requiresProviderApproval: true,
      providerId: 'p-hosp-a',
      consumerId: 'p-sponsor',
      validUntil: '2027-01-14T00:00:00.000Z',
    };
  }

  async submitScenario(submission: ScenarioSubmission, ctx: ApiCallContext): Promise<SubmitJobResult> {
    this.submissions.push({ submission, ctx });
    if (this.options.failWith && this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new Error(this.options.failWith);
    }
    const base = this.options.result ?? { jobId: 'job-fake-1', status: 'submitted', stages: 6 };
    return {
      ...base,
      template: submission.template ?? submission.analysisKey,
    };
  }

  async getRegistrationJob(
    jobId: string,
    _ctx: ApiCallContext,
  ): Promise<RegistrationJobSnapshot> {
    return (
      this.options.registrationJob ?? {
        jobId,
        status: 'SUCCEEDED',
        analysisKey: 'mdop.external-control-registration',
        planHash: `sm3:${'a'.repeat(64)}`,
        createdAt: '2026-10-18T00:06:00.000Z',
      }
    );
  }

  async buildRegistrationReport(
    jobId: string,
    reportInput: Record<string, unknown> | undefined,
    ctx: ApiCallContext,
  ): Promise<RegistrationReportBuildResult> {
    this.registrationReportBuilds.push({ jobId, reportInput: reportInput ?? {}, ctx });
    return (
      this.options.registrationReport ?? {
        jobId,
        reportFingerprint: `sm3:${'b'.repeat(64)}`,
        syntheticOnly: true,
        files: {
          json: `/mdop/jobs/${jobId}/registration-report?format=json`,
          markdown: `/mdop/jobs/${jobId}/registration-report?format=markdown`,
          html: `/mdop/jobs/${jobId}/registration-report?format=html`,
          docx: `/mdop/jobs/${jobId}/registration-report?format=docx`,
          evidenceZip: `/mdop/jobs/${jobId}/registration-report?format=evidence-zip`,
        },
      }
    );
  }

  registrationReportDownloadUrl(
    jobId: string,
    format: 'json' | 'markdown' | 'html' | 'docx' | 'evidence-zip',
  ): string {
    return `/mdop/jobs/${jobId}/registration-report?format=${format}`;
  }
}

/** 带 status 的 HTTP 错（与真实 api-client 的抛错形状一致）。 */
function httpError(status: number, message: string): Error & { status: number } {
  const error = new Error(`${status} ${message}`) as Error & { status: number };
  error.status = status;
  return error;
}
