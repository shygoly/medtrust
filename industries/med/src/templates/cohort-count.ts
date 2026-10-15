/**
 * 队列规模（年龄带）`rws.cohort-count` 计划模板 —— 批次 2 的第一型。
 *
 * design D1 的「平台侧合并组」里最简单的一型：各院各算**同形状的分类计数**，平台按分类键相加，
 * 不需要节点内计算、不需要 C2 目标。
 *
 * **口径（design D6 拍板后统一）**：旧链按 `ageBand` **计数记录行**（`cohort.length`，不是去重主体）。
 * 因此本模板不用 `distinct-count`（去重主体口径），改用本批次新增的 `rws.categorical-count@1.0.0` ——
 * L0/L1 三型（本型 / condition-prevalence / adverse-event-signal）口径自此统一。
 *
 * 语义边界：口径是**各院分类计数相加**；同一主体若在两院都有记录会各算一次
 * （跨院去重是 `rws.dedup-incidence` 的分内事，本型不重复它的语义）。
 */
import { PlanInputError } from "@medtrust/mdop";
import { DEFAULT_COHORT_AGE_BANDS, normalizeHolders } from "./category-dictionaries";
import type { LogicalPlanDraft } from "@medtrust/mdop";
import type { PlanTemplate, SpiContext } from "@medtrust/space-kernel-spi";

export interface CohortCountTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  /** 参与统计的持有方（`holders` 与既有入口的 `hospitals` 同义，两个都收）。 */
  holders?: Array<{ participantId: string; dataProductId: string }>;
  hospitals?: Array<{ participantId: string; dataProductId: string }>;
  /** 分层键（`ageBand|sex` 形态）；缺省由各院行里的 `ageBand`/`sex` 决定。 */
  strataKeys?: string[];
  /** 小单元格阈值下限（缺省由合约决定）。 */
  /** 可选：只统计服用了该目标药（`medications` 含此值）的队列 —— 旧链三型都支持的口径。 */
  drug?: string;
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

/**
 * 队列规模：**各院 source -> 封存（标量分类投影，取 ageBand）-> categorical-count -> 降密；平台按分类键相加**。
 */
export function buildCohortCountPlan(
  input: CohortCountTemplateInput,
  _space: string,
): LogicalPlanDraft {
  const holders = normalizeHolders(input);
  if (!holders.length)
    throw new PlanInputError("队列规模至少需要一家持有方");
  if (!input.contracts?.length)
    throw new PlanInputError("队列规模至少需要一份合约");
  const seen = new Set<string>();
  for (const h of holders) {
    if (!h.participantId) throw new PlanInputError("持有方缺少参与方 id");
    if (seen.has(h.participantId))
      throw new PlanInputError(`队列规模的持有方重复：${h.participantId}`);
    seen.add(h.participantId);
  }

  const stages: LogicalPlanDraft["stages"] = [];
  const sealed: string[] = [];
  for (const holder of holders) {
    const node = holder.participantId;
    const suffix = node.replace(/[^A-Za-z0-9]/g, "");
    const src = `src_${suffix}`;
    const seal = `seal_${suffix}`;
    const count = `count_${suffix}`;
    const dec = `dec_${suffix}`;
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
      // 字段名（`ageBand`）由包侧给出：域词留在包内，基座只按名字取。
      params: {
        contractId: input.contracts[0],
        projection: "scalar-category",
        categoryField: "ageBand",
        // 按目标药过滤队列（旧链 matchesMedication 的口径）：字段名与值都由本包给出。
        ...(input.drug
          ? { filterField: "medications", filterValue: input.drug }
          : {}),
      },
    });
    stages.push({
      id: count,
      op: "rws.categorical-count@1.0.0",
      inputs: [{ from: seal }],
      params: {
        // 节点侧按 `params.dataset.ref` 取该阶段上游的投影行。
        dataset: { ref: seal },
        // 空心列表没有意义：省缺时用本包默认年龄带（调用方仍可覆盖）。
        categoryKeys: input.strataKeys?.length
          ? input.strataKeys
          : [...DEFAULT_COHORT_AGE_BANDS],
      },
    });
    stages.push({
      id: dec,
      op: "declassify.small_cell@1.0.0",
      inputs: [{ from: count }],
      params: {
        ...(input.minCell !== undefined ? { minCell: input.minCell } : {}),
        contractId: input.contracts[0],
      },
    });
    sealed.push(dec);
  }

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

/** SPI 的 S2 声明（`OperatorPack.declareTemplates` 的返回项）。 */
export const cohortCountTemplate: PlanTemplate = {
  id: "rws.cohort-count",
  build(input: unknown, ctx: SpiContext) {
    return buildCohortCountPlan(input as CohortCountTemplateInput, ctx.spaceId);
  },
};
