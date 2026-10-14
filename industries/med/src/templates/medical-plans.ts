// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 三个节点内协同分析的计划模板（SCRI / VE-TND / 跨院去重发病率）—— 逐字搬移自
 * `apps/api/src/mdop/plan-templates.ts`（change `pack-med-templates` design D5），含共享的入参助手
 * （编码白名单、分层键闭合语法、日期窗）。差异只有两处：`space` 入参；`PlanInputError` 承载校验失败。
 */
import {
  MAX_STRATUM_KEYS,
  PlanInputError,
  isNonEmptyStringList,
  stratumKeyListProblem,
} from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";
import type { PlanTemplate, SpiContext } from "@medtrust/space-kernel-spi";

export interface VaccineScriTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  /** 免疫规划（接种记录）持有方，通常是疾控。 */
  registry: { participantId: string; dataProductId: string };
  /** 就诊结局持有方，通常是医院。 */
  events: { participantId: string; dataProductId: string };
  teeNode: string;
  /** 目标疫苗编码（CVX）；同时用于持有方侧的最小投影过滤。 */
  vaccineCodes: string[];
  /** 目标事件编码（诊断编码）；同时用于持有方侧的最小投影过滤。 */
  eventCodes: string[];
  /** 风险期 / 对照期（接种后天数，闭区间）。 */
  riskWindow: [number, number];
  controlWindow: [number, number];
  /** 固定分层顺序（`ageBand|sex`）；缺省按节点内出现过的取值。 */
  strataKeys?: string[];
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

/**
 * 编码白名单：必须是**非空数组、每一项都是非空字符串**，否则 400。
 *
 * 只判 `.length` 不够：`[""]`、`[null]`、甚至一个字符串都能过，而下游把「无效白名单」当成「不过滤」，
 * 等于申请方可以借一份坏白名单让持有方把全部编码的记录都封出来。持有方封存投影与节点执行器
 * 各自再判一遍（同一份判据 `isNonEmptyStringList`），这里是最早的一道。
 */
function assertCodeWhitelist(value: unknown, name: string): void {
  if (!isNonEmptyStringList(value))
    throw new PlanInputError(
      `${name} 必须是非空数组，且每一项都是非空字符串（无效的编码白名单不等于「不过滤」）`,
    );
}

/**
 * 固定分层顺序 `strataKeys`：给了就必须是互不重复、符合 `<年龄段>|<性别>` 闭合语法的键，
 * 至多 64 个（`MAX_STRATUM_KEYS`）。分层键会原样成为出域结果里每一层的 `key`，不设语法它就是一条自由文本通道。
 */
function assertStrataKeys(value: unknown): void {
  if (value === undefined) return;
  const problem = stratumKeyListProblem(value);
  if (!problem) return;
  const reason = {
    "not-array": "必须是数组",
    "too-many": `至多 ${MAX_STRATUM_KEYS} 个`,
    "bad-key":
      "每一项必须形如 <年龄段>|<性别>（年龄段如 18-39 / 65+ / <40 / all；性别 F / M / U / male / female / all）",
    duplicate: "不得有重复的分层键",
  }[problem];
  throw new PlanInputError(`strataKeys ${reason}`);
}

const isDayWindow = (w: unknown): w is [number, number] =>
  Array.isArray(w) &&
  w.length === 2 &&
  w.every((v) => Number.isInteger(v)) &&
  w[0] <= w[1];

/**
 * 疫苗接种后不良事件 SCRI（C2）：**疾控封存接种 → 医院封存事件 → 节点内按人对齐、按日期差计数 → 节点内降密**。
 *
 * 与跨院配对同一骨架，差别在两处：
 *  ① 两方的**角色不同**（接种 / 事件），封存投影不同——投影名与编码过滤写进封存阶段参数，
 *     持有方只封目标疫苗的剂次、目标诊断的事件（最小投影，也让信封体量可控）；
 *  ② 节点阶段按角色绑定输入（`roles`），风险期与对照期在编译前就校验不得重叠。
 */
export function buildVaccineScriPlan(
  input: VaccineScriTemplateInput,
  space: string,
): LogicalPlanDraft {
  if (!input.registry?.participantId || !input.events?.participantId)
    throw new PlanInputError(
      "SCRI 需要接种记录持有方与就诊结局持有方各一家",
    );
  if (input.registry.participantId === input.events.participantId)
    throw new PlanInputError(
      "接种与结局须来自不同持有方（同一家无需可信空间节点）",
    );
  if (!input.teeNode?.startsWith("urn:"))
    throw new PlanInputError("SCRI 必须指定可信空间节点（参与方 URN）");
  if (!input.contracts?.length)
    throw new PlanInputError("SCRI 至少需要一份合约");
  assertCodeWhitelist(input.vaccineCodes, "目标疫苗编码 vaccineCodes");
  assertCodeWhitelist(input.eventCodes, "目标事件编码 eventCodes");
  assertStrataKeys(input.strataKeys);
  if (!isDayWindow(input.riskWindow) || !isDayWindow(input.controlWindow))
    throw new PlanInputError("风险期 / 对照期必须是 [起, 止] 两个整数天");
  const [r1, r2] = input.riskWindow;
  const [c1, c2] = input.controlWindow;
  if (!(r2 < c1 || c2 < r1))
    throw new PlanInputError("风险期与对照期不得重叠");

  const urn = (id: string) => `urn:tds:${space}:participant:${id}`;
  const stages: LogicalPlanDraft["stages"] = [];
  const sides = [
    {
      holder: input.registry,
      projection: "scri-registry",
      codes: { vaccineCodes: input.vaccineCodes },
    },
    {
      holder: input.events,
      projection: "scri-events",
      codes: { eventCodes: input.eventCodes },
    },
  ];
  const sealed: string[] = [];
  for (const side of sides) {
    const node = side.holder.participantId;
    const suffix = node.replace(/[^A-Za-z0-9]/g, "");
    stages.push({
      id: `src_${suffix}`,
      op: "source.dataset@1.0.0",
      inputs: [{ from: `ds://${node}/${side.holder.dataProductId}` }],
      params: { uri: `ds://${node}/${side.holder.dataProductId}` },
    });
    stages.push({
      id: `seal_${suffix}`,
      op: "seal.envelope@1.0.0",
      inputs: [{ from: `src_${suffix}` }],
      params: {
        contractId: input.contracts[0],
        projection: side.projection,
        ...side.codes,
      },
    });
    sealed.push(`seal_${suffix}`);
  }
  stages.push({
    id: "scri",
    op: "rws.vaccine-scri@1.0.0",
    inputs: sealed.map((from) => ({ from })),
    params: {
      roles: {
        registry: urn(input.registry.participantId),
        events: urn(input.events.participantId),
      },
      riskWindow: input.riskWindow,
      controlWindow: input.controlWindow,
      vaccineCodes: input.vaccineCodes,
      eventCodes: input.eventCodes,
      ...(input.strataKeys ? { strataKeys: input.strataKeys } : {}),
    },
    at: input.teeNode,
  });
  stages.push({
    id: "decTee",
    op: "declassify.small_cell@1.0.0",
    inputs: [{ from: "scri" }],
    params: {
      ...(input.minCell !== undefined ? { minCell: input.minCell } : {}),
      contractId: input.contracts[0],
    },
    at: input.teeNode,
  });
  return {
    purpose: input.purpose,
    applicant: input.applicant,
    contracts: input.contracts,
    stages,
    ...(input.ethicsRef ? { ethics_ref: input.ethicsRef } : {}),
    not_before: input.notBefore,
    not_after: input.notAfter,
  };
}

/** 疫苗真实世界保护效果（检测阴性设计 TND）的模板 id。 */
export const VE_TND_TEMPLATE_ID = "rws.ve-tnd";

export interface VeTndTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  /** 免疫规划（接种记录）持有方，通常是疾控。 */
  registry: { participantId: string; dataProductId: string };
  /** 检测记录持有方，通常是医院。 */
  tests: { participantId: string; dataProductId: string };
  teeNode: string;
  /** 目标疫苗编码（CVX）；同时用于持有方侧最小投影过滤。 */
  vaccineCodes: string[];
  /** 目标病原检测编码（如 LOINC）；同时用于持有方侧最小投影过滤。 */
  pathogenCodes: string[];
  /** 免疫建立期天数（≥1，缺省 14）：检测日前 ≥ 该天数完成末剂才算「已接种」。 */
  immuneDays?: number;
  /** 固定分层顺序（`ageBand|sex`）；缺省按节点内出现过的取值。 */
  strataKeys?: string[];
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

/**
 * 疫苗真实世界保护效果 TND（C2）：**疾控封存接种 → 医院封存检测 → 节点内按人对齐并做分层 2×2 计数 → 节点内降密**。
 *
 * 与 SCRI 模板同一骨架，差别在判定口径：SCRI 比的是「事件落在接种后哪个窗口」，
 * 本模板比的是「检测时点是否已过免疫建立期」——同样只能把两机构的日期放到同一个人时间轴上，
 * 任一方单独都判不出纳入集（这也是它必须走 C2 的原因）。
 */
export function buildVeTndPlan(
  input: VeTndTemplateInput,
  space: string,
): LogicalPlanDraft {
  if (!input.registry?.participantId || !input.tests?.participantId)
    throw new PlanInputError(
      "VE(TND) 需要接种记录持有方与检测记录持有方各一家",
    );
  if (input.registry.participantId === input.tests.participantId)
    throw new PlanInputError(
      "接种与检测须来自不同持有方（同一家无需可信空间节点）",
    );
  if (!input.teeNode?.startsWith("urn:"))
    throw new PlanInputError("VE(TND) 必须指定可信空间节点（参与方 URN）");
  if (!input.contracts?.length)
    throw new PlanInputError("VE(TND) 至少需要一份合约");
  assertCodeWhitelist(input.vaccineCodes, "目标疫苗编码 vaccineCodes");
  assertCodeWhitelist(input.pathogenCodes, "目标病原检测编码 pathogenCodes");
  assertStrataKeys(input.strataKeys);
  const immuneDays = input.immuneDays ?? 14;
  if (!Number.isInteger(immuneDays) || immuneDays < 1)
    throw new PlanInputError("免疫建立期必须是 ≥1 的整数天");

  const urn = (id: string) => `urn:tds:${space}:participant:${id}`;
  const stages: LogicalPlanDraft["stages"] = [];
  const sides = [
    {
      holder: input.registry,
      projection: "ve-registry",
      codes: { vaccineCodes: input.vaccineCodes },
    },
    {
      holder: input.tests,
      projection: "ve-tests",
      codes: { pathogenCodes: input.pathogenCodes },
    },
  ];
  const sealed: string[] = [];
  for (const side of sides) {
    const node = side.holder.participantId;
    const suffix = node.replace(/[^A-Za-z0-9]/g, "");
    stages.push({
      id: `src_${suffix}`,
      op: "source.dataset@1.0.0",
      inputs: [{ from: `ds://${node}/${side.holder.dataProductId}` }],
      params: { uri: `ds://${node}/${side.holder.dataProductId}` },
    });
    stages.push({
      id: `seal_${suffix}`,
      op: "seal.envelope@1.0.0",
      inputs: [{ from: `src_${suffix}` }],
      params: {
        contractId: input.contracts[0],
        projection: side.projection,
        ...side.codes,
      },
    });
    sealed.push(`seal_${suffix}`);
  }
  stages.push({
    id: "veTnd",
    op: "rws.ve-tnd@1.0.0",
    inputs: sealed.map((from) => ({ from })),
    params: {
      roles: {
        registry: urn(input.registry.participantId),
        tests: urn(input.tests.participantId),
      },
      immuneDays,
      vaccineCodes: input.vaccineCodes,
      pathogenCodes: input.pathogenCodes,
      ...(input.strataKeys ? { strataKeys: input.strataKeys } : {}),
    },
    at: input.teeNode,
  });
  stages.push({
    id: "decTee",
    op: "declassify.small_cell@1.0.0",
    inputs: [{ from: "veTnd" }],
    params: {
      ...(input.minCell !== undefined ? { minCell: input.minCell } : {}),
      contractId: input.contracts[0],
    },
    at: input.teeNode,
  });
  return {
    purpose: input.purpose,
    applicant: input.applicant,
    contracts: input.contracts,
    stages,
    ...(input.ethicsRef ? { ethics_ref: input.ethicsRef } : {}),
    not_before: input.notBefore,
    not_after: input.notAfter,
  };
}

/** 跨院去重的发病率与罕见病登记的模板 id。 */
export const DEDUP_INCIDENCE_TEMPLATE_ID = "rws.dedup-incidence";

export interface DedupIncidenceTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  /** 参与医院（**≥2 家**——只有一家时「跨院去重」没有意义）。 */
  hospitals: Array<{ participantId: string; dataProductId: string }>;
  teeNode: string;
  /** 事件编码白名单（同时用于持有方侧最小投影过滤）。 */
  eventCodes: string[];
  /** 罕见病编码白名单（同时用于持有方侧最小投影过滤）。 */
  rareCodes: string[];
  /**
   * 相邻观察期是否合并（填补 1 天边界空隙）；缺省由节点按 `true` 处理，
   * 显式给值时写入阶段参数并留痕。
   */
  mergeAdjacent?: boolean;
  strataKeys?: string[];
  minCell?: number;
  /** 罕见病专用阈值（默认 10）：MUST NOT 小于 `minCell`。 */
  minCellRare?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

/**
 * 跨院去重的发病率与罕见病登记（C2）：**各院封存本院队列 → 节点内按人去重（人头并集 / 观察期并集 /
 * 事件去重 / 罕见病按人计数）→ 双阈值发布审查**。
 *
 * 只有一家医院时模板直接拒绝：各院自己就能算的东西不该走可信空间节点。
 */
export function buildDedupIncidencePlan(
  input: DedupIncidenceTemplateInput,
  space: string,
): LogicalPlanDraft {
  if (!input.hospitals || input.hospitals.length < 2)
    throw new PlanInputError(
      "跨院去重至少需要两家医院（一家时本地聚合即可）",
    );
  const ids = input.hospitals.map((h) => h.participantId);
  if (new Set(ids).size !== ids.length)
    throw new PlanInputError("参与医院不得重复");
  if (input.hospitals.some((h) => !h.participantId || !h.dataProductId))
    throw new PlanInputError("每家医院都需要 participantId 与数据产品 id");
  if (!input.teeNode?.startsWith("urn:"))
    throw new PlanInputError("跨院去重必须指定可信空间节点（参与方 URN）");
  if (!input.contracts?.length)
    throw new PlanInputError("跨院去重至少需要一份合约");
  assertCodeWhitelist(input.eventCodes, "事件编码白名单 eventCodes");
  assertCodeWhitelist(input.rareCodes, "罕见病编码白名单 rareCodes");
  assertStrataKeys(input.strataKeys);
  const minCell = input.minCell ?? 5;
  const minCellRare = input.minCellRare ?? 10;
  if (!Number.isInteger(minCell) || minCell < 1)
    throw new PlanInputError("minCell 必须是 ≥1 的整数");
  if (!Number.isInteger(minCellRare) || minCellRare < 1)
    throw new PlanInputError("minCellRare 必须是 ≥1 的整数");
  if (minCellRare < minCell)
    throw new PlanInputError(
      "罕见病阈值不得小于常规阈值（罕见病小细胞重识别风险更高）",
    );

  const urn = (id: string) => `urn:tds:${space}:participant:${id}`;
  const stages: LogicalPlanDraft["stages"] = [];
  const sealed: string[] = [];
  for (const hospital of input.hospitals) {
    const node = hospital.participantId;
    const suffix = node.replace(/[^A-Za-z0-9]/g, "");
    stages.push({
      id: `src_${suffix}`,
      op: "source.dataset@1.0.0",
      inputs: [{ from: `ds://${node}/${hospital.dataProductId}` }],
      params: { uri: `ds://${node}/${hospital.dataProductId}` },
    });
    stages.push({
      id: `seal_${suffix}`,
      op: "seal.envelope@1.0.0",
      inputs: [{ from: `src_${suffix}` }],
      params: {
        contractId: input.contracts[0],
        projection: "dedup-cohort",
        eventCodes: input.eventCodes,
        rareCodes: input.rareCodes,
        ...(input.mergeAdjacent !== undefined
          ? { mergeAdjacent: input.mergeAdjacent }
          : {}),
      },
    });
    sealed.push(`seal_${suffix}`);
  }
  stages.push({
    id: "dedup",
    op: "rws.dedup-incidence@1.0.0",
    inputs: sealed.map((from) => ({ from })),
    params: {
      roles: { cohorts: input.hospitals.map((h) => urn(h.participantId)) },
      eventCodes: input.eventCodes,
      rareCodes: input.rareCodes,
      ...(input.mergeAdjacent !== undefined
        ? { mergeAdjacent: input.mergeAdjacent }
        : {}),
      ...(input.strataKeys ? { strataKeys: input.strataKeys } : {}),
    },
    at: input.teeNode,
  });
  stages.push({
    id: "decTee",
    op: "declassify.small_cell@1.0.0",
    inputs: [{ from: "dedup" }],
    params: {
      minCell,
      minCellRare,
      contractId: input.contracts[0],
    },
    at: input.teeNode,
  });
  return {
    purpose: input.purpose,
    applicant: input.applicant,
    contracts: input.contracts,
    stages,
    ...(input.ethicsRef ? { ethics_ref: input.ethicsRef } : {}),
    not_before: input.notBefore,
    not_after: input.notAfter,
  };
}

/* ------------------------------------------------- S2 声明 */

export const vaccineScriTemplate: PlanTemplate = {
  id: "rws.vaccine-scri",
  build(input: unknown, ctx: SpiContext) {
    return buildVaccineScriPlan(input as VaccineScriTemplateInput, ctx.spaceId);
  },
};

export const veTndTemplate: PlanTemplate = {
  id: "rws.ve-tnd",
  build(input: unknown, ctx: SpiContext) {
    return buildVeTndPlan(input as VeTndTemplateInput, ctx.spaceId);
  },
};

export const dedupIncidenceTemplate: PlanTemplate = {
  id: "rws.dedup-incidence",
  build(input: unknown, ctx: SpiContext) {
    return buildDedupIncidencePlan(input as DedupIncidenceTemplateInput, ctx.spaceId);
  },
};
