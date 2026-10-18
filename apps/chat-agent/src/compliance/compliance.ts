import type { ContractSummary, MedTrustApiClient } from '../agent/tools/api-client';
import { buildContractBundle } from '@medtrust/mdop';

/**
 * 合规先决条件检查（ai-chat-agent-compliance-integration / Phase 1-2）。
 *
 * **这一层是"提前告知"，不是"强制点"。** 真正的强制点在控制面：每个端点都有
 * JwtAuthGuard + ParticipantRolesGuard，MDOP 提交还要过 `assertUsableForJob`
 * （存在 → 持有方签名 → mdopStatus=active → 未过期 → 用途编码相符）。
 * 这里做的是：**在用户填完参数之前**就把"还差什么"讲清楚，避免填完才被 400 打回。
 *
 * 因此失败策略是明确的：
 * - 明确"不属于该空间" → 拦（needs_permission）
 * - 明确"没有可用的合约" → 拦，并给出**改哪一条**（needs_contract）
 * - 查不动（网络/形状不对/无凭证） → **不拦**（unknown，交给控制面判定），
 *   因为把"查询故障"升级成"用户不能用"是错的；而漏放也不会造成越权（控制面还会拦）。
 */

export type CheckTri = 'yes' | 'no' | 'unknown';

export interface MembershipCheck {
  status: CheckTri;
  role?: string;
  reason?: string;
}

/** 合约闸：状态 + **精确到失败的那一条判据**。 */
export interface ContractGate {
  status: 'usable' | 'missing' | 'not-usable' | 'unknown';
  contractId?: string;
  /** 多数据源作业的全部可用/候选合约（`contractId` 保留为第一份，兼容单合约调用方）。 */
  contractIds?: string[];
  /** 按参与方分配的具体合约。 */
  allocations?: Array<{
    role?: string;
    participantId: string;
    dataProductId: string;
    contractId: string;
  }>;
  /** 逐依赖矩阵。双缺失时一个都不会丢。 */
  requirementGates?: ContractRequirementGate[];
  contractBundle?: {
    bundleId?: string;
    version?: string;
    status: 'draft' | 'partially_active' | 'active' | 'expired' | 'revoked' | 'terminated';
  };
  /** 控制面的业务状态（draft / active / revoked）：用来区分"还没申请"与"申请了没签发" */
  contractStatus?: string;
  /** 人话原因（可直接给用户） */
  reason?: string;
  /** 可操作的下一步 */
  fix?: 'request_contract' | 'await_provider_approval' | 'await_acknowledgement';
}

export interface ContractRequirementGate {
  role?: string;
  participantId: string;
  dataProductId: string;
  state: 'ready' | 'missing' | 'not-usable' | 'purpose-mismatch' | 'unknown';
  contractId?: string;
  reason?: string;
  fix?: ContractGate['fix'];
  contractStatus?: string;
}

export interface ComplianceVerdict {
  status: 'ready' | 'needs_permission' | 'needs_data_access' | 'needs_contract' | 'unknown';
  reason?: string;
  contractId?: string;
  /** 多数据源作业的可用合约集合。 */
  contractIds?: string[];
  /** 下一步动作：合约类或访问授权类 */
  fix?: ContractGate['fix'] | 'request_data_access';
  membership: MembershipCheck;
  contract: ContractGate;
  contractBundle?: ContractGate['contractBundle'];
  /** 产品级 ACL 判定（有数据产品入参时才有；见 D-ACL-1） */
  dataAccess?: DataAccessGate;
}

/** 产品级 ACL 的判定（访问控制层；与合约的"执行授权层"是两件事）。 */
export interface DataAccessGate {
  status: 'allowed' | 'denied' | 'unknown';
  dataProductId: string;
  reason?: string;
  fix?: 'request_data_access';
}

export interface ContractGateInput {
  /** 本次作业涉及的参与方。 */
  participants: string[];
  /**
   * 每个数据源需要满足的绑定。给定时按「提供方 + 数据产品」逐项找合约；
   * 不再要求一份合约同时覆盖所有参与方。
   */
  requirements?: Array<{ role?: string; participantId: string; dataProductId: string }>;
  /** 作业用途编码（与合约的 purposeCode 比对，如 mdop.external-control） */
  purpose?: string;
  /** 研究/任务稳定引用；用于 bundle 版本与审计。 */
  studyRef?: string;
  /** 指定合约 id 时只判这一份 */
  contractId?: string;
}

/**
 * 空间成员身份（**用调用者 token** 问 `/auth/spaces`）。
 * 问的是"你是谁"，不是"agent 能看什么"——所以不能借用 agent 自有凭证。
 */
export async function checkMembership(
  api: MedTrustApiClient,
  token: string | undefined,
  spaceId: string,
): Promise<MembershipCheck> {
  if (!token) {
    // 没有调用者凭证：登录态由控制面把关，这里不假装知道
    return { status: 'unknown', reason: '未带调用者凭证，空间归属交由控制面判定' };
  }
  try {
    const mine = await api.listMySpaces(token);
    const membership = mine.memberships.find((item) => item.spaceId === spaceId);
    if (!membership) {
      return { status: 'no', reason: `你不属于空间 ${spaceId}（控制面会以 403 拒绝）` };
    }
    return { status: 'yes', role: membership.role };
  } catch (error) {
    // 401/403：控制面**明确拒绝**了这份凭证/身份 → 确定性拒绝，不能当成"查不动"放行。
    // （access token 只有 15 分钟；聊天链路若不续签，到这里就会拿 401。）
    if (isAuthRejection(error)) {
      return { status: 'no', reason: `登录态已失效或无权访问（控制面 ${httpStatus(error)}），请重新登录后再试` };
    }
    return { status: 'unknown', reason: `空间归属查询失败：${message(error)}` };
  }
}

/** 逐条镜像控制面 `assertUsableForJob` 的判据，失败即指出是哪一条。 */
export function evaluateContract(
  contract: ContractSummary,
  input: ContractGateInput,
  now: Date = new Date(),
): ContractGate | null {
  const covers = input.participants.every(
    (party) => contract.providerId === party || contract.consumerId === party,
  );
  if (!covers) return null;

  if (!contract.holderSigned) {
    return {
      status: 'not-usable',
      contractId: contract.id,
      contractStatus: contract.status,
      reason:
        `合约 ${contract.id}（${contract.status}）还没有数据提供方签名（控制面：E_CONTRACT_UNSIGNED）` +
        '——申请已提交也要等对方签发，签发前不能提交作业',
      fix: 'await_provider_approval',
    };
  }
  if (contract.mdopStatus !== 'active') {
    return {
      status: 'not-usable',
      contractId: contract.id,
      contractStatus: contract.status,
      reason: `合约 ${contract.id} 的 MDOP 状态是 ${contract.mdopStatus ?? '未知'}（需 active）`,
      fix: 'await_provider_approval',
    };
  }
  if (contract.validUntil && new Date(contract.validUntil).getTime() < now.getTime()) {
    return {
      status: 'not-usable',
      contractId: contract.id,
      contractStatus: contract.status,
      reason: `合约 ${contract.id} 已于 ${contract.validUntil.slice(0, 10)} 过期`,
      fix: 'request_contract',
    };
  }
  if (input.purpose && contract.purposeCode && contract.purposeCode !== input.purpose) {
    return {
      status: 'not-usable',
      contractId: contract.id,
      contractStatus: contract.status,
      reason: `合约 ${contract.id} 的用途编码 ${contract.purposeCode} 与本次作业 ${input.purpose} 不符（E_PURPOSE_MISMATCH）`,
      fix: 'request_contract',
    };
  }
  return { status: 'usable', contractId: contract.id, contractStatus: contract.status };
}

/**
 * 按参与方/数据产品匹配一组合约。
 *
 * 外部对照有两个数据源，每个源由自己的提供方签署一份合约。要求“同一份合约覆盖全部参与方”
 * 会把这种合法的两合约方案误判成缺合约。逐项匹配仍复用 `evaluateContract` 的五条准入判据，
 * 不放宽签名、状态、有效期或用途。
 */
export function evaluateContractSet(
  contracts: ContractSummary[],
  input: ContractGateInput,
  now: Date = new Date(),
): ContractGate {
  const requirements = (input.requirements ?? []).filter(
    (req) => req.participantId && req.dataProductId,
  );
  if (requirements.length === 0) {
    const gates = contracts
      .map((contract) => evaluateContract(contract, input, now))
      .filter((gate): gate is ContractGate => gate !== null);
    const usable = gates.find((gate) => gate.status === 'usable');
    if (usable) return usable;
    if (gates.length > 0) return gates[0];
    return {
      status: 'missing',
      reason: input.participants.length
        ? `没有覆盖 ${input.participants.join(' 与 ')} 的生效合约（控制面：E_CONTRACT_MISSING）`
        : '没有生效合约',
      fix: 'request_contract',
    };
  }

  const allocations: NonNullable<ContractGate['allocations']> = [];
  const requirementGates: ContractRequirementGate[] = [];
  for (const requirement of requirements) {
    const candidates = contracts.filter(
      (contract) =>
        contract.providerId === requirement.participantId &&
        contract.dataProductId === requirement.dataProductId,
    );
    const evaluated = candidates
      .map((contract) =>
        evaluateContract(contract, { ...input, participants: [] }, now),
      )
      .filter((gate): gate is ContractGate => gate !== null);
    const usable = evaluated.find((gate) => gate.status === 'usable');
    if (usable?.contractId) {
      allocations.push({
        ...(requirement.role ? { role: requirement.role } : {}),
        participantId: requirement.participantId,
        dataProductId: requirement.dataProductId,
        contractId: usable.contractId,
      });
      requirementGates.push({
        ...(requirement.role ? { role: requirement.role } : {}),
        participantId: requirement.participantId,
        dataProductId: requirement.dataProductId,
        state: 'ready',
        contractId: usable.contractId,
        contractStatus: usable.contractStatus,
      });
    } else if (evaluated.length > 0) {
      const mismatch = evaluated.find((gate) =>
        gate.reason?.includes('E_PURPOSE_MISMATCH'),
      );
      const failure = mismatch ?? evaluated[0]!;
      requirementGates.push({
        ...(requirement.role ? { role: requirement.role } : {}),
        participantId: requirement.participantId,
        dataProductId: requirement.dataProductId,
        state: mismatch ? 'purpose-mismatch' : 'not-usable',
        ...(failure.contractId ? { contractId: failure.contractId } : {}),
        ...(failure.reason ? { reason: failure.reason } : {}),
        ...(failure.fix ? { fix: failure.fix } : {}),
        ...(failure.contractStatus ? { contractStatus: failure.contractStatus } : {}),
      });
    } else {
      requirementGates.push({
        ...(requirement.role ? { role: requirement.role } : {}),
        participantId: requirement.participantId,
        dataProductId: requirement.dataProductId,
        state: 'missing',
        reason: `没有覆盖 ${requirement.participantId}/${requirement.dataProductId} 的生效合约`,
        fix: 'request_contract',
      });
    }
  }

  const notUsable = requirementGates.filter(
    (gate) => gate.state === 'not-usable' || gate.state === 'purpose-mismatch',
  );
  const missing = requirementGates.filter((gate) => gate.state === 'missing');
  if (notUsable.length > 0) {
    const mismatch = notUsable.find((gate) => gate.state === 'purpose-mismatch');
    const first = mismatch ?? notUsable[0]!;
    return {
      status: 'not-usable',
      ...(first.contractId ? { contractId: first.contractId } : {}),
      ...(first.contractStatus ? { contractStatus: first.contractStatus } : {}),
      reason:
        mismatch
          ? `E_PURPOSE_MISMATCH：${first.reason ?? '成员合约用途与场景不符'}`
          : (first.reason ?? '成员合约尚不可用'),
      ...(first.fix ? { fix: first.fix } : {}),
      requirementGates,
    };
  }
  if (missing.length > 0) {
    return {
      status: 'missing',
      reason: `缺少覆盖这些数据源的合约：${missing
        .map((gate) => `${gate.participantId}/${gate.dataProductId}`)
        .join('、')}（控制面：E_CONTRACT_MISSING）`,
      fix: 'request_contract',
      requirementGates,
    };
  }
  const contractIds = [...new Set(allocations.map((item) => item.contractId))];
  const byId = new Map(contracts.map((contract) => [contract.id, contract]));
  const bundleMembers = requirements
    .map((requirement) => {
      const allocation = allocations.find(
        (item) =>
          item.participantId === requirement.participantId &&
          item.dataProductId === requirement.dataProductId,
      );
      const contract = allocation ? byId.get(allocation.contractId) : undefined;
      if (!allocation || !contract || !requirement.role) return null;
      return {
        contractId: contract.id,
        participantId: requirement.participantId,
        dataProductId: requirement.dataProductId,
        role: requirement.role,
        status: contract.status,
        ...(contract.mdopStatus ? { mdopStatus: contract.mdopStatus } : {}),
        holderSigned: contract.holderSigned,
        platformCountersigned: true,
        validFrom: contract.validFrom ?? '1970-01-01T00:00:00.000Z',
        validUntil: contract.validUntil ?? new Date(0).toISOString(),
        purposeCode: contract.purposeCode ?? input.purpose ?? '',
        ...(contract.minCell !== undefined ? { minCell: contract.minCell } : {}),
        ...(contract.retentionDays !== undefined
          ? { retentionDays: contract.retentionDays }
          : {}),
        ...(contract.recipients ? { recipients: contract.recipients } : {}),
        ...(contract.allowedOperators
          ? { allowedOperators: contract.allowedOperators }
          : {}),
        stageBindings: [
          {
            stageId: 'extCtl',
            operators: [
              'rws.external-control@1.0.0',
              'declassify.small_cell@1.0.0',
            ],
            sourceRoles: [requirement.role],
          },
        ],
      };
    })
    .filter((member): member is NonNullable<typeof member> => member !== null);
  let contractBundle: ContractGate['contractBundle'];
  if (bundleMembers.length === requirements.length && input.purpose) {
    try {
      const bundle = buildContractBundle({
        purpose: input.purpose,
        studyRef: input.studyRef ?? input.purpose,
        members: bundleMembers,
      });
      contractBundle = {
        bundleId: bundle.bundleId,
        version: bundle.version,
        status: bundle.status,
      };
    } catch {
      // 两阶段提交时合法合约可能缺少可选策略字段；不把聚合失败升级成合约不可用。
    }
  }
  return {
    status: 'usable',
    contractId: contractIds[0],
    contractIds,
    allocations,
    contractStatus: 'active',
    requirementGates,
    contractBundle: contractBundle ?? { status: 'active' },
  };
}

/** 查本人可见合约并按数据源挑出可用合约。 */
export async function checkContractGate(
  api: MedTrustApiClient,
  token: string | undefined,
  input: ContractGateInput,
): Promise<ContractGate> {
  if (!token) {
    return { status: 'unknown', reason: '未带调用者凭证，合约可用性交由控制面判定' };
  }
  let contracts: ContractSummary[];
  try {
    contracts = await api.listContracts(token);
  } catch (error) {
    if (isAuthRejection(error)) {
      return { status: 'unknown', reason: `登录态已失效（控制面 ${httpStatus(error)}），请重新登录后再试` };
    }
    return { status: 'unknown', reason: `合约查询失败：${message(error)}` };
  }

  // 候选 = 「还有戏」的合约：生效中的，加上**申请中/待签发**的草稿。
  // 草稿必须进候选，否则用户刚提交的申请在 agent 眼里等于不存在（会看到"没有合约"，
  // 而控制面里明明躺着一份等签发的申请）——plan 4.4「可跟踪审批进度」就落不了地。
  const candidates = input.contractId
    ? contracts.filter((item) => item.id === input.contractId)
    : contracts.filter((item) => item.status === 'active' || item.status === 'draft');

  return evaluateContractSet(candidates, input);
}

export async function evaluatePrerequisites(
  api: MedTrustApiClient,
  params: { token?: string; spaceId: string; dataProductIds?: string[] } & ContractGateInput,
): Promise<ComplianceVerdict> {
  const membership = await checkMembership(api, params.token, params.spaceId);
  if (membership.status === 'no') {
    return {
      status: 'needs_permission',
      reason: membership.reason,
      membership,
      contract: { status: 'unknown' },
    };
  }

  // 两层判定，顺序固定：**先访问控制（能不能碰），再执行授权（以什么条款执行）**。
  // 产品级 ACL（D-ACL-1）不替代合约：ACL 过了仍要合约可用才放行。
  // 与合约同一套失败策略：明确拒绝才拦，查不动（unknown）不拦——查询故障 ≠ 无权限。
  const dataAccess = await checkDataAccess(
    api,
    params.token,
    params.dataProductIds,
    params.purpose,
  );
  if (dataAccess?.status === 'denied') {
    return {
      status: 'needs_data_access',
      reason: dataAccess.reason,
      fix: dataAccess.fix,
      membership,
      contract: { status: 'unknown' },
      dataAccess,
    };
  }
  const withAccess = dataAccess ? { dataAccess } : {};

  const contract = await checkContractGate(api, params.token, params);
  if (contract.status === 'unknown') {
    return { status: 'unknown', reason: contract.reason, membership, contract, ...withAccess };
  }
  if (contract.status !== 'usable') {
    return {
      status: 'needs_contract',
      reason: contract.reason,
      ...(contract.contractId ? { contractId: contract.contractId } : {}),
      ...(contract.contractIds ? { contractIds: contract.contractIds } : {}),
      ...(contract.fix ? { fix: contract.fix } : {}),
      membership,
      contract,
      ...(contract.contractBundle ? { contractBundle: contract.contractBundle } : {}),
      ...withAccess,
    };
  }

  return {
    status: 'ready',
    ...(contract.contractId ? { contractId: contract.contractId } : {}),
    ...(contract.contractIds ? { contractIds: contract.contractIds } : {}),
    membership,
    contract,
    ...(contract.contractBundle ? { contractBundle: contract.contractBundle } : {}),
    ...withAccess,
  };
}

const DATA_ACCESS_DENY_TEXT: Record<string, string> = {
  'no-grant': '这个数据产品还没有授权给你所在的参与方（产品级访问授权）',
  revoked: '这个数据产品的访问授权已被提供方回收',
  expired: '这个数据产品的访问授权已过期',
  'permission-missing': '访问授权里没有本次作业需要的权限（需要 compute）',
  'purpose-mismatch': '访问授权限定了用途，与本次作业的用途不符',
  'product-unknown': '控制面里找不到这个数据产品',
};

/**
 * 逐个数据产品问访问授权（`GET /data-access/check`，判定由控制面给出）。
 *
 * 返回 null 表示"没有数据产品入参"或"没带调用者凭证"——谈不上判定，**不拦**；
 * 查询失败（端点未部署 / 网络 / 5xx）返回 unknown，同样不拦（强制点在控制面）。
 */
export async function checkDataAccess(
  api: MedTrustApiClient,
  token: string | undefined,
  dataProductIds: string[] | undefined,
  purpose?: string,
): Promise<DataAccessGate | null> {
  const ids = (dataProductIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
  if (ids.length === 0 || !token) return null;

  for (const dataProductId of ids) {
    let result;
    try {
      result = await api.checkDataProductAccess(
        { dataProductId, permission: 'compute', ...(purpose ? { purpose } : {}) },
        { userId: '', spaceId: '', token },
      );
    } catch {
      return { status: 'unknown', dataProductId };
    }
    if (!result?.allowed) {
      const base =
        DATA_ACCESS_DENY_TEXT[result?.reason ?? ''] ??
        `访问授权判定未通过（${result?.reason ?? '未知原因'}）`;
      return {
        status: 'denied',
        dataProductId,
        reason: `${dataProductId}：${base}${
          result?.revokeReason ? `（回收原因：${result.revokeReason}）` : ''
        }`,
        fix: 'request_data_access',
      };
    }
  }
  return { status: 'allowed', dataProductId: ids[0] };
}

/**
 * 指定合约**本身**是否已可用（不看参与方覆盖）。
 *
 * 为什么传空 `participants`：`evaluateContract` 的覆盖判据是"每个参与方都在这份合约的两方里"，
 * 空集合下该判据**平凡成立**，于是这里问的正是"这一份合约自己是否满足准入五条"
 * （存在 → 持有方签名 → mdopStatus=active → 未过期 → 用途相符）。
 * 自动创建流程要用它轮询"院内连接器是否已经自动签了"。
 */
export async function isContractUsableById(
  api: MedTrustApiClient,
  token: string | undefined,
  contractId: string,
  purpose?: string,
): Promise<boolean> {
  const gate = await checkContractGate(api, token, {
    participants: [],
    contractId,
    ...(purpose ? { purpose } : {}),
  });
  return gate.status === 'usable';
}

/**
 * 从提交载荷里收集参与方 id（深度受限地扫 `participantId` 字段）。
 *
 * 不用每个场景各写一遍：场景载荷形状不同（direct 用 trial/controls，template 用
 * participants 数组），但"要哪些参与方"这件事在 schema 上是一致的。
 */
export function collectParticipants(input: unknown, maxDepth = 5): string[] {
  const found = new Set<string>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > maxDepth || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'participantId' && typeof value === 'string' && value.trim()) {
        found.add(value.trim());
      } else {
        walk(value, depth + 1);
      }
    }
  };
  walk(input, 0);
  return [...found];
}

/** 提交载荷里的 purpose（控制面就是拿它跟合约的 purposeCode 比对）。 */
export function submissionPurpose(submission: {
  payload?: unknown;
  templateInput?: unknown;
}): string | undefined {
  for (const source of [submission.payload, submission.templateInput]) {
    if (source === null || typeof source !== 'object' || Array.isArray(source)) continue;
    const purpose = (source as Record<string, unknown>).purpose;
    if (typeof purpose === 'string' && purpose.trim()) return purpose.trim();
  }
  return undefined;
}

/**
 * 从提交载荷里收集数据产品 id（与 `collectParticipants` 同法，深度受限）。
 *
 * 场景载荷形状不同：direct 用 `trialDataProduct` 这类**以 DataProduct 结尾**的字段，
 * template 用 `dataProducts` 数组/字符串。合约申请要的正是这个 id，
 * 少了它就只能让用户再填一次——所以这里按"字段名后缀 + 数组元素"两种形态收。
 */
export function collectDataProducts(input: unknown, maxDepth = 5): string[] {
  const found = new Set<string>();
  const push = (value: unknown): void => {
    if (typeof value !== 'string') return;
    // 多值字段是逗号分隔的（Card 协议没有多选，见 scenarios.directoryHelp）
    for (const part of value.split(/[,，\n]/)) {
      const id = part.trim();
      if (id) found.add(id);
    }
  };
  /** 命中数据产品字段后的取值形态：字符串 / 多值串 / 数组 / 嵌套对象（取里面的 id）。 */
  const collect = (value: unknown, depth: number): void => {
    if (typeof value === 'string') {
      push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item, depth);
      return;
    }
    if (typeof value === 'object' && value !== null && depth <= maxDepth) {
      walk(value, depth);
    }
  };
  const walk = (node: unknown, depth: number): void => {
    if (depth > maxDepth || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      // **不**收数组里的裸字符串：只有挂在"数据产品字段"下的才算，
      // 否则 `contracts: ['ct-1']` 这种治理字段会被误当成数据产品 id。
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (lower === 'dataproductid' || lower === 'dataproducts' || lower.endsWith('dataproduct')) {
        collect(value, depth + 1);
      } else {
        walk(value, depth + 1);
      }
    }
  };
  walk(input, 0);
  return [...found];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 合约申请的**默认条款**（agent 侧的唯一来源）。
 *
 * 取值取控制面能接受的最保守那一档：输出只给聚合统计（`aggregate_only` 最安全），
 * 留存按最短的"阅后即焚"，有效期 30 天（plan 的决策 2）。用户要更宽的条款，
 * 应在申请卡上改，而不是让默认值悄悄放宽。
 */
export const DEFAULT_CONTRACT_RETENTION = '阅后即焚';
export const DEFAULT_CONTRACT_OUTPUT = '仅聚合统计';
export const DEFAULT_CONTRACT_VALID_DAYS = 30;

/** 组装 `request_contract` 的默认入参（卡片回灌的就是这一份）。 */
export function defaultContractRequest(input: {
  dataProductId: string;
  purpose: string;
  retention?: string;
  output?: string;
  validDays?: number;
  compositionId?: string;
  minCell?: number;
}): Record<string, unknown> {
  return {
    dataProductId: input.dataProductId,
    purpose: input.purpose,
    retention: input.retention ?? DEFAULT_CONTRACT_RETENTION,
    output: input.output ?? DEFAULT_CONTRACT_OUTPUT,
    validDays: input.validDays ?? DEFAULT_CONTRACT_VALID_DAYS,
    ...(input.compositionId ? { compositionId: input.compositionId } : {}),
    ...(input.minCell ? { minCell: input.minCell } : {}),
  };
}

/**
 * HTTP 状态 → 判定是否属于「确定性鉴权拒绝」（401/403）。

 *
 * 与网络/5xx 的区别很关键：后者是"查不动"（unknown，不拦，交给控制面兜底），
 * 前者是"这份凭证被拒"（拦，并让用户重新登录）——否则会带着坏 token 去提交，
 * 用户只在最后一步看到 401（本缺陷的实际表现）。
 */
function httpStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

function isAuthRejection(error: unknown): boolean {
  const status = httpStatus(error);
  return status === 401 || status === 403;
}
