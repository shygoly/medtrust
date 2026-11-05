/**
 * 使用控制策略引擎（NDI-TR-2025-05 §6.2.4 / §6.3.5；TC609-6-2025-15）。
 *
 * 范围（step 1，engine v1）：
 * - 策略 JSON 的严格解析（语法 + 语义）；
 * - 冲突检测（同一主体/客体/动作既 allow 又 deny）；
 * - **四态**决策：ALLOW / ALLOW_WITH_OBLIGATIONS / DENY / DEFAULT_DENY；
 * - 义务事项**有序**执行（失败即降级为拒绝）；
 * - 旧合约→策略的默认翻译（legacy 语义，绝不落到 DEFAULT_DENY）。
 *
 * 不在本期：策略模板管理、跨合约预算账本、水印实现（留接口）。
 */

export type UsageAction = "read" | "compute" | "export";
export type UsageEffect = "allow" | "deny";
export type UsageDecision =
  | "ALLOW"
  | "ALLOW_WITH_OBLIGATIONS"
  | "DENY"
  | "DEFAULT_DENY";

export type ObligationKind = "delete-after-use" | "notify-provider" | "watermark";

export interface UsageObligation {
  kind: ObligationKind;
  params?: Record<string, unknown>;
}

export interface UsageConstraints {
  purposes?: string[];
  notBefore?: string;
  notAfter?: string;
  maxUses?: number;
  environment?: "software" | "hardware";
}

export interface UsageGrant {
  effect: UsageEffect;
  subject: string;
  object: string;
  action: UsageAction;
  constraints?: UsageConstraints;
  obligations?: UsageObligation[];
}

export interface UsagePolicy {
  version: 1;
  id: string;
  grants: UsageGrant[];
}

export interface UsageRequest {
  subject: string;
  object: string;
  action: UsageAction;
  purpose?: string;
  /** 已使用次数（含本次），用于 maxUses 约束。 */
  uses?: number;
  environment?: "software" | "hardware";
  now: number;
}

export interface UsageEvaluation {
  decision: UsageDecision;
  reason: string;
  /** 命中策略的 id + 序号，便于审计回溯。 */
  matched?: { policyId: string; grantIndex: number };
  obligations: UsageObligation[];
}

export class UsagePolicyError extends Error {
  constructor(
    readonly code:
      | "USAGE_POLICY_INVALID"
      | "USAGE_POLICY_CONFLICT"
      | "USAGE_OBLIGATION_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "UsagePolicyError";
  }
}

const ACTIONS: UsageAction[] = ["read", "compute", "export"];
const EFFECTS: UsageEffect[] = ["allow", "deny"];
const OBLIGATION_KINDS: ObligationKind[] = [
  "delete-after-use",
  "notify-provider",
  "watermark",
];

/** 严格解析：任何未定义字段/取值都拒绝（fail-closed），不做容错猜测。 */
export function parseUsagePolicy(raw: unknown): UsagePolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new UsagePolicyError("USAGE_POLICY_INVALID", "策略必须是对象");
  const input = raw as Record<string, unknown>;
  if (input.version !== 1)
    throw new UsagePolicyError("USAGE_POLICY_INVALID", "只支持策略 version=1");
  if (typeof input.id !== "string" || !input.id.trim())
    throw new UsagePolicyError("USAGE_POLICY_INVALID", "策略 id 不能为空");
  if (!Array.isArray(input.grants) || input.grants.length === 0)
    throw new UsagePolicyError("USAGE_POLICY_INVALID", "策略 grants 不能为空");

  const grants = input.grants.map((item, index) => parseGrant(item, index));
  const conflicts = detectConflicts({ version: 1, id: input.id, grants });
  if (conflicts.length > 0)
    throw new UsagePolicyError(
      "USAGE_POLICY_CONFLICT",
      `策略存在冲突：${conflicts.join("; ")}`,
    );
  return { version: 1, id: input.id, grants };
}

function parseGrant(raw: unknown, index: number): UsageGrant {
  const at = `grants[${index}]`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new UsagePolicyError("USAGE_POLICY_INVALID", `${at} 必须是对象`);
  const input = raw as Record<string, unknown>;
  if (!EFFECTS.includes(input.effect as UsageEffect))
    throw new UsagePolicyError("USAGE_POLICY_INVALID", `${at}.effect 只能是 allow/deny`);
  for (const key of ["subject", "object"] as const) {
    if (typeof input[key] !== "string" || !(input[key] as string).trim())
      throw new UsagePolicyError("USAGE_POLICY_INVALID", `${at}.${key} 不能为空`);
  }
  if (!ACTIONS.includes(input.action as UsageAction))
    throw new UsagePolicyError("USAGE_POLICY_INVALID", `${at}.action 非法`);

  const grant: UsageGrant = {
    effect: input.effect as UsageEffect,
    subject: (input.subject as string).trim(),
    object: (input.object as string).trim(),
    action: input.action as UsageAction,
  };

  if (input.constraints !== undefined) {
    const c = input.constraints as Record<string, unknown>;
    if (!c || typeof c !== "object" || Array.isArray(c))
      throw new UsagePolicyError("USAGE_POLICY_INVALID", `${at}.constraints 必须是对象`);
    const constraints: UsageConstraints = {};
    if (c.purposes !== undefined) {
      if (!Array.isArray(c.purposes) || c.purposes.some((p) => typeof p !== "string"))
        throw new UsagePolicyError("USAGE_POLICY_INVALID", `${at}.constraints.purposes 非法`);
      constraints.purposes = (c.purposes as string[]).map((p) => p.trim()).filter(Boolean);
    }
    for (const key of ["notBefore", "notAfter"] as const) {
      if (c[key] !== undefined) {
        const value = c[key];
        if (typeof value !== "string" || Number.isNaN(new Date(value).getTime()))
          throw new UsagePolicyError("USAGE_POLICY_INVALID", `${at}.constraints.${key} 必须是时间`);
        constraints[key] = value;
      }
    }
    if (c.maxUses !== undefined) {
      if (!Number.isInteger(c.maxUses) || (c.maxUses as number) <= 0)
        throw new UsagePolicyError("USAGE_POLICY_INVALID", `${at}.constraints.maxUses 必须是正整数`);
      constraints.maxUses = c.maxUses as number;
    }
    if (c.environment !== undefined) {
      if (c.environment !== "software" && c.environment !== "hardware")
        throw new UsagePolicyError("USAGE_POLICY_INVALID", `${at}.constraints.environment 非法`);
      constraints.environment = c.environment;
    }
    if (Object.keys(constraints).length > 0) grant.constraints = constraints;
  }

  if (input.obligations !== undefined) {
    if (!Array.isArray(input.obligations))
      throw new UsagePolicyError("USAGE_POLICY_INVALID", `${at}.obligations 必须是数组`);
    grant.obligations = input.obligations.map((item, i) => {
      const o = item as Record<string, unknown>;
      if (!o || typeof o !== "object" || !OBLIGATION_KINDS.includes(o.kind as ObligationKind))
        throw new UsagePolicyError(
          "USAGE_POLICY_INVALID",
          `${at}.obligations[${i}].kind 非法`,
        );
      return {
        kind: o.kind as ObligationKind,
        ...(o.params && typeof o.params === "object"
          ? { params: o.params as Record<string, unknown> }
          : {}),
      };
    });
  }
  return grant;
}

/** 冲突检测：同一 (subject, object, action) 既 allow 又 deny。 */
export function detectConflicts(policy: UsagePolicy): string[] {
  const seen = new Map<string, UsageEffect>();
  const conflicts: string[] = [];
  for (const grant of policy.grants) {
    const key = `${grant.subject}|${grant.object}|${grant.action}`;
    const previous = seen.get(key);
    if (previous && previous !== grant.effect)
      conflicts.push(`${key} 同时存在 ${previous} 与 ${grant.effect}`);
    else seen.set(key, grant.effect);
  }
  return conflicts;
}

function constraintsPass(
  constraints: UsageConstraints | undefined,
  request: UsageRequest,
): boolean {
  if (!constraints) return true;
  if (constraints.purposes?.length) {
    if (!request.purpose || !constraints.purposes.includes(request.purpose)) return false;
  }
  if (constraints.notAfter && request.now > new Date(constraints.notAfter).getTime())
    return false;
  if (constraints.notBefore && request.now < new Date(constraints.notBefore).getTime())
    return false;
  if (constraints.maxUses !== undefined && (request.uses ?? 0) > constraints.maxUses)
    return false;
  if (constraints.environment && request.environment !== constraints.environment)
    return false;
  return true;
}

/** 四态决策：无匹配 → DEFAULT_DENY；有 deny 匹配 → DENY；有义务 → ALLOW_WITH_OBLIGATIONS。 */
export function decide(policy: UsagePolicy, request: UsageRequest): UsageEvaluation {
  const matches = policy.grants
    .map((grant, index) => ({ grant, index }))
    .filter(
      ({ grant }) =>
        grant.subject === request.subject &&
        grant.object === request.object &&
        grant.action === request.action,
    );

  if (matches.length === 0)
    return { decision: "DEFAULT_DENY", reason: "无匹配策略（默认拒绝）", obligations: [] };

  const denied = matches.find(({ grant }) => grant.effect === "deny");
  if (denied)
    return {
      decision: "DENY",
      reason: "命中拒绝策略",
      matched: { policyId: policy.id, grantIndex: denied.index },
      obligations: [],
    };

  const allowed = matches.filter(({ grant }) => constraintsPass(grant.constraints, request));
  if (allowed.length === 0)
    return { decision: "DENY", reason: "约束条件不满足", obligations: [] };

  const withObligations = allowed.find(({ grant }) => (grant.obligations ?? []).length > 0);
  const chosen = withObligations ?? allowed[0];
  const obligations = chosen.grant.obligations ?? [];
  return {
    decision: obligations.length > 0 ? "ALLOW_WITH_OBLIGATIONS" : "ALLOW",
    reason: obligations.length > 0 ? "允许，但须先履行义务事项" : "允许",
    matched: { policyId: policy.id, grantIndex: chosen.index },
    obligations: [...obligations],
  };
}

export type ObligationHandler = (
  obligation: UsageObligation,
  request: UsageRequest,
) => Promise<void> | void;

export interface ObligationRunResult {
  ok: boolean;
  executed: ObligationKind[];
  failedAt?: ObligationKind;
  error?: string;
}

/**
 * 义务事项**按声明顺序**执行；任一失败即中断，调用方必须把本次判定降级为 DENY。
 */
export async function runObligations(
  obligations: readonly UsageObligation[],
  request: UsageRequest,
  handlers: Partial<Record<ObligationKind, ObligationHandler>>,
): Promise<ObligationRunResult> {
  const executed: ObligationKind[] = [];
  for (const obligation of obligations) {
    const handler = handlers[obligation.kind];
    if (!handler)
      return {
        ok: false,
        executed,
        failedAt: obligation.kind,
        error: `未注册义务处理器：${obligation.kind}`,
      };
    try {
      await handler(obligation, request);
      executed.push(obligation.kind);
    } catch (err) {
      return {
        ok: false,
        executed,
        failedAt: obligation.kind,
        error: (err as Error).message,
      };
    }
  }
  return { ok: true, executed };
}
