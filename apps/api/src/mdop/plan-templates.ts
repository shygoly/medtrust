import { currentSpaceId } from "../runtime/space-context/space-id.util";
import type { FlPredictionTaskSpec } from "../compute-task/dto/fl-prediction-task-spec";
import { BadRequestException } from "@nestjs/common";
import {
  MAX_STRATUM_KEYS,
  isNonEmptyStringList,
  participantUrn,
  stratumKeyListProblem,
} from "@medtrust/mdop";

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
  space = currentSpaceId(),
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

/** L4 联邦预测（批次 1A）的模板 id。 */
export const L4_TEMPLATE_ID = "rws.l4.fl-prediction";

export interface L4TemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  /** 参与医院（participant id）→ 数据产品 id。 */
  hospitals: Array<{ participantId: string; dataProductId: string }>;
  /**
   * 训练规格：**复用旧链的 `FlPredictionTaskSpec`**（不另立字段语义）。
   * 本期只支持 `logistic_regression + fedavg`（无 sidecar、纯院内，便于逐字段对拍）；
   * 其余模型走 connector-ml，需另立一轮对拍（见 change design 风险表）。
   */
  spec: FlPredictionTaskSpec;
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

/**
 * L4 计划：每家医院 `source.dataset@1` → `rws.l4-train@1` → `declassify.small_cell@1`，
 * 平台 `merge.fedavg@1`（吃各院 C3）。
 */
export function buildL4Plan(
  input: L4TemplateInput,
  space = currentSpaceId(),
): LogicalPlanDraft {
  if (!input.spec) throw new BadRequestException("L4 计划需要训练规格");
  if (
    input.spec.modelType !== "logistic_regression" ||
    input.spec.aggregation !== "fedavg"
  ) {
    throw new BadRequestException(
      "本期 L4 计划只支持 logistic_regression + fedavg（其余模型待 connector-ml 对拍）",
    );
  }
  if (!input.hospitals?.length)
    throw new BadRequestException("L4 计划至少需要一家医院");
  if (!input.contracts?.length)
    throw new BadRequestException("L4 计划至少需要一份合约");

  const stages: LogicalPlanDraft["stages"] = [];
  const declassifyStageIds: string[] = [];
  for (const hospital of input.hospitals) {
    const node = hospital.participantId;
    const suffix = node.replace(/[^A-Za-z0-9]/g, "");
    const src = `src_${suffix}`;
    const train = `l4_${suffix}`;
    const dec = `dec_${suffix}`;
    stages.push({
      id: src,
      op: "source.dataset@1.0.0",
      inputs: [{ from: `ds://${node}/${hospital.dataProductId}` }],
      params: { uri: `ds://${node}/${hospital.dataProductId}` },
    });
    stages.push({
      id: train,
      op: "rws.l4-train@1.0.0",
      inputs: [{ from: src }],
      params: { spec: input.spec },
    });
    stages.push({
      id: dec,
      op: "declassify.small_cell@1.0.0",
      inputs: [{ from: train }],
      params: {
        ...(input.minCell !== undefined ? { minCell: input.minCell } : {}),
        contractId: input.contracts[0],
      },
    });
    declassifyStageIds.push(dec);
  }
  stages.push({
    id: "merge",
    op: "merge.fedavg@1.0.0",
    inputs: declassifyStageIds.map((from) => ({ from })),
    params: { spec: input.spec },
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
  space = currentSpaceId(),
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

/**
 * 编码白名单：必须是**非空数组、每一项都是非空字符串**，否则 400。
 *
 * 只判 `.length` 不够：`[""]`、`[null]`、甚至一个字符串都能过，而下游把「无效白名单」当成「不过滤」，
 * 等于申请方可以借一份坏白名单让持有方把全部编码的记录都封出来。持有方封存投影与节点执行器
 * 各自再判一遍（同一份判据 `isNonEmptyStringList`），这里是最早的一道。
 */
function assertCodeWhitelist(value: unknown, name: string): void {
  if (!isNonEmptyStringList(value))
    throw new BadRequestException(
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
  throw new BadRequestException(`strataKeys ${reason}`);
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
  space = currentSpaceId(),
): LogicalPlanDraft {
  if (!input.registry?.participantId || !input.events?.participantId)
    throw new BadRequestException(
      "SCRI 需要接种记录持有方与就诊结局持有方各一家",
    );
  if (input.registry.participantId === input.events.participantId)
    throw new BadRequestException(
      "接种与结局须来自不同持有方（同一家无需可信空间节点）",
    );
  if (!input.teeNode?.startsWith("urn:"))
    throw new BadRequestException("SCRI 必须指定可信空间节点（参与方 URN）");
  if (!input.contracts?.length)
    throw new BadRequestException("SCRI 至少需要一份合约");
  assertCodeWhitelist(input.vaccineCodes, "目标疫苗编码 vaccineCodes");
  assertCodeWhitelist(input.eventCodes, "目标事件编码 eventCodes");
  assertStrataKeys(input.strataKeys);
  if (!isDayWindow(input.riskWindow) || !isDayWindow(input.controlWindow))
    throw new BadRequestException("风险期 / 对照期必须是 [起, 止] 两个整数天");
  const [r1, r2] = input.riskWindow;
  const [c1, c2] = input.controlWindow;
  if (!(r2 < c1 || c2 < r1))
    throw new BadRequestException("风险期与对照期不得重叠");

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
  space = currentSpaceId(),
): LogicalPlanDraft {
  if (!input.registry?.participantId || !input.tests?.participantId)
    throw new BadRequestException(
      "VE(TND) 需要接种记录持有方与检测记录持有方各一家",
    );
  if (input.registry.participantId === input.tests.participantId)
    throw new BadRequestException(
      "接种与检测须来自不同持有方（同一家无需可信空间节点）",
    );
  if (!input.teeNode?.startsWith("urn:"))
    throw new BadRequestException("VE(TND) 必须指定可信空间节点（参与方 URN）");
  if (!input.contracts?.length)
    throw new BadRequestException("VE(TND) 至少需要一份合约");
  assertCodeWhitelist(input.vaccineCodes, "目标疫苗编码 vaccineCodes");
  assertCodeWhitelist(input.pathogenCodes, "目标病原检测编码 pathogenCodes");
  assertStrataKeys(input.strataKeys);
  const immuneDays = input.immuneDays ?? 14;
  if (!Number.isInteger(immuneDays) || immuneDays < 1)
    throw new BadRequestException("免疫建立期必须是 ≥1 的整数天");

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
  space = currentSpaceId(),
): LogicalPlanDraft {
  if (!input.hospitals || input.hospitals.length < 2)
    throw new BadRequestException(
      "跨院去重至少需要两家医院（一家时本地聚合即可）",
    );
  const ids = input.hospitals.map((h) => h.participantId);
  if (new Set(ids).size !== ids.length)
    throw new BadRequestException("参与医院不得重复");
  if (input.hospitals.some((h) => !h.participantId || !h.dataProductId))
    throw new BadRequestException("每家医院都需要 participantId 与数据产品 id");
  if (!input.teeNode?.startsWith("urn:"))
    throw new BadRequestException("跨院去重必须指定可信空间节点（参与方 URN）");
  if (!input.contracts?.length)
    throw new BadRequestException("跨院去重至少需要一份合约");
  assertCodeWhitelist(input.eventCodes, "事件编码白名单 eventCodes");
  assertCodeWhitelist(input.rareCodes, "罕见病编码白名单 rareCodes");
  assertStrataKeys(input.strataKeys);
  const minCell = input.minCell ?? 5;
  const minCellRare = input.minCellRare ?? 10;
  if (!Number.isInteger(minCell) || minCell < 1)
    throw new BadRequestException("minCell 必须是 ≥1 的整数");
  if (!Number.isInteger(minCellRare) || minCellRare < 1)
    throw new BadRequestException("minCellRare 必须是 ≥1 的整数");
  if (minCellRare < minCell)
    throw new BadRequestException(
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
