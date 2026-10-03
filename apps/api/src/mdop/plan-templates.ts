import { BadRequestException } from "@nestjs/common";
import { participantUrn } from "@medtrust/mdop";

/**
 * 计划模板（任务 9.1）：把「药物/事件/队列定义/医院/合约」翻译成逻辑计划。
 *
 * 本期的模板 `rws.l15.disproportionality` 固定四个阶段：
 *   每家医院：`source.dataset@1` → `rws.disproportionality@1` → `declassify.small_cell@1`
 *   平台合并：`merge.disproportionality@1`（吃各院 C3）
 * 申请方只描述「算什么」，不描述「在哪算」——放置由编译器按数据就近决定。
 */

export const L15_TEMPLATE_ID = "rws.l15.disproportionality";

export interface L15TemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  drug: string;
  /** 医院（participant id）→ 数据产品 id。 */
  hospitals: Array<{ participantId: string; dataProductId: string }>;
  /** 队列定义（可选；本期透传给 source 阶段，由数据加载侧解释）。 */
  cohort?: string;
  /** 小单元格阈值下限（缺省由合约决定）。 */
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

export interface LogicalPlanDraft {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  stages: Array<{
    id: string;
    op: string;
    inputs: Array<{ from: string }>;
    params: Record<string, unknown>;
    at?: string;
  }>;
  ethics_ref?: string;
  not_before: string;
  not_after: string;
}

export function buildL15Plan(
  input: L15TemplateInput,
  space = process.env.SPACE_ID ?? "sh-med",
): LogicalPlanDraft {
  if (!input.drug?.trim())
    throw new BadRequestException("L1.5 计划需要目标药物");
  if (!input.hospitals?.length)
    throw new BadRequestException("L1.5 计划至少需要一家医院");
  if (!input.contracts?.length)
    throw new BadRequestException("L1.5 计划至少需要一份合约");

  const stages: LogicalPlanDraft["stages"] = [];
  const declassifyStageIds: string[] = [];
  for (const hospital of input.hospitals) {
    const node = hospital.participantId;
    const suffix = node.replace(/[^A-Za-z0-9]/g, "");
    const src = `src_${suffix}`;
    const l15 = `l15_${suffix}`;
    const dec = `dec_${suffix}`;
    stages.push({
      id: src,
      op: "source.dataset@1.0.0",
      // 数据源句柄进「输入」：以 ds://<node>/… 为输入的阶段 MUST 落在该节点（数据就近）
      inputs: [{ from: `ds://${node}/${hospital.dataProductId}` }],
      params: {
        uri: `ds://${node}/${hospital.dataProductId}`,
        ...(input.cohort ? { cohort: input.cohort } : {}),
      },
    });
    stages.push({
      id: l15,
      op: "rws.disproportionality@1.0.0",
      inputs: [{ from: src }],
      params: { drug: input.drug },
    });
    stages.push({
      id: dec,
      op: "declassify.small_cell@1.0.0",
      inputs: [{ from: l15 }],
      params: {
        ...(input.minCell !== undefined ? { minCell: input.minCell } : {}),
        contractId: input.contracts[0],
      },
    });
    declassifyStageIds.push(dec);
  }
  stages.push({
    id: "merge",
    op: "merge.disproportionality@1.0.0",
    inputs: declassifyStageIds.map((from) => ({ from })),
    params: { drug: input.drug },
    at: participantUrn(space, "platform"),
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

/** 跨院队列交集（C2 首个场景，D-TEE-4 首选 A）的模板 id。 */
export const PAIRED_COHORT_TEMPLATE_ID = "rws.paired-cohort";

export interface PairedCohortTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  /** 参与配对的持有方：参与方 id + 数据产品 id（各一份 **C2 封存切片**）。 */
  holders: Array<{ participantId: string; dataProductId: string }>;
  /** **可信空间节点**（参与方 URN）：配对与降密都在它内部完成。 */
  teeNode: string;
  /** 分层取值（`ageBand|sex` 形态；由数据侧映射，节点内按它分组）。 */
  strata?: string[];
  /** 小单元格阈值下限（缺省由合约决定）。 */
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

/**
 * 跨院队列交集（C2）：**各院封存 → 可信空间节点内配对 → 节点内降密 → 平台收集**。
 *
 * 三处刻意的写法，都与「能判的都在编译期判」有关：
 *  ① 每家持有方的阶段链是 `source` → `seal`：**封存留在持有方侧**（C0→C2），
 *     送出去的只有信封；数据源句柄让编译器把这两步钉在该院（数据就近）。
 *  ② 节点侧两个阶段都写 `at: <teeNode>`：`pair` 吃的是各院的 **C2 输入**，
 *     **不写 `at` 就会按「多节点依赖」被默认丢给平台**（而平台不该、也不能解封）；
 *     写了 `at` 之后编译器照走 `assertC2Target`（合约证明策略 + 该节点的证明登记）。
 *  ③ 配对之后跟一个 `declassify.small_cell` 阶段：C2 → C3 的**降密就是节点内的发布审查**，
 *     用同一套闸门机制表达（既不是平台的事，也不是把 C2 直接投给平台）。
 */
export function buildPairedCohortPlan(
  input: PairedCohortTemplateInput,
  space = process.env.SPACE_ID ?? "sh-med",
): LogicalPlanDraft {
  if (!input.holders?.length || input.holders.length < 2)
    throw new BadRequestException("跨院配对至少需要两家持有方");
  if (!input.teeNode?.startsWith("urn:"))
    throw new BadRequestException("跨院配对必须指定可信空间节点（参与方 URN）");
  if (!input.contracts?.length)
    throw new BadRequestException("跨院配对至少需要一份合约");

  const stages: LogicalPlanDraft["stages"] = [];
  const sealedStageIds: string[] = [];
  for (const holder of input.holders) {
    const node = holder.participantId;
    const suffix = node.replace(/[^A-Za-z0-9]/g, "");
    const src = `src_${suffix}`;
    const seal = `seal_${suffix}`;
    stages.push({
      id: src,
      op: "source.dataset@1.0.0",
      inputs: [{ from: `ds://${node}/${holder.dataProductId}` }],
      params: { uri: `ds://${node}/${holder.dataProductId}` },
    });
    stages.push({
      id: seal,
      op: "seal.envelope@1.0.0",
      inputs: [{ from: src }],
      params: { contractId: input.contracts[0] },
    });
    sealedStageIds.push(seal);
  }

  stages.push({
    id: "pair",
    op: "rws.paired-cohort@1.0.0",
    inputs: sealedStageIds.map((from) => ({ from })),
    params: { ...(input.strata ? { strata: input.strata } : {}) },
    at: input.teeNode,
  });
  stages.push({
    id: "decTee",
    op: "declassify.small_cell@1.0.0",
    inputs: [{ from: "pair" }],
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

/** 疫苗接种后不良事件主动监测（自身对照风险期 SCRI）的模板 id。 */
export const VACCINE_SCRI_TEMPLATE_ID = "rws.vaccine-scri";

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

const isDayWindow = (w: unknown): w is [number, number] =>
  Array.isArray(w) && w.length === 2 && w.every((v) => Number.isInteger(v)) && w[0] <= w[1];

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
  space = process.env.SPACE_ID ?? "sh-med",
): LogicalPlanDraft {
  if (!input.registry?.participantId || !input.events?.participantId)
    throw new BadRequestException("SCRI 需要接种记录持有方与就诊结局持有方各一家");
  if (input.registry.participantId === input.events.participantId)
    throw new BadRequestException("接种与结局须来自不同持有方（同一家无需可信空间节点）");
  if (!input.teeNode?.startsWith("urn:"))
    throw new BadRequestException("SCRI 必须指定可信空间节点（参与方 URN）");
  if (!input.contracts?.length) throw new BadRequestException("SCRI 至少需要一份合约");
  if (!input.vaccineCodes?.length || !input.eventCodes?.length)
    throw new BadRequestException("必须给出目标疫苗编码与目标事件编码");
  if (!isDayWindow(input.riskWindow) || !isDayWindow(input.controlWindow))
    throw new BadRequestException("风险期 / 对照期必须是 [起, 止] 两个整数天");
  const [r1, r2] = input.riskWindow;
  const [c1, c2] = input.controlWindow;
  if (!(r2 < c1 || c2 < r1)) throw new BadRequestException("风险期与对照期不得重叠");

  const urn = (id: string) => `urn:tds:${space}:participant:${id}`;
  const stages: LogicalPlanDraft["stages"] = [];
  const sides = [
    { holder: input.registry, projection: "scri-registry", codes: { vaccineCodes: input.vaccineCodes } },
    { holder: input.events, projection: "scri-events", codes: { eventCodes: input.eventCodes } },
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
      params: { contractId: input.contracts[0], projection: side.projection, ...side.codes },
    });
    sealed.push(`seal_${suffix}`);
  }
  stages.push({
    id: "scri",
    op: "rws.vaccine-scri@1.0.0",
    inputs: sealed.map((from) => ({ from })),
    params: {
      roles: { registry: urn(input.registry.participantId), events: urn(input.events.participantId) },
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
