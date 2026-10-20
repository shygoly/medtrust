/**
 * AI 助手空态预设提示词 — 按空间启用能力包（med / power）分流。
 *
 * 文案与 `apps/chat-agent/src/agent/scenarios.ts` 各场景 `examples[0]` 对齐；
 * 新增场景时两边一起改，避免医疗空间露出电力提示、反之亦然。
 */

export type ChatStarterPack = "med" | "power";

/** 医疗包场景入口（外部对照 / 注册研究 / 联邦预测 / 队列统计） */
export const MED_STARTERS: readonly string[] = [
  "我想对比试验组和对照组的疗效",
  "创建一项单臂外部对照注册研究并生成模拟报告",
  "做一次 RWS 真实世界研究",
  "用联邦学习训练一个风险预测模型",
  "统计一下两院各年龄段的患病人数",
];

/** 电力包场景入口（负荷预测 / 需求响应 / 窃电检测） */
export const POWER_STARTERS: readonly string[] = [
  "我想预测明天的电力负荷",
  "帮我做削峰填谷的需求响应优化",
  "检测一下跨区域的异常用电",
];

const BY_PACK: Record<ChatStarterPack, readonly string[]> = {
  med: MED_STARTERS,
  power: POWER_STARTERS,
};

/**
 * 按空间 `enabledPacks` 选预设。
 * - 未加载 / 空：按 spaceId 启发式（含 power → 电力，否则医疗）
 * - 同时启用多包：按 med → power 顺序拼接
 */
export function startersForSpace(opts: {
  enabledPacks?: readonly string[] | null;
  spaceId?: string | null;
}): string[] {
  const fromPacks = packsFromEnabled(opts.enabledPacks);
  const packs = fromPacks.length > 0 ? fromPacks : packsFromSpaceId(opts.spaceId);
  return packs.flatMap((pack) => [...BY_PACK[pack]]);
}

function packsFromEnabled(enabledPacks?: readonly string[] | null): ChatStarterPack[] {
  if (!enabledPacks || enabledPacks.length === 0) return [];
  const out: ChatStarterPack[] = [];
  if (enabledPacks.includes("med")) out.push("med");
  if (enabledPacks.includes("power")) out.push("power");
  return out;
}

function packsFromSpaceId(spaceId?: string | null): ChatStarterPack[] {
  const id = (spaceId ?? "").toLowerCase();
  if (id.includes("power")) return ["power"];
  return ["med"];
}
