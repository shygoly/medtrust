import {
  SchemaError,
  asObject,
  checkKeys,
  optObject,
  reqNumber,
  reqString,
  reqTimestamp,
} from "./strict";

/**
 * **发布审查清单**：C3 载荷里随行的「这次出域经过了什么」的汇总（任务 7.3b）。
 *
 * 为什么需要它：C2 让申请方获得「对一个可解密环境提问」的能力，出域的不只是数字，
 * 还有**这次发布是怎么被审查过的**——抑制了多少格、有没有加噪、查询预算花了多少。
 * 没有这份清单，控制台只能看到结果，看不到约束是否真的生效。
 *
 * 与「抑制明细不出域」的关系（§3.6 的既有决定）：本清单只带**汇总数**，
 * **逐格明细仍留在节点本地审查记录与审计回执里**。两者不冲突：
 * 载荷里被抑制的格子本来就已经归零（申请方看得出哪里被抑制），汇总数不额外泄露「具体哪一格」。
 *
 * 形态刻意做得很小：能被严格解析（未知字段即拒），并且能跨持有方**合并**（见 `mergeReleaseManifests`）。
 */

export const RELEASE_MANIFEST_KEY = "release_manifest";
export const RELEASE_MANIFEST_API_VERSION = "mdop.release/1.0" as const;

export type DpDeclaration = { mode: "none" } | { mode: "epsilon"; epsilon: number };

export interface BudgetUsageView {
  dataset: string;
  snapshot: string;
  unit: "epsilon" | "queries" | "cells";
  spent: number;
  limit: number;
}

export interface PartyReleaseManifest {
  /** 出这份 C3 的节点（参与方 URN）。 */
  node: string;
  /** 发布审查用的最小单元阈值。 */
  minCell: number;
  /** 被抑制的单元数（**汇总**；逐格明细留在节点本地）。 */
  suppressed: number;
  /** 是否触发了二次抑制（节点内闸门的判定结果）。 */
  secondarySuppression?: boolean;
  /** DP 声明：本期节点内不加噪，只如实记录声明。 */
  dp: DpDeclaration;
  /** 查询预算消耗（数据集 × 快照；跨持有方不可简单相加，因此合并时保留列表）。 */
  budget?: BudgetUsageView;
  at: string;
}

function parseDp(input: unknown, path: string): DpDeclaration {
  const dpObj = asObject(input, path);
  checkKeys(dpObj, path, { required: ["mode"], optional: ["epsilon"] });
  const mode = reqString(dpObj, "mode", path);
  if (mode === "none") return { mode: "none" };
  if (mode === "epsilon") return { mode: "epsilon", epsilon: reqNumber(dpObj, "epsilon", path) };
  throw new SchemaError(`${path}.mode`, `未知 DP 模式：${mode}`);
}

function parseBudget(input: unknown, path: string): BudgetUsageView {
  const budgetObj = asObject(input, path);
  checkKeys(budgetObj, path, { required: ["dataset", "snapshot", "unit", "spent", "limit"] });
  const unit = reqString(budgetObj, "unit", path);
  if (!["epsilon", "queries", "cells"].includes(unit))
    throw new SchemaError(`${path}.unit`, `未知计量单位：${unit}`);
  return {
    dataset: reqString(budgetObj, "dataset", path),
    snapshot: reqString(budgetObj, "snapshot", path),
    unit: unit as BudgetUsageView["unit"],
    spent: reqNumber(budgetObj, "spent", path),
    limit: reqNumber(budgetObj, "limit", path),
  };
}

/** 单个持有方（节点）的清单条目。 */
export function parsePartyReleaseManifest(input: unknown): PartyReleaseManifest {
  const obj = asObject(input, "releaseManifest.party");
  checkKeys(obj, "releaseManifest.party", {
    required: ["node", "minCell", "suppressed", "dp", "at"],
    optional: ["secondarySuppression", "budget"],
  });
  const budgetObj = optObject(obj, "budget", "releaseManifest.party");
  const suppressed = reqNumber(obj, "suppressed", "releaseManifest.party");
  if (suppressed < 0) throw new SchemaError("releaseManifest.party.suppressed", "不能为负");
  const secondary = obj.secondarySuppression;
  if (secondary !== undefined && typeof secondary !== "boolean")
    throw new SchemaError("releaseManifest.party.secondarySuppression", "必须是布尔");

  return {
    node: reqString(obj, "node", "releaseManifest.party"),
    minCell: reqNumber(obj, "minCell", "releaseManifest.party"),
    suppressed,
    ...(secondary !== undefined ? { secondarySuppression: secondary } : {}),
    dp: parseDp(obj.dp, "releaseManifest.party.dp"),
    ...(budgetObj ? { budget: parseBudget(budgetObj, "releaseManifest.party.budget") } : {}),
    at: reqTimestamp(obj, "at", "releaseManifest.party"),
  };
}

/**
 * **C3 载荷里随行的清单**：各持有方条目 + 汇总值。
 *
 * 为什么载荷里是这一种形状而不是「某一家的一张清单」：节点出的那一份与平台合并后的那一份
 * 必须是**同一种可解析对象**，否则前端与审计要按来源分叉解析。单方场景就是
 * `parties.length === 1` 的退化情形（由 `mergeReleaseManifests` 统一产出）。
 */
export interface ReleaseManifest {
  apiVersion: typeof RELEASE_MANIFEST_API_VERSION;
  parties: PartyReleaseManifest[];
  /** 抑制格数合计（汇总量；逐格明细不在这里）。 */
  suppressedTotal: number;
  /** 各方 DP 声明里最强的一档（只要有一方加噪，就标明「含加噪」）。 */
  dp: DpDeclaration;
  /** 发布审查所用阈值（多方不一致时取最严＝最大）。 */
  minCell: number;
  at: string;
}

export function parseReleaseManifest(input: unknown): ReleaseManifest {
  const obj = asObject(input, "releaseManifest");
  checkKeys(obj, "releaseManifest", {
    required: ["apiVersion", "parties", "suppressedTotal", "dp", "minCell", "at"],
  });
  const apiVersion = reqString(obj, "apiVersion", "releaseManifest");
  if (apiVersion !== RELEASE_MANIFEST_API_VERSION)
    throw new SchemaError("releaseManifest.apiVersion", `只接受 ${RELEASE_MANIFEST_API_VERSION}`);
  const partiesRaw = obj.parties;
  if (!Array.isArray(partiesRaw)) throw new SchemaError("releaseManifest.parties", "必须是数组");
  const total = reqNumber(obj, "suppressedTotal", "releaseManifest");
  if (total < 0) throw new SchemaError("releaseManifest.suppressedTotal", "不能为负");
  return {
    apiVersion: RELEASE_MANIFEST_API_VERSION,
    parties: partiesRaw.map((p) => parsePartyReleaseManifest(p)),
    suppressedTotal: total,
    dp: parseDp(obj.dp, "releaseManifest.dp"),
    minCell: reqNumber(obj, "minCell", "releaseManifest"),
    at: reqTimestamp(obj, "at", "releaseManifest"),
  };
}

/** 把清单挂进 C3 载荷（保留键；不接受覆盖写——覆盖即视为实现错误）。 */
export function withReleaseManifest<T extends Record<string, unknown>>(
  payload: T,
  manifest: ReleaseManifest,
): T & { [RELEASE_MANIFEST_KEY]: ReleaseManifest } {
  if (payload[RELEASE_MANIFEST_KEY] !== undefined)
    throw new SchemaError(RELEASE_MANIFEST_KEY, "载荷里已经有一份发布审查清单（不接受覆盖写）");
  return { ...payload, [RELEASE_MANIFEST_KEY]: manifest };
}

/** 从 C3 载荷里读清单（没有就返回 undefined；有但非法即抛，不静默忽略）。 */
export function releaseManifestOf(payload: Record<string, unknown>): ReleaseManifest | undefined {
  const raw = payload[RELEASE_MANIFEST_KEY];
  return raw === undefined ? undefined : parseReleaseManifest(raw);
}

/**
 * 合并各持有方的条目（节点侧是单方退化情形，平台侧是多方）。
 * 规则都取**更严/更全**：抑制数求和、minCell 取最大、DP 取最强声明、预算保留逐方列表。
 */
export function mergeReleaseManifests(
  parties: readonly PartyReleaseManifest[],
  opts: { now?: Date } = {},
): ReleaseManifest {
  if (parties.length === 0) throw new SchemaError("releaseManifest", "没有可合并的清单条目");
  const epsilon = parties
    .filter((m): m is PartyReleaseManifest & { dp: { mode: "epsilon"; epsilon: number } } => m.dp.mode === "epsilon")
    .reduce<number | null>(
      (max, m) => (max === null ? m.dp.epsilon : Math.max(max, m.dp.epsilon)),
      null,
    );
  return {
    apiVersion: RELEASE_MANIFEST_API_VERSION,
    parties: parties.map((m) => ({ ...m })),
    suppressedTotal: parties.reduce((sum, m) => sum + m.suppressed, 0),
    dp: epsilon === null ? { mode: "none" } : { mode: "epsilon", epsilon },
    minCell: parties.reduce((max, m) => Math.max(max, m.minCell), 0),
    at: (opts.now ?? new Date()).toISOString(),
  };
}
