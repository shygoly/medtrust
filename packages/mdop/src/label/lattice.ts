import { MdopError } from "../errors";
import type { OperatorManifest, OperatorRef } from "../schema/operator";
import { DISABLED_KINDS, operatorRefString } from "../schema/operator";

/**
 * 流动等级 C0–C3 与传播规则（协议 §4 / 规格「流动等级 C0–C3」「标签传播规则」）。
 *
 * 格：**C0 最严、C3 最宽，C1 与 C2 互不可比**。把「跨节点的可流动性」当作序：
 *   C0 ⊑ C1 ⊑ C3，C0 ⊑ C2 ⊑ C3，而 C1 与 C2 之间无序。
 * 于是普通算子的输出 = 全部输入的上确界（join）：
 *   join(C0,x)=x，join(C1,C3)=C3，join(C2,C3)=C3，join(C1,C1)=C1，join(C2,C2)=C2；
 *   **join(C1,C2) 不存在**——按 R2 的 fail-closed 兜底判为最严的 **C0**。
 */

export const FLOW_LABELS = ["C0", "C1", "C2", "C3"] as const;
export type FlowLabel = (typeof FLOW_LABELS)[number];

/** 「可流动性」序：C0 最小、C3 最大；C1/C2 只在 0 与 3 之间有边。 */
const COVERS: Record<FlowLabel, FlowLabel[]> = {
  C0: ["C1", "C2"],
  C1: ["C3"],
  C2: ["C3"],
  C3: [],
};

/** 序关系：a 是否 `⊑` b（b 至少与 a 一样可流动）。 */
export function leq(a: FlowLabel, b: FlowLabel): boolean {
  if (a === b) return true;
  const seen = new Set<FlowLabel>([a]);
  const queue: FlowLabel[] = [...COVERS[a]];
  while (queue.length) {
    const current = queue.shift() as FlowLabel;
    if (current === b) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...COVERS[current]);
  }
  return false;
}

/**
 * 上确界。C1 与 C2 互不可比且没有共同上界以外的下界——按 R2 判为最严的 C0。
 * 注意这是**规格明写的兜底**，不是格论意义上的 join。
 */
export function joinLabels(a: FlowLabel, b: FlowLabel): FlowLabel {
  if (a === b) return a;
  const incomparable = (a === "C1" && b === "C2") || (a === "C2" && b === "C1");
  if (incomparable) return "C0";
  if (leq(a, b)) return b;
  if (leq(b, a)) return a;
  return "C0";
}

/**
 * 一组输入的传播结果。**以输入集合为判据（与顺序无关）**：
 * 集合同时含 C1 与 C2 即判最严的 C0（协议 R2 的 fail-closed 兜底），
 * 否则按序取两个两个的 join。
 *
 * 注意：C1 与 C2 没有上确界，故这里不是格论意义上的 join，而是规格明写的兜底规则；
 * 「同时含 C1 与 C2 → C0」对**集合**成立，免得 `[C1, C2, C3]` 因归并顺序不同得出不同结论。
 */
export function joinAll(labels: readonly FlowLabel[]): FlowLabel {
  // 无输入（如 `source` 类算子）：没有「上游已经降过级」的证据，按最严的 C0 处理（fail-closed）。
  // 数据源算子的输出本来就是本地明文；把它默认成 C3 会凭空放开一级。
  if (labels.length === 0) return "C0";
  const set = new Set(labels);
  if (set.has("C1") && set.has("C2")) return "C0";
  return labels.reduce((acc, label) => joinLabels(acc, label));
}

/** 更严 = 可流动性更低。用于「输出不得比输入更宽」「参数不得弱于合约」的判断。 */
export function isStricterOrEqual(a: FlowLabel, b: FlowLabel): boolean {
  return leq(a, b);
}

export interface PlanEdge {
  from_stage: string;
  to_stage: string;
  label: FlowLabel;
  from_node: string;
  to_node: string;
}

export interface NodeCapability {
  node: string;
  /** 可用运行时：`wasm` / `native`。 */
  runtime: string[];
  /** 已登记的 system 算子（`id@version`）。 */
  system_ops: string[];
  /** 白名单摘要集合。 */
  whitelist_digests: string[];
  /** TEE 能力；本期一律为 null（D-MDOP-6）。 */
  tee: { kind: string; min_tcb?: string } | null;
  /** 协同协议及版本。 */
  protocols: { name: string; version: string }[];
}

export interface AttestationPolicy {
  /** 合约允许的证明链型（`csv` / `tdx` / `sev-snp`）；缺省为空表示不允许任何 C2 目标。 */
  tee: string[];
  /**
   * 可信基版本下限。
   *
   * 两种写法：单个字符串（只在该链的版本体系内可解释），或按链型分别给阈值
   * （`{ csv: "2026-06", tdx: "3.1.2" }`）。**不同链的版本体系不可互比**——
   * CSV 用年月、TDX/SEV 用点分数字，把 `2026-06` 当作 `3.1.2` 的门槛是无意义的，
   * 因此协议允许按链给出阈值，判定侧对「不可比」一律按 fail-closed 处理。
   */
  min_tcb?: string | Partial<Record<string, string>>;
  /**
   * 合约进一步收窄的度量清单（注册中心白名单之外的额外限制）。
   * 缺省表示只按注册中心白名单判定；两者由调用方合并后交给证明判定。
   */
  allowed_measurements?: readonly string[];
}

export interface EdgeCheckContext {
  /** 相关合约的接收方列表（party id）。 */
  contract_recipients: readonly string[];
  /** 节点 → 最近一次能力通告。 */
  capabilities: ReadonlyMap<string, NodeCapability>;
  /** 合约的证明策略（C2 用）。 */
  attestation_policy?: AttestationPolicy;
}

export function edgeRef(edge: PlanEdge): string {
  return `${edge.from_stage}->${edge.to_stage}`;
}

export function isCrossNode(edge: PlanEdge): boolean {
  return edge.from_node !== edge.to_node;
}

/**
 * 跨节点边的校验。任一失败都**指明违规的边**。
 *  - C0 边：`E_LABEL_VIOLATION`
 *  - C3 边：目标须在合约接收方列表里，否则 `E_CAPABILITY_MISMATCH`
 *  - C1 边：所有端点声明同一协议及版本，否则 `E_CAPABILITY_MISMATCH`
 *  - C2 边：目标声明 TEE 能力且满足合约证明策略，否则 `E_CAPABILITY_MISMATCH`
 */
export function validateEdge(edge: PlanEdge, ctx: EdgeCheckContext): void {
  if (!isCrossNode(edge)) return;
  const edgeId = edgeRef(edge);
  if (edge.label === "C0")
    throw new MdopError("E_LABEL_VIOLATION", { edge: edgeId }, "C0 制品不得跨节点");

  const target = ctx.capabilities.get(edge.to_node);
  if (!target)
    throw new MdopError(
      "E_CAPABILITY_MISMATCH",
      { edge: edgeId, node: edge.to_node },
      "目标节点没有能力通告",
    );

  if (edge.label === "C3") {
    if (!ctx.contract_recipients.includes(edge.to_node))
      throw new MdopError(
        "E_CAPABILITY_MISMATCH",
        { edge: edgeId, node: edge.to_node },
        "C3 目标不在合约接收方列表里",
      );
    return;
  }

  if (edge.label === "C1") {
    const source = ctx.capabilities.get(edge.from_node);
    const shared = intersection(
      source?.protocols ?? [],
      target.protocols,
      (p) => `${p.name}@${p.version}`,
    );
    if (shared.length === 0)
      throw new MdopError(
        "E_CAPABILITY_MISMATCH",
        { edge: edgeId },
        "C1 边的端点未声明同一协同协议及版本",
      );
    return;
  }

  // C2
  if (!target.tee)
    throw new MdopError(
      "E_CAPABILITY_MISMATCH",
      { edge: edgeId, node: edge.to_node },
      "C2 目标未声明 TEE 能力",
    );
  const policy = ctx.attestation_policy;
  if (!policy || !policy.tee.includes(target.tee.kind))
    throw new MdopError(
      "E_CAPABILITY_MISMATCH",
      { edge: edgeId, node: edge.to_node },
      "C2 目标不满足合约的证明策略",
    );
}

function intersection<T>(a: readonly T[], b: readonly T[], key: (t: T) => string): T[] {
  const seen = new Set(a.map(key));
  return b.filter((item) => seen.has(key(item)));
}

/**
 * 普通算子不得降级：非 `declassify` 算子的输出等级 MUST 等于全部输入的 join。
 * 清单声明固定等级且不等于推导值 → `E_LABEL_VIOLATION`（规格同名场景）。
 */
export function deriveOutputLabel(
  manifest: OperatorManifest,
  inputLabels: readonly FlowLabel[],
): FlowLabel {
  const declared = manifest.outputs[0]?.label_rule ?? "inherit";

  // 封装类算子（协议 §5.1 的 `seal`）是**唯一**能让等级跨越 C0↔C2 的机制，且方向固定：
  //   封装：C0 → C2（在持有方本地发生，产物是信封）
  //   解封：C2 → C0（在可信空间节点内发生，产物视为该节点的 C0）
  // 两个方向都不许「顺手」带上别的等级：封装只能封 C0，解封只能解 C2。
  if (manifest.category === "seal") {
    if (declared === "C2") {
      if (inputLabels.length === 0 || inputLabels.some((l) => l !== "C0"))
        throw new MdopError("E_LABEL_VIOLATION", {}, "封装算子只能封装本节点的 C0 数据");
      return "C2";
    }
    if (declared === "C0") {
      if (inputLabels.length === 0 || inputLabels.some((l) => l !== "C2"))
        throw new MdopError("E_LABEL_VIOLATION", {}, "解封算子只接受 C2 信封");
      return "C0";
    }
    throw new MdopError(
      "E_LABEL_VIOLATION",
      {},
      `封装类算子的 label_rule 必须是 C2（封装）或 C0（解封），收到 ${declared}`,
    );
  }

  if (manifest.category === "declassify") {
    if (declared === "inherit")
      throw new MdopError("E_LABEL_VIOLATION", {}, "降密算子必须声明输出等级");
    return declared;
  }
  if (declared !== "inherit")
    throw new MdopError(
      "E_LABEL_VIOLATION",
      {},
      `非降密算子 ${manifest.id}@${manifest.version} 不得声明固定输出等级`,
    );
  const inherited = joinAll(inputLabels);
  // R1 的 join 语义保持不动（纯 C2 输入仍可传递 C2）；这里只封死**从非 C2 输入造出 C2**
  // ——C2 只能由封装算子产生（协议 §4.2 R4），否则普通算子能凭空把明文标成「信封」，
  // 绕过信封与远程证明这两道前提。混合输入（C0+C2）同理：那需要先解封再重新封装。
  if (inherited === "C2" && inputLabels.some((l) => l !== "C2"))
    throw new MdopError(
      "E_LABEL_VIOLATION",
      {},
      `只有封装（seal）类算子能把非 C2 输入变成 C2：${manifest.id}@${manifest.version}`,
    );
  return inherited;
}

export interface PublicationConditions {
  minCell?: number;
  [key: string]: unknown;
}

/**
 * 降密算子的参数 MUST NOT 弱于合约的发布条件（规格「降密参数弱于合约」）。
 * 目前唯一的可比参数是 `minCell`（阈值型发布条件）：算子参数小于合约值即失败。
 */
export function assertDeclassifyNotWeaker(
  params: Record<string, unknown>,
  conditions: PublicationConditions,
): void {
  const contractMin = conditions.minCell;
  if (contractMin === undefined) return;
  const paramMin = params.minCell;
  if (paramMin === undefined)
    throw new MdopError("E_LABEL_VIOLATION", {}, "降密算子没有声明 minCell，弱于合约发布条件");
  if (typeof paramMin !== "number" || !Number.isFinite(paramMin))
    throw new MdopError("E_LABEL_VIOLATION", {}, "降密算子的 minCell 不是数字");
  if (paramMin < contractMin)
    throw new MdopError(
      "E_LABEL_VIOLATION",
      {},
      `降密算子 minCell=${paramMin} 小于合约要求的 ${contractMin}`,
    );
}

/**
 * 节点能否跑这个算子：运行时、system 算子登记、kind 是否本期启用。
 * 任一不满足 → `E_CAPABILITY_MISMATCH`（规格「未通告能力的节点」「本期不启用 oci」）。
 */
export function assertNodeCanRun(
  manifest: OperatorManifest,
  capability: NodeCapability | undefined,
  ref: OperatorRef,
): void {
  const name = operatorRefString(ref);
  if (DISABLED_KINDS.includes(manifest.kind))
    throw new MdopError("E_CAPABILITY_MISMATCH", {}, `算子 ${name} 的 kind=${manifest.kind} 本期未启用`);
  if (!capability)
    throw new MdopError("E_CAPABILITY_MISMATCH", {}, `节点没有能力通告，无法放置 ${name}`);
  if (manifest.kind === "wasm" && !capability.runtime.includes("wasm"))
    throw new MdopError(
      "E_CAPABILITY_MISMATCH",
      { node: capability.node },
      `节点 ${capability.node} 未通告 wasm 运行时`,
    );
  if (manifest.kind === "system" && !capability.system_ops.includes(name))
    throw new MdopError(
      "E_CAPABILITY_MISMATCH",
      { node: capability.node },
      `节点 ${capability.node} 未通告 system 算子 ${name}`,
    );
}
