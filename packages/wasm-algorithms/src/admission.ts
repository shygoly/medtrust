// third-party-module-admission —— 准入域词汇与不变量（D-CN-5 / P-CTL-7）。
//
// 两层准入，**不设 Tier C**：合约固定的 SM3 必须由平台从提交源码复现产出，
// 于是不透明二进制**结构性地**无法入册（复现不出 SM3 就签不了、固定不了），
// 而不是靠一条「政策上拒绝」的软规则。

/** 准入层级。A = 平台自研源码；B = 第三方交源码、平台复现构建 + 审查。 */
export type AdmissionTier = "A" | "B";

export const ADMISSION_TIERS: readonly AdmissionTier[] = ["A", "B"] as const;

export function isAdmissionTier(v: unknown): v is AdmissionTier {
  return v === "A" || v === "B";
}

/** 源码语言白名单：只收 Rust 与 AssemblyScript（D-CN-5 / design D2）。 */
export type SourceLanguage = "rust" | "assemblyscript";

export const SOURCE_LANGUAGES: readonly SourceLanguage[] = [
  "rust",
  "assemblyscript",
] as const;

export function isSourceLanguage(v: unknown): v is SourceLanguage {
  return v === "rust" || v === "assemblyscript";
}

/** 准入流转状态（闸 2 → 闸 3 → 闸 4 → 生产；任何一步可 revoked）。 */
export type AdmissionStatus =
  | "submitted" // 源码已提交，尚未复现构建
  | "built" // 复现构建一致 + 平台签名，尚未过动态测试
  | "tested" // 闸 3 动态测试全过
  | "shadow" // 闸 4 影子发布中（只算不发结果）
  | "canary" // 影子干净，灰度中
  | "active" // 全量生产
  | "rejected" // 任一闸不过
  | "revoked"; // 已吊销

export const ADMISSION_STATUSES: readonly AdmissionStatus[] = [
  "submitted",
  "built",
  "tested",
  "shadow",
  "canary",
  "active",
  "rejected",
  "revoked",
] as const;

export function isAdmissionStatus(v: unknown): v is AdmissionStatus {
  return (ADMISSION_STATUSES as readonly string[]).includes(v as string);
}

/**
 * 晋级顺序：不得跳闸。`rejected` / `revoked` 是终态（重新提交要走新记录）。
 * 影子不过不晋级（闸 4）。
 */
const NEXT_STATUS: Record<AdmissionStatus, readonly AdmissionStatus[]> = {
  submitted: ["built", "rejected"],
  built: ["tested", "rejected", "revoked"],
  tested: ["shadow", "rejected", "revoked"],
  shadow: ["canary", "rejected", "revoked"],
  canary: ["active", "rejected", "revoked"],
  active: ["revoked"],
  rejected: [],
  revoked: [],
};

export function canPromote(
  from: AdmissionStatus,
  to: AdmissionStatus,
): boolean {
  return NEXT_STATUS[from].includes(to);
}

/** 可被连接器实际执行的状态：影子只算不发，故不在此列（由宿主另行判定）。 */
export function isRunnableStatus(status: AdmissionStatus): boolean {
  return status === "shadow" || status === "canary" || status === "active";
}

/** 结果可释放给消费方的状态：影子 MUST NOT 释放（闸 4）。 */
export function isReleasableStatus(status: AdmissionStatus): boolean {
  return status === "canary" || status === "active";
}

/**
 * 平台审查背书 —— 对医院公开的那一半。
 * 「要源码」不等于「要开源」（design D6）：源码可 NDA 保密，医院只看到
 * 模块 SM3 + 这份背书。
 */
export interface ReviewAttestation {
  /** 审查者标识（平台侧审查人/团队）。 */
  reviewer: string;
  /** 审查完成时间（ISO）。 */
  reviewedAt: string;
  /** 复现构建证明引用（构建记录 id / 双构建器 SM3 一致的凭据）。 */
  reproducibleBuildRef: string;
  /** 源码是否走保密通道（true = 不对外公开源码，仅公开 SM3 + 本背书）。 */
  confidential: boolean;
  /** 平台 CA 对 `模块 SM3` 的 SM2 签名（与模块分发签名同一份）。 */
  signature?: string;
}

export function isReviewAttestation(v: unknown): v is ReviewAttestation {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.reviewer === "string" &&
    r.reviewer.trim().length > 0 &&
    typeof r.reviewedAt === "string" &&
    r.reviewedAt.trim().length > 0 &&
    typeof r.reproducibleBuildRef === "string" &&
    r.reproducibleBuildRef.trim().length > 0 &&
    typeof r.confidential === "boolean"
  );
}

/**
 * 合约固定模块条款：SM3 + 准入层级 + 平台审查背书，三者缺一不可。
 * 「不得固定一个来路不明的模块」—— 缺层级或背书视为无效（digital-contract 增量）。
 */
export interface PinnedModuleClause {
  sm3: string;
  tier: AdmissionTier;
  review: ReviewAttestation;
}

export type PinnedModuleSpec = string | PinnedModuleClause;

/** 旧口径（纯 SM3 字符串）与新口径（带层级 + 背书）的判别。 */
export function isPinnedModuleClause(v: unknown): v is PinnedModuleClause {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.sm3 === "string" &&
    isAdmissionTier(c.tier) &&
    isReviewAttestation(c.review)
  );
}

export function pinnedModuleSm3(spec: PinnedModuleSpec): string {
  return (typeof spec === "string" ? spec : spec.sm3).toLowerCase();
}

/**
 * 固定模块条款的合法性。返回 null = 合法，否则返回拒绝原因。
 *
 * 迁移期：纯字符串（旧合约固定的平台自研模块）按 Tier A 视为合法 —— 平台自研
 * 模块的「背书」就是它本来就走平台工具链构建 + 平台 CA 签名。第三方模块
 * （Tier B）**必须**带完整条款，否则合约拒绝生成。
 */
export function validatePinnedModuleClause(
  analysisType: string,
  spec: unknown,
): string | null {
  if (typeof spec === "string") {
    return /^[0-9a-f]{64}$/i.test(spec)
      ? null
      : `固定模块 ${analysisType} 的 SM3 非法（须 64 hex）`;
  }
  if (!spec || typeof spec !== "object") {
    return `固定模块 ${analysisType} 条款格式非法`;
  }
  const c = spec as Record<string, unknown>;
  if (typeof c.sm3 !== "string" || !/^[0-9a-f]{64}$/i.test(c.sm3)) {
    return `固定模块 ${analysisType} 的 SM3 非法（须 64 hex）`;
  }
  if (!isAdmissionTier(c.tier)) {
    return `固定模块 ${analysisType} 缺少准入层级（A / B）——不得固定来路不明的模块`;
  }
  if (!isReviewAttestation(c.review)) {
    return `固定模块 ${analysisType} 缺少平台审查背书（reviewer / reviewedAt / reproducibleBuildRef / confidential）`;
  }
  return null;
}

/** 对医院公开的模块视图：源码永不出现在这里（design D6）。 */
export interface PublicModuleView {
  analysisType: string;
  sm3: string;
  tier: AdmissionTier;
  language: SourceLanguage;
  status: AdmissionStatus;
  review: Omit<ReviewAttestation, "signature"> & { signature?: string };
}
