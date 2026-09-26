import {
  MdopError,
  assertDeclassifyNotWeaker,
  assertNodeCanRun,
  canonicalSm3,
  compareTcb,
  computePlanHash,
  deriveOutputLabel,
  fragmentHash,
  holderSignAcceptance,
  isCrossNode,
  parseFragment,
  parseOperatorRef,
  parseTicketCore,
  resolveMeasurementWhitelist,
  type AttestationExpectation,
  type AttestationPolicy,
  type FlowLabel,
  type Fragment,
  type MdopContract,
  type NodeCapability,
  type OperatorManifest,
  type TicketCore,
  type TicketSignature,
} from '@medtrust/mdop';
import type { NodeContractStore } from './contract-store';

/**
 * 可信空间节点对**片段要约**的本地复核（任务 3.17、协议 §7.4）。
 *
 * 为什么节点也要复核：可信空间节点是**一等参与方**——它的片段同样要过复核并**自己签名接受**，
 * 否则平台侧「收齐全部片段的接受签名才签发凭证」这一步会永远等不到它（`MdopTicketService`
 * 的 `holderNodes` 取全部片段节点）。也就是说：**节点不复核、不接受，C2 作业连凭证都拿不到**，
 * 后面的中继与执行都不会发生。
 *
 * 与数据持有方连接器的复核**同口径、不同落点**——两侧都只用本地输入，都不采信平台随消息给的结论：
 *
 * | # | 检查 | 错误码 | 与持有方的差异 |
 * |---|---|---|---|
 * | 1 | 片段属于本节点且结构合法 | E_CAPABILITY_MISMATCH | 同 |
 * | 2 | 本地合约副本覆盖全部阶段算子、用途与有效期一致 | E_CONTRACT_UNSIGNED / E_CONTRACT_EXPIRED / E_PURPOSE_MISMATCH | 节点没有 ds://，按「哪份本地副本覆盖全部算子」挑 |
 * | 3 | 伦理批件与合约一致（需要时） | E_ETHICS_MISSING | 同 |
 * | 4 | 预算：节点**有**账本，故可接受 dp_budget（持有方无账本，一律拒） | E_BUDGET_EXCEEDED | **不同**，见 D-TEE-2 |
 * | 5 | 算子在本节点白名单、未吊销、可跑（运行时/系统算子登记） | E_OP_NOT_WHITELISTED / E_OP_REVOKED / E_CAPABILITY_MISMATCH | 节点跑 TEE 环境 |
 * | 6 | 用本地清单重算本方子图等级（含跨节点边界边） | E_LABEL_VIOLATION | 跨节点输入按**边界边的 label** 解析 |
 * | 7 | 边界边与 C3 目标；C2 边必须指向本节点且合约声明策略 | E_LABEL_VIOLATION / E_CAPABILITY_MISMATCH | 节点是 C2 的**接收方** |
 * | 8 | 凭证里给本节点冻结的执行环境期望与本节点**实际能力**相符 | E_ATTESTATION_FAILED / E_MEASUREMENT_NOT_ALLOWED / E_TCB_TOO_OLD | 节点自查「我够不够格」 |
 * | 9 | 片段哈希与 plan_hash | E_TICKET_INVALID | 同 |
 *
 * **快照语义（节点侧与持有方不同，协议 §7.5 已补注）**：持有方签的是**数据快照**；
 * 节点在要约时刻还没有任何封存输入，它签的是**执行环境快照**——将被执行的算子摘要 + 凭证里冻结的
 * 度量期望。执行时重算不一致（换了算子摘要或换了期望）即 E_SNAPSHOT_CHANGED。
 * 这比「签一个恒等于自己的值」有意义：它把「我批准的是这份代码」钉在凭证里。
 */

/** 节点侧的算子白名单（已验签清单；吊销状态由实现注入）。 */
export interface NodeOperatorWhitelist {
  /** 取已验签的清单引用；没有即未加白（fail-closed）。 */
  manifestFor(opRef: string): OperatorManifest | undefined;
  /** 吊销检查；抛 E_OP_REVOKED 即视为已吊销。 */
  assertExecutable?(input: {
    op: string;
    digest: string;
    kind: 'wasm' | 'system';
  }): Promise<void> | void;
}

export interface NodeJobHeader {
  job_id: string;
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  ethics_ref?: string;
  dp_budget?: number;
  not_before: string;
  not_after: string;
}

export interface NodeOfferInput {
  ticketId: string;
  core: unknown;
  jobHeader: NodeJobHeader;
  /** 本节点片段（含与它相关的全部边界边）。 */
  fragment: unknown;
  /** 节点 → 片段哈希表。 */
  fragments: Record<string, string>;
}

export interface NodeFragmentReviewDeps {
  /** 本节点标识（URN）。 */
  node: string;
  /** 本地已验签的合约副本库（条款只从这里取）。 */
  contracts: NodeContractStore;
  whitelist: NodeOperatorWhitelist;
  /** 本节点能力（由**真跑一次证明**得出；软件提供者恒 tee: null）。 */
  capability(): Promise<NodeCapability> | NodeCapability;
  /** 注册中心的度量白名单（上限；合约只能更严）。 */
  registryMeasurements: readonly string[];
  /** 本节点是否启用查询预算账本（缺省 true——节点内账本已落地）。 */
  budgetLedger?: boolean;
  now?: Date;
}

export interface C2InboundEdge {
  /** 本节点上承接这份 C2 的阶段。 */
  stageId: string;
  /** 对端（持有方）封存阶段的 id。 */
  fromStage: string;
  /** 对端节点（持有方 URN）。 */
  fromNode: string;
}

export interface NodeFragmentReviewOutcome {
  fragment: Fragment;
  contractId: string;
  terms: MdopContract;
  /** 作业头（执行阶段取申请方与快照口径用；复核时已验过用途与有效期）。 */
  jobHeader: NodeJobHeader;
  /** 各阶段的已验签清单（执行阶段直接用它，不再重新解析）。 */
  manifests: Map<string, OperatorManifest>;
  /** 本节点接受时签入的**执行环境快照**（执行时重算比对）。 */
  snapshot: string;
  /** 凭证里为本节点冻结的执行环境期望（C2 作业才有）。 */
  expectation?: AttestationExpectation;
  /** 本节点承接的 C2 入边：执行阶段据此把信封喂给正确的阶段。 */
  c2Inbound: C2InboundEdge[];
}

/**
 * 节点侧快照 = **执行环境快照**：将被执行的算子摘要 + 凭证里冻结的度量期望 + **本节点当前的证明能力**。
 *
 * 确定性：复核与执行两侧用同一组入参算出同一个值。任何一项变了（换算子版本、换期望、
 * 本节点的链型或可信基变了）即对不上 → `E_SNAPSHOT_CHANGED`，作业需要重新走一次要约与凭证。
 *
 * **为什么环境变了要停下来**：持有方批准的是「在这份代码、这条链、这个可信基下限」下执行。
 * 节点自己换了链型或可信基（固件/微码升级、救援过的机器）意味着原先的批准不再有依据，
 * 宁可让人重新确认一次，也不让「环境悄悄变了照跑」——这正是 C2 与「聚合出域」的差别所在。
 *
 * 环境本身还有**更强**的一道检查：会话解封时的证明 + KMS 释放凭据（`verifyC2Execution`）。
 * 快照这一道是**声明层的绑定**（把接受签名钉在具体片段与期望上），两道都要过。
 */
export function nodeEnvironmentSnapshot(
  fragment: Fragment,
  expectation?: AttestationExpectation,
  capability?: NodeCapability,
): string {
  return canonicalSm3({
    node: fragment.node,
    stages: fragment.stages.map((s) => ({ id: s.id, op: s.op, op_digest: s.op_digest })),
    tee: capability?.tee ? { kind: capability.tee.kind, min_tcb: capability.tee.min_tcb ?? null } : null,
    ...(expectation
      ? {
          expectation: {
            tee: expectation.tee,
            measurement: expectation.measurement,
            min_tcb: expectation.min_tcb ?? null,
          },
        }
      : {}),
  });
}

/** 复核一份片段要约。通过即返回可直接用于接受签名的结论；不通过即抛带错误码的 `MdopError`。 */
export async function reviewFragmentForNode(
  deps: NodeFragmentReviewDeps,
  offer: NodeOfferInput,
): Promise<NodeFragmentReviewOutcome> {
  const now = deps.now ?? new Date();
  const core: TicketCore = parseTicketCore(offer.core);
  const fragment = parseFragment(offer.fragment);

  // ── 1. 片段属于本节点 ────────────────────────────────────────────────
  if (fragment.node !== deps.node)
    throw new MdopError('E_CAPABILITY_MISMATCH', { node: fragment.node }, '片段不是发给本节点的');

  // ── 2. 本地合约副本：必须覆盖本片段的全部算子；用途与有效期一致 ────────
  const { contractId, terms } = selectLocalContract(deps, fragment, offer.jobHeader);
  if (terms.purpose !== offer.jobHeader.purpose)
    throw new MdopError('E_PURPOSE_MISMATCH', {}, '用途与本地合约不一致');
  for (const [label, iso] of [
    ['当前时间', now.toISOString()],
    ['凭证起点', core.not_before],
    ['凭证终点', core.not_after],
  ] as const) {
    const ts = Date.parse(iso);
    if (Number.isFinite(Date.parse(terms.valid_from)) && ts < Date.parse(terms.valid_from))
      throw new MdopError('E_CONTRACT_EXPIRED', {}, `${label}早于合约生效时间`);
    if (Number.isFinite(Date.parse(terms.valid_until)) && ts > Date.parse(terms.valid_until))
      throw new MdopError('E_CONTRACT_EXPIRED', {}, `${label}晚于合约有效期`);
  }

  // ── 3. 伦理批件 ──────────────────────────────────────────────────────
  if (terms.ethics.required) {
    if (!offer.jobHeader.ethics_ref || offer.jobHeader.ethics_ref !== terms.ethics.ref)
      throw new MdopError('E_ETHICS_MISSING', {}, '作业的伦理批件号与本地合约不一致');
    if (terms.ethics.valid_until && Date.parse(terms.ethics.valid_until) < now.getTime())
      throw new MdopError('E_ETHICS_MISSING', {}, '伦理批件已过期');
  }

  // ── 4. 预算：节点**有**账本，因此可以接受预算申请（与持有方相反，见 D-TEE-2）──
  const budgetLedger = deps.budgetLedger ?? true;
  if ((offer.jobHeader.dp_budget ?? 0) > 0 && !budgetLedger)
    throw new MdopError('E_BUDGET_EXCEEDED', {}, '本节点未启用预算账本，不得接受任何预算申请');

  // ── 5. 算子：白名单 / 吊销 / 本节点能不能跑 ──────────────────────────
  const capability = await deps.capability();
  const manifests = new Map<string, OperatorManifest>();
  for (const stage of fragment.stages) {
    const manifest = deps.whitelist.manifestFor(stage.op);
    if (!manifest)
      throw new MdopError('E_OP_NOT_WHITELISTED', { node: deps.node }, `算子清单未同步：${stage.op}`);
    const kind: 'wasm' | 'system' = manifest.kind === 'wasm' ? 'wasm' : 'system';
    const digest = manifest.kind === 'wasm' ? manifest.digest : stage.op;
    try {
      await deps.whitelist.assertExecutable?.({ op: stage.op, digest, kind });
    } catch (err) {
      // 具体错误码**原样带出**：吊销与「吊销名单没同步」是两种不同的处置
      // （前者要换算子，后者要先同步名单），合成一个码会让平台与运维都看不出该做什么。
      const code = (err as { code?: string }).code;
      if (code === 'E_OP_REVOKED') throw new MdopError('E_OP_REVOKED', {}, `算子已吊销：${stage.op}`);
      if (code === 'E_REVOCATION_UNSYNCED')
        throw new MdopError(
          'E_REVOCATION_UNSYNCED',
          { node: deps.node },
          `尚未同步到有效的算子吊销名单，拒绝执行 wasm 算子：${stage.op}`,
        );
      throw new MdopError('E_OP_NOT_WHITELISTED', { node: deps.node }, `算子未加白：${stage.op}`);
    }
    // 运行时 / 系统算子登记：节点不假装自己能跑没登记的东西
    assertNodeCanRun(manifest, capability, parseOperatorRef(stage.op));
    manifests.set(stage.op, manifest);
  }

  // ── 6. 用本地清单重算本方子图等级（跨节点输入按边界边的 label 解析）──
  const labels = new Map<string, FlowLabel>();
  for (const stage of fragment.stages) {
    const manifest = manifests.get(stage.op)!;
    const inputLabels: FlowLabel[] = stage.inputs.map((input) => {
      if (input.from.startsWith('ds://')) return 'C0';
      const local = labels.get(input.from);
      if (local) return local;
      // 跨节点上游：本地没有它的阶段定义，只能取**边界边声明的等级**（要约里给了全部相关边）
      const edge = fragment.edges.find((e) => e.from_stage === input.from && e.to_stage === stage.id);
      if (!edge)
        throw new MdopError(
          'E_LABEL_VIOLATION',
          { edge: `${input.from}->${stage.id}` },
          '跨节点上游没有边界边，无法独立重算等级',
        );
      return edge.label;
    });
    const derived = deriveOutputLabel(manifest, inputLabels);
    if (derived !== stage.output_label)
      throw new MdopError(
        'E_LABEL_VIOLATION',
        { edge: stage.id },
        `阶段 ${stage.id} 声明的等级 ${stage.output_label} 与本地重算的 ${derived} 不一致`,
      );
    labels.set(stage.id, derived);

    // 降密算子：参数不得弱于合约发布条件（编译期已拦一次，这里是节点自己的纵深防御）
    if (manifest.category === 'declassify') {
      const withContractDefault: Record<string, unknown> = { ...stage.params };
      if (withContractDefault.minCell === undefined && terms.publication.minCell !== undefined)
        withContractDefault.minCell = terms.publication.minCell;
      assertDeclassifyNotWeaker(withContractDefault, terms.publication);
    }
  }

  // ── 7. 边界边：C0 不得跨节点、C3 目标在合约接收方、C2 边指向本节点 ─────
  const recipients = terms.recipients.map((r) => r.party);
  const c2Inbound: C2InboundEdge[] = [];
  for (const edge of fragment.edges) {
    if (!isCrossNode(edge)) continue;
    const edgeId = `${edge.from_stage}->${edge.to_stage}`;
    if (edge.label === 'C0')
      throw new MdopError('E_LABEL_VIOLATION', { edge: edgeId }, 'C0 制品不得跨节点');
    if (edge.label === 'C3') {
      if (!recipients.includes(edge.to_node))
        throw new MdopError(
          'E_CAPABILITY_MISMATCH',
          { edge: edgeId, node: edge.to_node },
          'C3 目标不在合约接收方列表里',
        );
      continue;
    }
    if (edge.label === 'C2') {
      if (!terms.attestation_policy)
        throw new MdopError(
          'E_CAPABILITY_MISMATCH',
          { edge: edgeId },
          '本地合约未声明证明策略，不允许把 C2 制品流向任何节点',
        );
      if (edge.to_node !== deps.node)
        throw new MdopError(
          'E_CAPABILITY_MISMATCH',
          { edge: edgeId, node: edge.to_node },
          'C2 边的目标是别的节点：本节点只能承接落在自己身上的 C2',
        );
      if (labels.has(edge.from_stage))
        throw new MdopError(
          'E_LABEL_VIOLATION',
          { edge: edgeId },
          'C2 边的上游在本节点：节点内不该出现 C2 边（C2 是跨节点形态）',
        );
      c2Inbound.push({ stageId: edge.to_stage, fromStage: edge.from_stage, fromNode: edge.from_node });
      continue;
    }
    // C1 要判「两端声明同一协同协议」，本地没有对端能力通告 ⇒ 判不了 ⇒ 拒（fail-closed）
    throw new MdopError(
      'E_CAPABILITY_MISMATCH',
      { edge: edgeId },
      '本地没有对端能力通告，无法判定该跨节点边（本期只放行 C2/C3 边）',
    );
  }

  // ── 8. C2 阶段：凭证里的期望必须与本节点**实际能力**相符 ──────────────
  const needsTee =
    fragment.stages.some((s) => s.input_labels.includes('C2')) || c2Inbound.length > 0;
  const expectation = core.attestation?.[deps.node];
  if (needsTee) {
    const policy = terms.attestation_policy;
    if (!policy)
      throw new MdopError('E_CAPABILITY_MISMATCH', {}, '本节点的片段含 C2 阶段，但合约未声明证明策略');
    if (!expectation)
      throw new MdopError(
        'E_ATTESTATION_FAILED',
        { node: deps.node },
        '凭证里没有为本节点冻结的执行环境期望',
      );
    if (!policy.tee.includes(expectation.tee))
      throw new MdopError('E_CAPABILITY_MISMATCH', {}, '凭证里的链型不在合约允许范围内');
    const effective = resolveMeasurementWhitelist({
      registryWhitelist: deps.registryMeasurements,
      policy: policy as AttestationPolicy,
    });
    if (!effective.includes(expectation.measurement))
      throw new MdopError('E_MEASUREMENT_NOT_ALLOWED', {}, '凭证里要求的执行环境度量不在生效白名单内');
    // 本节点**当下**够不够格：不看配置写了什么，看能力通告（它由真跑一次证明得出）
    if (!capability.tee)
      throw new MdopError(
        'E_ATTESTATION_FAILED',
        { node: deps.node },
        '本节点当前没有硬件证明能力（软件实现不得承接 C2 目标）',
      );
    if (capability.tee.kind !== expectation.tee)
      throw new MdopError(
        'E_ATTESTATION_FAILED',
        { node: deps.node },
        `本节点证明能力是 ${capability.tee.kind}，与凭证期望的 ${expectation.tee} 不符`,
      );
    if (expectation.min_tcb !== undefined) {
      const own = capability.tee.min_tcb;
      if (!own)
        throw new MdopError('E_TCB_TOO_OLD', {}, '本节点未报告可信基版本，无法满足凭证里的下限');
      const cmp = compareTcb(own, expectation.min_tcb);
      if (cmp === null)
        throw new MdopError('E_TCB_TOO_OLD', {}, '本节点可信基版本与凭证里的下限不可比');
      if (cmp < 0) throw new MdopError('E_TCB_TOO_OLD', {}, '本节点可信基版本低于凭证里的下限');
    }
  } else if (expectation) {
    // 没有 C2 阶段却在核心里有本节点的期望：口径不一致，如实拒（不静默忽略矛盾）
    throw new MdopError(
      'E_CAPABILITY_MISMATCH',
      { node: deps.node },
      '凭证为本节点冻结了执行环境期望，但本方片段不含 C2 阶段',
    );
  }

  // ── 9. 片段哈希与 plan_hash ──────────────────────────────────────────
  const ownHash = fragmentHash(fragment);
  if (offer.fragments[deps.node] !== ownHash)
    throw new MdopError('E_TICKET_INVALID', { node: deps.node }, '本方片段哈希与要约不符');
  const recomputedPlan = computePlanHash({ job: offer.jobHeader, fragments: offer.fragments });
  if (recomputedPlan !== core.plan_hash)
    throw new MdopError('E_TICKET_INVALID', {}, '重算的 plan_hash 与凭证核心不符');

  return {
    fragment,
    contractId,
    terms,
    jobHeader: offer.jobHeader,
    manifests,
    snapshot: nodeEnvironmentSnapshot(fragment, expectation, capability),
    ...(expectation ? { expectation } : {}),
    c2Inbound,
  };
}

/**
 * 从作业引用的合约列表里挑**能覆盖本片段全部算子**的那一份本地副本。
 *
 * 判据是「本地确实有这份副本」+「它的 `allowed_ops` 覆盖片段里每个阶段」——
 * 节点没有 `ds://` 阶段，无法像持有方那样按数据产品 id 对齐，因此按算子覆盖面挑；
 * 一份都覆盖不了即拒，不退回「随便取第一份」。
 */
function selectLocalContract(
  deps: NodeFragmentReviewDeps,
  fragment: Fragment,
  jobHeader: NodeJobHeader,
): { contractId: string; terms: MdopContract } {
  const ops = new Set(fragment.stages.map((s) => s.op));
  const candidates: Array<{ contractId: string; terms: MdopContract }> = [];
  for (const contractId of jobHeader.contracts ?? []) {
    const copy = deps.contracts.get(contractId);
    if (!copy) continue;
    if ([...ops].every((op) => copy.contract.allowed_ops.includes(op)))
      candidates.push({ contractId, terms: copy.contract });
  }
  if (candidates.length === 0)
    throw new MdopError(
      'E_CONTRACT_UNSIGNED',
      { node: deps.node },
      '本地没有覆盖本片段全部算子的已验签合约副本',
    );
  // 多份都覆盖：取列表里靠前的那一份（列表顺序由平台给出，但**内容**仍来自本地验过的副本）
  return candidates[0];
}

/** 接受签名（与数据持有方同一口径：签 `{core, snapshot}`）。 */
export function signNodeAcceptance(input: {
  core: TicketCore;
  snapshot: string;
  node: string;
  privateKey: string;
  publicKey: string;
}): TicketSignature {
  return holderSignAcceptance(
    input.core,
    input.snapshot,
    input.node,
    input.privateKey,
    input.publicKey,
  );
}
