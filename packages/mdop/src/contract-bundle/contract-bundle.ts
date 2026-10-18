import { canonicalSm3 } from "../crypto/sm3";
import type { LogicalPlan, LogicalStage } from "../schema/plan";

/**
 * ContractBundle：多成员数字合约的版本化治理快照。
 *
 * Bundle 不是新的签名主体；签名、用途和数据产品授权仍以成员合约及其本地副本为准。
 * 这里只做确定性聚合，保证平台、连接器和审计看到同一组策略。
 */

export const CONTRACT_BUNDLE_VERSION = "contract-bundle/v1";

export type BundleMemberStatus =
  | "draft"
  | "partially_active"
  | "active"
  | "expired"
  | "revoked"
  | "terminated";

export type TeePolicy = "none" | "software" | "hardware";

export interface ContractBundleStageBinding {
  /** 逻辑阶段或物理阶段的稳定 id。 */
  stageId: string;
  /** 该阶段可使用的算子引用。 */
  operators: string[];
  /** 该阶段允许访问的数据源角色。 */
  sourceRoles: string[];
}

export interface ContractBundleMemberFact {
  contractId: string;
  participantId: string;
  dataProductId: string;
  role: string;
  status: string;
  mdopStatus?: string;
  holderSigned?: boolean;
  platformCountersigned?: boolean;
  validFrom?: string;
  validUntil: string;
  purposeCode: string;
  minCell?: number;
  retentionDays?: number;
  rareConditionMaxPrevalence?: number;
  teePolicy?: TeePolicy;
  recipients?: string[];
  allowedOperators?: string[];
  stageBindings?: ContractBundleStageBinding[];
  revokedAt?: string;
  terminatedAt?: string;
}

export interface ContractBundleEffectivePolicy {
  /** 所有成员都允许的时间窗（交集）。 */
  validFrom: string;
  validUntil: string;
  /** 更严格的发布阈值。 */
  minCell: number;
  /** 更短的留存期。 */
  retentionDays?: number;
  /** 更低（更严格）的罕见病患病率阈值。 */
  rareConditionMaxPrevalence?: number;
  /** 最严格的 TEE 等级。 */
  teePolicy: TeePolicy;
  /** 组合结果接收方（交集，不含并集）。 */
  recipients: string[];
  /** 按阶段保留成员授权，禁止压成一个全局并集。 */
  allowedOperatorsByStage: Record<string, string[]>;
  sourceRolesByStage: Record<string, string[]>;
}

export interface ContractBundleMember extends ContractBundleMemberFact {
  effectiveStatus: BundleMemberStatus;
}

export interface ContractBundle {
  apiVersion: typeof CONTRACT_BUNDLE_VERSION;
  bundleId: string;
  /** 成员合约条款的快照版本；成员续签或条款变化会生成新版本。 */
  version: string;
  purpose: string;
  studyRef: string;
  members: ContractBundleMember[];
  effectivePolicySnapshot: ContractBundleEffectivePolicy;
  status: BundleMemberStatus;
  createdAt: string;
  frozenAt: string;
}

export interface BuildContractBundleInput {
  purpose: string;
  studyRef: string;
  members: ContractBundleMemberFact[];
  createdAt?: string;
  frozenAt?: string;
}

const TEE_STRICTNESS: Record<TeePolicy, number> = {
  none: 0,
  software: 1,
  hardware: 2,
};

function iso(value: string | undefined, path: string): number {
  if (!value) throw new Error(`${path} 缺少 RFC3339 时间`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${path} 不是 RFC3339 时间`);
  return parsed;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function memberStatus(member: ContractBundleMemberFact, now: Date): BundleMemberStatus {
  if (member.status === "revoked" || member.revokedAt) return "revoked";
  if (member.status === "terminated" || member.mdopStatus === "terminated" || member.terminatedAt)
    return "terminated";
  if (iso(member.validUntil, "member.validUntil") < now.getTime()) return "expired";
  const signed = member.holderSigned === true && member.platformCountersigned !== false;
  if (member.mdopStatus !== "active" || !signed) return "draft";
  return "active";
}

function bundleStatus(members: ContractBundleMember[], now: Date): BundleMemberStatus {
  if (members.some((member) => member.effectiveStatus === "terminated")) return "terminated";
  if (members.some((member) => member.effectiveStatus === "revoked")) return "revoked";
  if (members.every((member) => member.effectiveStatus === "expired")) return "expired";
  if (members.every((member) => member.effectiveStatus === "active")) return "active";
  if (
    members.some(
      (member) =>
        member.effectiveStatus === "active" || member.effectiveStatus === "expired",
    )
  )
    return "partially_active";
  if (members.some((member) => member.effectiveStatus === "expired")) return "partially_active";
  return "draft";
}

function combineStageBindings(members: ContractBundleMember[]): {
  allowedOperatorsByStage: Record<string, string[]>;
  sourceRolesByStage: Record<string, string[]>;
} {
  const operators = new Map<string, string[]>();
  const sourceRoles = new Map<string, string[]>();
  for (const member of members) {
    const bindings = member.stageBindings ?? [];
    for (const binding of bindings) {
      const stageOperators = operators.get(binding.stageId) ?? [];
      const stageRoles = sourceRoles.get(binding.stageId) ?? [];
      operators.set(binding.stageId, [...stageOperators, ...binding.operators]);
      sourceRoles.set(binding.stageId, [...stageRoles, ...binding.sourceRoles]);
    }
  }
  return {
    allowedOperatorsByStage: Object.fromEntries(
      [...operators.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([stage, values]) => [stage, sortedUnique(values)]),
    ),
    sourceRolesByStage: Object.fromEntries(
      [...sourceRoles.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([stage, values]) => [stage, sortedUnique(values)]),
    ),
  };
}

/**
 * 从成员合约派生 bundle。有效期取交集、minCell 取最大、TEE 取最严格、
 * 留存取最短、罕见病阈值取最低、接收方取交集。
 */
export function buildContractBundle(input: BuildContractBundleInput): ContractBundle {
  if (!input.purpose.trim()) throw new Error("ContractBundle.purpose 不能为空");
  if (!input.studyRef.trim()) throw new Error("ContractBundle.studyRef 不能为空");
  if (input.members.length === 0) throw new Error("ContractBundle 至少需要一个成员合约");
  const ids = input.members.map((member) => member.contractId);
  if (new Set(ids).size !== ids.length) throw new Error("ContractBundle 成员合约不得重复");

  const now = new Date();
  const members: ContractBundleMember[] = input.members
    .map((member) => {
      if (member.purposeCode !== input.purpose)
        throw new Error(
          `成员合约 ${member.contractId} 的用途 ${member.purposeCode} 与 bundle 用途 ${input.purpose} 不符`,
        );
      return { ...member, effectiveStatus: memberStatus(member, now) };
    })
    .sort((a, b) => `${a.role}:${a.contractId}`.localeCompare(`${b.role}:${b.contractId}`));

  const starts = members.map((member) => iso(member.validFrom, "member.validFrom"));
  const ends = members.map((member) => iso(member.validUntil, "member.validUntil"));
  const recipientSets = members.map((member) => new Set(member.recipients ?? []));
  const commonRecipients =
    recipientSets.length === 0
      ? []
      : [...recipientSets[0]!.values()].filter((recipient) =>
          recipientSets.every((set) => set.has(recipient)),
        );
  const stagePolicies = combineStageBindings(members);

  const minCells = members
    .map((member) => member.minCell)
    .filter((value): value is number => value !== undefined);
  const retentionDays = members
    .map((member) => member.retentionDays)
    .filter((value): value is number => value !== undefined);
  const rareThresholds = members
    .map((member) => member.rareConditionMaxPrevalence)
    .filter((value): value is number => value !== undefined);
  const teePolicies = members.map((member) => member.teePolicy ?? "none");
  const strictestTee = teePolicies.reduce<TeePolicy>(
    (strictest, current) =>
      TEE_STRICTNESS[current] > TEE_STRICTNESS[strictest] ? current : strictest,
    "none",
  );

  const version = canonicalSm3({
    apiVersion: CONTRACT_BUNDLE_VERSION,
    purpose: input.purpose,
    studyRef: input.studyRef,
    members: members.map((member) => ({
      contractId: member.contractId,
      participantId: member.participantId,
      dataProductId: member.dataProductId,
      role: member.role,
      validFrom: member.validFrom,
      validUntil: member.validUntil,
      purposeCode: member.purposeCode,
      minCell: member.minCell ?? null,
      retentionDays: member.retentionDays ?? null,
      rareConditionMaxPrevalence: member.rareConditionMaxPrevalence ?? null,
      teePolicy: member.teePolicy ?? "none",
      recipients: sortedUnique(member.recipients ?? []),
      allowedOperators: sortedUnique(member.allowedOperators ?? []),
      stageBindings: member.stageBindings ?? [],
    })),
  });
  const createdAt = input.createdAt ?? now.toISOString();
  const frozenAt = input.frozenAt ?? createdAt;
  const bundleId = `bundle-${canonicalSm3({
    purpose: input.purpose,
    studyRef: input.studyRef,
    roles: members.map((member) => `${member.role}:${member.participantId}:${member.dataProductId}`),
  }).slice(5, 21)}`;

  return {
    apiVersion: CONTRACT_BUNDLE_VERSION,
    bundleId,
    version,
    purpose: input.purpose,
    studyRef: input.studyRef,
    members,
    effectivePolicySnapshot: {
      validFrom: new Date(Math.max(...starts)).toISOString(),
      validUntil: new Date(Math.min(...ends)).toISOString(),
      minCell: minCells.length > 0 ? Math.max(...minCells) : 1,
      ...(retentionDays.length > 0 ? { retentionDays: Math.min(...retentionDays) } : {}),
      ...(rareThresholds.length > 0
        ? { rareConditionMaxPrevalence: Math.min(...rareThresholds) }
        : {}),
      teePolicy: strictestTee,
      recipients: sortedUnique(commonRecipients),
      ...stagePolicies,
    },
    status: bundleStatus(members, now),
    createdAt,
    frozenAt,
  };
}

export interface BundleNodeCheckInput {
  fragmentStages: LogicalStage[];
  involvedRoles: string[];
  now?: Date;
}

/** 节点执行前复核：每个片段涉及的数据源、算子与组合策略都必须有成员覆盖。 */
export function assertBundleCoversNode(
  bundle: ContractBundle,
  input: BundleNodeCheckInput,
): void {
  const now = input.now ?? new Date();
  if (bundle.status !== "active")
    throw new Error(`ContractBundle ${bundle.bundleId} 状态为 ${bundle.status}，禁止执行`);
  if (Date.parse(bundle.effectivePolicySnapshot.validFrom) > now.getTime())
    throw new Error(`ContractBundle ${bundle.bundleId} 尚未生效`);
  if (Date.parse(bundle.effectivePolicySnapshot.validUntil) < now.getTime())
    throw new Error(`ContractBundle ${bundle.bundleId} 已过期`);

  for (const role of input.involvedRoles) {
    if (!bundle.members.some((member) => member.role === role && member.effectiveStatus === "active"))
      throw new Error(`片段缺少角色 ${role} 的有效成员合约`);
  }

  for (const stage of input.fragmentStages) {
    const allowed = bundle.effectivePolicySnapshot.allowedOperatorsByStage[stage.id];
    if (allowed && !allowed.includes(stage.op))
      throw new Error(`阶段 ${stage.id} 的算子 ${stage.op} 不在成员合约授权内`);
  }
}

/** 审计用可读摘要：让审阅者逐项看到角色、成员、阶段和组合策略。 */
export function explainContractBundle(bundle: ContractBundle): string[] {
  const lines = [
    `bundle ${bundle.bundleId} ${bundle.version} / ${bundle.status}`,
    `purpose=${bundle.purpose} study=${bundle.studyRef}`,
    `window=${bundle.effectivePolicySnapshot.validFrom}..${bundle.effectivePolicySnapshot.validUntil}`,
    `minCell=${bundle.effectivePolicySnapshot.minCell} tee=${bundle.effectivePolicySnapshot.teePolicy}`,
    `recipients=${bundle.effectivePolicySnapshot.recipients.join(",") || "(empty)"}`,
  ];
  for (const member of bundle.members) {
    lines.push(
      `${member.role}: ${member.participantId}/${member.dataProductId} -> ${member.contractId} (${member.effectiveStatus})`,
    );
  }
  for (const [stage, operators] of Object.entries(
    bundle.effectivePolicySnapshot.allowedOperatorsByStage,
  )) {
    lines.push(`stage ${stage}: ${operators.join(",") || "(none)"}`);
  }
  return lines;
}
