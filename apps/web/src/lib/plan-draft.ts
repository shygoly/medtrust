// SPDX-License-Identifier: MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * 计划编辑器（批次 2 的任务 1.1–1.3）的**纯模型层**。
 *
 * 三条设计约束（design D3，写在这里以免后来者再想一遍）：
 *
 *  1. **单一表示**：页面状态就是这个 `PlanDraft`（`LogicalPlanDraft` 的前端镜像），不再维护第二套编排模型。
 *     模板向导的产出与手工编辑产出的形状**完全一致** —— 前者只是帮你把字段填上。
 *  2. **只提示、不判定**：`stageIdHint` / `emptyFieldHints` 返回的是**可读提示**，不是判定结果。
 *     真正的判定（数据就近 / C2 证明策略 / 排序契约 / 阶段 id 唯一性）只由后端编译期做一次 ——
 *     前端复制规则必然漂移，漂移出的「页面通过、编译失败」比不提示更糟。
 *  3. **提交路径统一**：`toPlanPayload` 产出的就是后端 `POST /mdop/jobs` 接受的形状。
 *
 * 本文件不 import 任何 UI/请求库：可单测、可复用（计划详情页复用同一份只读渲染）。
 */

export interface PlanStageDraft {
  id: string;
  /** 算子引用（`<name>@<version>`）。 */
  op: string;
  inputs: Array<{ from: string }>;
  params: Record<string, unknown>;
  /** 执行位置（节点/主体）；缺省表示由平台按环境约束决定。 */
  at?: string;
}

export interface PlanDraft {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  stages: PlanStageDraft[];
  notBefore: string;
  notAfter: string;
  ethicsRef?: string;
}

/** 默认空计划：时间窗给 30 天（与既有 RWS 入口一致），其余留空由用户填。 */
export function emptyPlanDraft(now: Date = new Date()): PlanDraft {
  return {
    purpose: "",
    applicant: { org: "", project: "" },
    contracts: [],
    stages: [],
    notBefore: now.toISOString(),
    notAfter: new Date(now.getTime() + 30 * 24 * 3600_000).toISOString(),
  };
}

/** 追加一个阶段（只做形状处理，不判定顺序/依赖是否合理）。 */
export function addStage(draft: PlanDraft, stage: PlanStageDraft): PlanDraft {
  return { ...draft, stages: [...draft.stages, { ...stage, params: { ...stage.params } }] };
}

/** 移动阶段（编辑器里调顺序；后端仍按 id 引用，顺序只影响展示与默认拓扑）。 */
export function moveStage(draft: PlanDraft, from: number, to: number): PlanDraft {
  if (from < 0 || from >= draft.stages.length) return draft;
  const target = Math.max(0, Math.min(draft.stages.length - 1, to));
  const stages = [...draft.stages];
  const [moved] = stages.splice(from, 1);
  stages.splice(target, 0, moved);
  return { ...draft, stages };
}

/** 删除阶段；若还有其他阶段引用它，一并把那些引用**列出来**（提示，不阻止）。 */
export function removeStage(
  draft: PlanDraft,
  id: string,
): { draft: PlanDraft; danglingRefs: string[] } {
  const stages = draft.stages.filter((s) => s.id !== id);
  const danglingRefs = stages
    .filter((s) => s.inputs.some((i) => i.from === id))
    .map((s) => s.id);
  return { draft: { ...draft, stages }, danglingRefs };
}

/**
 * 阶段 id 的**可读提示**（不是判定）：空、含非法字符、或与已有阶段重名时给出文案。
 * 判定权在后端编译期；这里只在用户打字时给一句人话。
 */
export function stageIdHint(draft: PlanDraft, candidate: string): string | null {
  const id = candidate.trim();
  if (!id) return "阶段 id 不能为空";
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(id))
    return "建议以字母开头，只含字母/数字/下划线（后端按此约定校验）";
  if (draft.stages.some((s) => s.id === id)) return `阶段 id 已存在：${id}`;
  return null;
}

/** 表单层面的缺失提示（合约/用途/时间窗）。同样是提示，不是放行依据。 */
export function planHints(draft: PlanDraft): string[] {
  const hints: string[] = [];
  if (!draft.purpose.trim()) hints.push("用途（purpose）未填");
  if (!draft.contracts.length) hints.push("至少需要一份数字合约");
  if (!draft.stages.length) hints.push("计划里还没有阶段");
  if (draft.stages.some((s) => !s.op.trim())) hints.push("有阶段未指定算子");
  if (new Date(draft.notAfter).getTime() <= new Date(draft.notBefore).getTime())
    hints.push("结束时间不晚于开始时间");
  return hints;
}

/**
 * 模板产出 -> 编辑器状态（任务 1.2）：**同一形状**，因此这里只是一次浅拷贝 + 字段名对齐。
 * 未知/缺字段返回 null，由调用方给出「这份模板产出不可编辑」的提示，而不是猜。
 */
export function fromTemplatePlan(plan: unknown): PlanDraft | null {
  if (!plan || typeof plan !== "object") return null;
  const p = plan as Record<string, unknown>;
  const applicant = p.applicant as { org?: unknown; project?: unknown } | undefined;
  if (!Array.isArray(p.stages)) return null;
  const stages: PlanStageDraft[] = [];
  for (const raw of p.stages as Array<Record<string, unknown>>) {
    if (typeof raw?.id !== "string" || typeof raw?.op !== "string") return null;
    const inputs = Array.isArray(raw.inputs)
      ? (raw.inputs as Array<Record<string, unknown>>)
          .filter((i) => typeof i?.from === "string")
          .map((i) => ({ from: i.from as string }))
      : [];
    stages.push({
      id: raw.id,
      op: raw.op,
      inputs,
      params: (raw.params as Record<string, unknown>) ?? {},
      ...(typeof raw.at === "string" ? { at: raw.at } : {}),
    });
  }
  return {
    purpose: typeof p.purpose === "string" ? p.purpose : "",
    applicant: {
      org: typeof applicant?.org === "string" ? applicant.org : "",
      project: typeof applicant?.project === "string" ? applicant.project : "",
    },
    contracts: Array.isArray(p.contracts) ? (p.contracts as string[]) : [],
    stages,
    notBefore: typeof p.not_before === "string" ? p.not_before : new Date().toISOString(),
    notAfter: typeof p.not_after === "string" ? p.not_after : new Date().toISOString(),
    ...(typeof p.ethics_ref === "string" ? { ethicsRef: p.ethics_ref } : {}),
  };
}

/** 编辑器状态 -> 提交载荷（后端 `POST /mdop/jobs` 的形状；命名与模板产出一致）。 */
export function toPlanPayload(draft: PlanDraft): Record<string, unknown> {
  return {
    purpose: draft.purpose,
    applicant: draft.applicant,
    contracts: draft.contracts,
    stages: draft.stages.map((s) => ({
      id: s.id,
      op: s.op,
      inputs: s.inputs,
      params: s.params,
      ...(s.at ? { at: s.at } : {}),
    })),
    not_before: draft.notBefore,
    not_after: draft.notAfter,
    ...(draft.ethicsRef ? { ethics_ref: draft.ethicsRef } : {}),
  };
}
