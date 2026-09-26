import { MdopError } from '@medtrust/mdop';
import type { MdopStageExecutor, StageInput } from '../mdop/mdop-executor';
import type { NodePublicationReview, PublicationReviewRecord } from '../mdop/node/publication-review';

/**
 * 节点侧的**降密算子**（任务 3.12d）：把节点内的发布审查注册成 `declassify.small_cell@1.0.0`。
 *
 * 为什么要有这一步：模板把「C2 → C3」表达成一个**独立阶段**（与连接器侧同构、也是协议模型里的
 * 标准写法），那么节点就必须有一个同名算子来承载它。真实的降密判定在节点内由**被测代码**强制，
 * 所以这里注册的不是一个「过一遍就放行」的直通，而是 `NodePublicationReview` 本身：
 *
 *   候选结果（节点内 C2 制品）→ 小单元格抑制 + 可识别内容拦截 → 过闸门后的载荷
 *
 * 三条边界（与连接器侧 `operators/l15.ts` 的 `declassify` 同口径）：
 *  ① `minCell` 取**合约与参数的较大值**——参数不得弱于合约（编译期已拦一次，这里是纵深防御）；
 *  ② 缺 `minCell` 即拒（fail-closed），不拿「没有阈值」当「不用阈值」；
 *  ③ 输出等级恒为 **C3**：审查通过的就只可能是可出域的那一份；未通过的直接失败，没有降级路径。
 *
 * 审查记录**不放进载荷**（抑制明细是节点本地事实，随审计回执走），而是按 `作业:阶段` 存下来，
 * 由出口那一步拿去造**随行发布审查清单**（`session.publish`）。这样同一次审查只做一遍：
 * 若在出口处再审查一次，第二次的 `suppressed` 会因为「已经抑制过」而算成 0，清单就会**少报**。
 */

export const NODE_DECLASSIFY_OP = 'declassify.small_cell@1.0.0';

export interface NodeDeclassifyDeps {
  /** 节点内的发布审查（判据只有这一份）。 */
  review: NodePublicationReview;
  /**
   * 本阶段的**本地合约条款**（`publication.minCell` 从验过的合约副本取，不从消息里取）。
   * 缺省只用阶段参数——此时合约侧的阈值由调用方另行保证（本项目里派发器总是给）。
   */
  contractTerms?(input: StageInput): Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
}

export interface NodeDeclassifyRegistration {
  /** 某个阶段的发布审查记录（出口造清单用；**不会**重跑审查）。 */
  recordFor(jobId: string, stageId: string): PublicationReviewRecord | undefined;
}

/** 合约里的发布条件（形状与既有实现一致：`publication.minCell`）。 */
function contractMinCell(terms: Record<string, unknown> | undefined): number {
  const publication = terms?.publication as { minCell?: unknown } | undefined;
  const value = Number(publication?.minCell ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function registerNodeDeclassifyOperator(
  executor: MdopStageExecutor,
  deps: NodeDeclassifyDeps,
): NodeDeclassifyRegistration {
  const records = new Map<string, PublicationReviewRecord>();

  executor.registerSystem(NODE_DECLASSIFY_OP, async (input: StageInput) => {
    // 候选结果＝上游产物（节点内 C2 制品）。多个上游一律拒：降密只处理**一份**候选结果，
    // 「把两份不同的候选拼起来再放行」不在本算子的语义里。
    const candidates = [...input.inputs.values()];
    if (candidates.length !== 1)
      throw new MdopError(
        'E_RUNTIME',
        {},
        `declassify.small_cell 需要且只需要一份上游候选结果（收到 ${candidates.length} 份）`,
      );
    // 条款优先级：阶段带来的**本地合约条款**（调用方从验过的副本取）> 装配方给的回退来源。
    // 两处都不给时不猜——只看阶段参数（缺 minCell 即下面拒）。
    const terms = input.contractTerms ?? (await deps.contractTerms?.(input));
    const minCell = Math.max(
      contractMinCell(terms),
      Number.isFinite(Number(input.stage.params.minCell)) ? Number(input.stage.params.minCell) : 0,
    );
    if (!minCell)
      throw new MdopError('E_RUNTIME', {}, 'declassify.small_cell 需要合约或参数给出 minCell');

    const contractId = String(input.stage.params.contractId ?? terms?.contract_id ?? '');
    const { payload, record } = deps.review.review({
      candidate: candidates[0],
      minCell,
      contractId,
    });
    records.set(`${input.jobId}:${input.stage.id}`, record);
    // 过闸门后的载荷里，**分层表必须与抑制后的计数一致**：发布审查是按 `buckets` 做小单元格抑制的，
    // 而平台侧的收集方读的是 `strata`——两者不一致就会出现「平台拿到未抑制的分层计数」
    // （差一个格子就是可识别性泄露）。这里把被抑制的分层整格清零并标记，口径与 `buckets` 同步。
    return { label: 'C3', schema: input.stage.output_schema, payload: alignStrata(payload) };
  });

  return { recordFor: (jobId, stageId) => records.get(`${jobId}:${stageId}`) };
}

/**
 * 让 `strata` 与过闸门后的 `buckets` 对齐：
 *  - 被抑制（`suppressed === true`）或计数为 0 的分层 → 整格清零并标 `suppressed: true`；
 *  - 其余分层原样保留。
 *
 * 「计数本来就是 0」也一并视为不可发布：那是**保守口径**（fail-closed），
 * 宁可少发一个空分层，也不让一个可能被抑制过的格子以「恰好为 0」的样子留在结果里。
 */
function alignStrata(payload: Record<string, unknown>): Record<string, unknown> {
  const buckets = payload.buckets;
  const strata = payload.strata;
  if (!Array.isArray(buckets) || !Array.isArray(strata)) return payload;
  const unpublished = new Set(
    (buckets as Array<{ key?: unknown; count?: unknown; suppressed?: unknown }>)
      .filter((b) => b?.suppressed === true || Number(b?.count ?? 0) === 0)
      .map((b) => String(b?.key ?? '')),
  );
  return {
    ...payload,
    strata: (strata as Array<Record<string, unknown>>).map((cell) =>
      unpublished.has(String(cell.key ?? ''))
        ? { key: cell.key, exposed: 0, outcome: 0, exposedWithOutcome: 0, cohortSize: 0, rate: 0, suppressed: true }
        : cell,
    ),
  };
}
