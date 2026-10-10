import { currentConnectorSpaceId } from "../space/space-context";
import { Injectable, Logger } from '@nestjs/common';
import {
  MdopError,
  parseMdopContract,
  computePlanHash,
  deriveOutputLabel,
  fragmentHash,
  parseFragment,
  parseOperatorManifest,
  parseTicketCore,
  validateEdge,
  type Fragment,
  type FlowLabel,
  type NodeCapability,
  type PlanEdge,
  type TicketCore,
} from '@medtrust/mdop';
import type { LocalMdopContract } from '@medtrust/database';
import { MdopContractStore } from './contract-store';
import { MdopOperatorWhitelistStore } from './operator-whitelist';
import { platformPublicKey } from '../domain/platform-keys';

/**
 * 七项本地复核（任务 8.3 / 协议 §7.4、规格「七项本地复核」）。
 *
 * **只用本地输入**：本地合约副本、本地白名单、本地（已验签的）算子清单，
 * 不采信要约随附的合约内容与平台编译结果。逐项失败对应固定错误码：
 *
 * | # | 检查 | 错误码 |
 * |---|---|---|
 * | 1 | 白名单 / 未吊销 / 清单签名 | `E_OP_NOT_WHITELISTED` / `E_OP_REVOKED` |
 * | 2 | 用途与合约、数据集范围、有效期 | `E_PURPOSE_MISMATCH` / `E_CONTRACT_EXPIRED` |
 * | 3 | 本方子图重算标签 | `E_LABEL_VIOLATION` |
 * | 4 | 边界边对端与 C3 目标 | `E_CAPABILITY_MISMATCH` |
 * | 5 | 预算（连接器本地仍无账本，一律拒 ε>0；**节点侧自行记账**） | `E_BUDGET_EXCEEDED` |
 * | 6 | 伦理批件 | `E_ETHICS_MISSING` |
 * | 7 | 片段哈希与 plan_hash | `E_TICKET_INVALID` |
 */

export interface JobHeaderView {
  job_id: string;
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  ethics_ref?: string;
  dp_budget?: number;
  not_before: string;
  not_after: string;
}

export interface FragmentOfferInput {
  ticketId: string;
  core: TicketCore;
  jobHeader: JobHeaderView;
  /** 本方片段（含边界边）。 */
  fragment: unknown;
  /** 节点 → 片段哈希表。 */
  fragments: Record<string, string>;
}

export interface ReviewOutcome {
  fragment: Fragment;
  contract: LocalMdopContract;
  /** 快照计算用的数据产品 id（= 本地合约条款里的 `data_product_id`）。 */
  dataProductId: string;
  /** 本节点数据快照标识（文件数据源 = 文件字节 SM3），随接受签名一起锁定。 */
  snapshot: string;
  capability: NodeCapability;
  /**
   * 本方片段里**接收 C2 的对端节点**（任务 6.5）。
   *
   * 复核只能校验「合约声明了证明策略、且这个对端是我们认识的参与方」——**要约时还不存在本次会话的证明**。
   * 因此把对端记下来，投递阶段（§6.1）与执行前（`verifyC2Execution`）各自再校验实际证明与释放凭据；
   * 三处判据不同、缺一不可，但都不采信平台的证明登记结果。
   */
  c2Targets: string[];
}

export interface ReviewDeps {
  /** 本节点标识（URN）。 */
  node: string;
  /** 本节点数据快照提供者（§9 接真实数据加载；缺省按数据产品 id 派生）。 */
  snapshotFor?: (dataProductId: string, stageIds: string[]) => Promise<string | null> | string | null;
  /** 复核时刻（测试用）。 */
  now?: Date;
}

@Injectable()
export class MdopReviewService {
  private readonly logger = new Logger(MdopReviewService.name);

  constructor(
    private readonly contracts: MdopContractStore,
    private readonly whitelist: MdopOperatorWhitelistStore,
  ) {}

  async review(offer: FragmentOfferInput, deps: ReviewDeps): Promise<ReviewOutcome> {
    const now = deps.now ?? new Date();
    const core = parseTicketCore(offer.core);
    const fragment = parseFragment(offer.fragment);
    if (fragment.node !== deps.node)
      throw new MdopError('E_CAPABILITY_MISMATCH', { node: fragment.node }, '片段不是发给本节点的');

    // ── 第 2 项（先取本地合约；缺失即 E_CONTRACT_UNSIGNED，见规格「本地合约库」）──
    const contractId = await this.contractIdFor(fragment, offer.jobHeader.contracts);
    const usable = await this.contracts.usableContract(contractId, now);
    if (!usable.ok) {
      if (usable.reason === 'missing')
        throw new MdopError('E_CONTRACT_UNSIGNED', {}, '本地没有该合约副本（旧合约或未确认）');
      throw new MdopError('E_CONTRACT_EXPIRED', {}, `合约不可用：${usable.reason}`);
    }
    const contract = usable.contract;
    // 本地**规范化合约全文**才是权威（被双方签过名的那一份）
    const terms = parseMdopContract(JSON.parse(contract.canonical));
    if (contract.purposeCode !== offer.jobHeader.purpose)
      throw new MdopError('E_PURPOSE_MISMATCH', {}, '用途编码与本地合约不一致');
    // 当前时间与凭证有效期都要落在合约有效期内
    const [contractFrom, contractUntil] = [
      Date.parse(contract.validFrom),
      Date.parse(contract.validUntil),
    ];
    for (const [label, iso] of [
      ['当前时间', now.toISOString()],
      ['凭证起点', core.not_before],
      ['凭证终点', core.not_after],
    ] as const) {
      const ts = Date.parse(iso);
      if (Number.isFinite(contractFrom) && ts < contractFrom)
        throw new MdopError('E_CONTRACT_EXPIRED', {}, `${label}早于合约生效时间`);
      if (Number.isFinite(contractUntil) && ts > contractUntil)
        throw new MdopError('E_CONTRACT_EXPIRED', {}, `${label}晚于合约有效期`);
    }

    // ── 第 6 项：伦理批件 ────────────────────────────────────────────────
    if (terms.ethics.required) {
      const ref = offer.jobHeader.ethics_ref;
      if (!ref || ref !== terms.ethics.ref)
        throw new MdopError('E_ETHICS_MISSING', {}, '作业的伦理批件号与本地合约不一致');
      if (terms.ethics.valid_until && Date.parse(terms.ethics.valid_until) < now.getTime())
        throw new MdopError('E_ETHICS_MISSING', {}, '伦理批件已过期');
    }

    // ── 第 5 项：预算 ────────────────────────────────────────────────────
    // 数据持有方（连接器）本地**仍然不申请 DP 预算**：它这一侧没有账本，ε>0 一律拒（fail-closed）。
    // 这不随 C2 改变，两条边界要说清：
    //  ① **查询预算属于节点侧**：C2 场景下「对一个可解密环境提问」的次数由**可信空间节点**内的
    //     账本自记账（`node/budget-ledger.ts`，D-TEE-2 要求由被测代码强制），不回流到连接器；
    //  ② 连接器这一侧只保留「未启用账本即拒」的语义——将来若在院内本地开账本，那是独立功能，
    //     不是靠开 C2 顺带打开。把两者混起来会让「谁在计费、谁在拒」变得说不清。
    if ((offer.jobHeader.dp_budget ?? 0) > 0)
      throw new MdopError('E_BUDGET_EXCEEDED', {}, '本节点未启用预算账本');

    // ── 第 1 项：白名单 / 吊销 / 清单签名 ────────────────────────────────
    const manifests = new Map<string, ReturnType<typeof parseOperatorManifest>>();
    for (const stage of fragment.stages) {
      const manifest = this.whitelist.manifestFor(stage.op);
      if (!manifest) {
        // 清单未同步/未验签 → 视为未加白（fail-closed）
        throw new MdopError('E_OP_NOT_WHITELISTED', { node: deps.node }, `算子清单未同步：${stage.op}`);
      }
      const digest = manifest.kind === 'wasm' ? manifest.digest : stage.op;
      try {
        await this.whitelist.assertExecutable(digest, manifest.kind === 'wasm' ? 'wasm' : 'system');
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'E_OP_REVOKED') throw new MdopError('E_OP_REVOKED', {}, `算子已吊销：${stage.op}`);
        throw new MdopError('E_OP_NOT_WHITELISTED', { node: deps.node }, `算子未加白：${stage.op}`);
      }
      manifests.set(stage.op, manifest);
    }

    // ── 第 3 项：用本地清单重算本方子图标签 ──────────────────────────────
    const capability = await this.localCapability(deps.node);
    const labels = new Map<string, FlowLabel>();
    for (const stage of fragment.stages) {
      const manifest = manifests.get(stage.op)!;
      const inputLabels: FlowLabel[] = stage.inputs.map((input) => {
        if (input.from.startsWith('ds://')) return 'C0';
        const upstream = labels.get(input.from);
        if (!upstream)
          throw new MdopError('E_LABEL_VIOLATION', { edge: `${input.from}->${stage.id}` }, '上游阶段不在本方子图内');
        return upstream;
      });
      const derived = deriveOutputLabel(manifest, inputLabels);
      if (derived !== stage.output_label)
        throw new MdopError(
          'E_LABEL_VIOLATION',
          { edge: stage.id },
          `阶段 ${stage.id} 声明的等级 ${stage.output_label} 与本地重算的 ${derived} 不一致`,
        );
      labels.set(stage.id, derived);
    }

    // ── 第 4 项：边界边的对端与 C3 目标 ─────────────────────────────────
    const recipients = terms.recipients.map((r) => r.party);
    // 本地视角的能力表：本方 + 本地已固定的平台节点。
    // 平台节点的 TEE/协同协议按「本期一律没有」处理（D-MDOP-6）——因此 C1/C2 边必拒。
    const peerCapabilities = new Map<string, NodeCapability>([[deps.node, capability]]);
    const platformUrn = `urn:tds:${currentConnectorSpaceId()}:participant:platform`;
    peerCapabilities.set(platformUrn, {
      node: platformUrn,
      runtime: ['native'],
      system_ops: [],
      whitelist_digests: [],
      tee: null,
      protocols: [],
    });
    const c2Targets: string[] = [];
    for (const edge of fragment.edges) {
      if (edge.label === 'C2') {
        // C2 边（任务 6.5）：复核阶段**只**能判「合约允不允许」与「对端认不认识」——
        // 本次会话的证明要到投递/执行时才产生（那时由 §6.1 与 verifyC2Execution 校验实际证明与释放凭据）。
        // 这里不假装验证证明，MUST NOT 采信平台侧的登记结果；也 MUST NOT 用「平台说它是 TEE」放行。
        if (!terms.attestation_policy)
          throw new MdopError(
            'E_CAPABILITY_MISMATCH',
            { edge: `${edge.from_stage}->${edge.to_stage}` },
            '本地合约未声明证明策略，不允许把 C2 制品流向任何节点',
          );
        // 边声明的等级必须与上游阶段重算出的输出等级一致——否则可以把 C3 输出标成 C2 边，
        // 或反过来把 C2 输出当 C3 投出去（标签洗白）。
        const fromLabel = labels.get(String(edge.from_stage));
        if (fromLabel !== 'C2')
          throw new MdopError(
            'E_LABEL_VIOLATION',
            { edge: `${edge.from_stage}->${edge.to_stage}` },
            `C2 边的上游阶段输出等级是 ${fromLabel ?? '未知'}，不是 C2`,
          );
        if (edge.to_node !== deps.node && !recipients.includes(edge.to_node))
          throw new MdopError(
            'E_CAPABILITY_MISMATCH',
            { edge: `${edge.from_stage}->${edge.to_stage}` },
            'C2 边的对端不在合约接收方/参与方之列',
          );
        if (!c2Targets.includes(edge.to_node)) c2Targets.push(edge.to_node);
        continue;
      }
      validateEdge(edge as PlanEdge, {
        contract_recipients: recipients,
        capabilities: peerCapabilities,
      });
      // 对端必须是我们认识的节点：平台节点（本地固定公钥）或合约参与方
      if (edge.to_node !== deps.node && !recipients.includes(edge.to_node))
        throw new MdopError(
          'E_CAPABILITY_MISMATCH',
          { edge: `${edge.from_stage}->${edge.to_stage}` },
          '边界边的对端不在合约接收方/参与方之列',
        );
    }

    // ── 第 7 项：片段哈希与 plan_hash ────────────────────────────────────
    const ownHash = fragmentHash(fragment);
    if (offer.fragments[deps.node] !== ownHash)
      throw new MdopError('E_TICKET_INVALID', { node: deps.node }, '本方片段哈希与要约不符');
    const recomputedPlan = computePlanHash({ job: offer.jobHeader, fragments: offer.fragments });
    if (recomputedPlan !== core.plan_hash)
      throw new MdopError('E_TICKET_INVALID', {}, '重算的 plan_hash 与凭证核心不符');

    // 本节点数据快照（随接受签名锁定；执行时重算比对）
    const snapshot =
      (await deps.snapshotFor?.(terms.data_product_id, fragment.stages.map((s) => s.id))) ??
      `sm3:${'0'.repeat(64)}`;
    this.logger.log(`片段通过七项复核 ticket=${core.ticket_id} node=${deps.node}`);
    return {
      fragment,
      contract,
      dataProductId: terms.data_product_id,
      snapshot,
      capability,
      c2Targets,
    };
  }

  /**
   * 从作业引用的合约列表里挑**本院这一份**。
   *
   * 一份作业可以引用多家医院的合约；按列表顺序取第一份会把别院的合约当成自己的
   * （本院本地没有该副本 → 误报 `E_CONTRACT_UNSIGNED`）。判据取自片段自身的
   * `ds://<node>/<dataProductId>`：与本地合约条款里的 `data_product_id` 对齐。
   */
  private async contractIdFor(fragment: Fragment, contracts: string[]): Promise<string> {
    const datasets = new Set<string>();
    for (const stage of fragment.stages)
      for (const input of stage.inputs)
        if (input.from.startsWith('ds://')) datasets.add(input.from.split('/').pop() ?? '');

    const presentLocally: string[] = [];
    for (const id of contracts) {
      const local = await this.contracts.get(id);
      if (!local) continue;
      presentLocally.push(id);
      if (datasets.size === 0) continue;
      try {
        const terms = parseMdopContract(JSON.parse(local.canonical));
        if (datasets.has(terms.data_product_id)) return id;
      } catch {
        // 本地副本解析失败：不予采用（继续找下一份）
      }
    }
    // 作业只引用一份本院合约（单一数据产品）时，按「本地确实有这份副本」采纳
    if (presentLocally.length === 1) return presentLocally[0];
    // 其余情况按原样返回第一份：找不到/多份歧义都应由下面的复核以正确错误码拒绝
    return presentLocally[0] ?? contracts[0];
  }

  /** 本节点的能力通告（与心跳上报一致；用于复核时的能力匹配）。 */
  async localCapability(node: string): Promise<NodeCapability> {
    const advertised = await this.whitelist.capabilityAdvertise();
    return {
      node,
      runtime: advertised.runtime,
      system_ops: advertised.system_ops,
      whitelist_digests: advertised.whitelist_digests,
      tee: advertised.tee,
      protocols: advertised.protocols,
    };
  }

  /** 平台节点公钥是否已在部署配置里固定（复核第 4 项的前提）。 */
  platformKeyPinned(): boolean {
    return !!platformPublicKey('platform-node');
  }
}
