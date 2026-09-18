import type { CapabilityObject } from "@/types/capability.types";

// 七层注册表的 status 即平台落地状态(DOMAIN §状态词汇表 / DESIGN §2):
// active = 已真实落地,可编排;draft = 目录已登记、平台未落地;deprecated = 已退役。
// fail-closed:只有显式 active 才算落地,缺省/未知一律按未落地处理。

type WithStatus = Pick<CapabilityObject, "status">;

export function isLanded(o: WithStatus): boolean {
  return o.status === "active";
}

export function landingLabel(o: WithStatus): string {
  if (o.status === "active") return "已落地";
  if (o.status === "deprecated") return "已退役";
  return "未落地";
}

// 落地依据 / 缺口说明(metadata.impl),悬停提示用。
export function landingNote(o: Pick<CapabilityObject, "metadata">): string | undefined {
  const v = o.metadata?.impl;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function landingTitle(o: WithStatus & Pick<CapabilityObject, "metadata">): string {
  const note = landingNote(o);
  return note ? `${landingLabel(o)} · ${note}` : landingLabel(o);
}

// 已落地在前;组内保持注册表原顺序(Array.prototype.sort 稳定)。
export function landedFirst<T extends WithStatus>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => Number(isLanded(b)) - Number(isLanded(a)));
}
