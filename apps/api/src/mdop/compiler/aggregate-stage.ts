import {
  MdopError,
  propagateLabels,
  type AggregateBinding,
  type FlowLabel,
  type OperatorManifest,
  type PhysicalStage,
} from "@medtrust/mdop";

/**
 * 编译期识别 `secure_aggregate`：参与方从上游数据持有节点闭合，
 * 每个参与方的片段都是「本地贡献 → 上传密文」。
 */

export interface CompiledAggregateStage {
  primaryNode: string;
  parties: string[];
  outputLabel: "C3";
  params: Record<string, unknown>;
  binding: AggregateBinding;
  /** 每个参与方一份子计划：贡献然后上传密文。 */
  subplan: Array<{ node: string; steps: ["contribute", "upload"] }>;
}

export function compileAggregateStage(input: {
  stageId: string;
  manifest: OperatorManifest;
  inputLabels: readonly FlowLabel[];
  upstreamNodes: readonly string[];
  platformNode: string;
  params: Record<string, unknown>;
}): CompiledAggregateStage {
  const edge = `${input.upstreamNodes.join("+") || "none"}->${input.stageId}`;
  if (input.manifest.kind !== "secure_aggregate")
    throw new MdopError("E_CAPABILITY_MISMATCH", { edge }, "不是安全聚合算子");
  if (input.upstreamNodes.includes(input.platformNode))
    throw new MdopError(
      "E_LABEL_VIOLATION",
      { edge },
      "平台不能作为聚合参与方",
    );
  const parties = [...new Set(input.upstreamNodes)].sort();
  if (parties.length < 2)
    throw new MdopError(
      "E_LABEL_VIOLATION",
      { edge },
      "安全聚合的参与方必须是全部数据持有节点，且至少两方",
    );
  const outputLabel = propagateLabels(input.manifest, input.inputLabels, edge);
  if (outputLabel !== "C3")
    throw new MdopError(
      "E_LABEL_VIOLATION",
      { edge },
      "安全聚合的输出必须是 C3",
    );

  const timeout = input.params.timeout_s;
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout <= 0)
    throw new MdopError(
      "E_LABEL_VIOLATION",
      { edge },
      "聚合阶段必须声明正整数 timeout_s",
    );
  const algorithm = input.params.algorithm ?? "fedavg";
  if (algorithm !== "fedavg")
    throw new MdopError(
      "E_CAPABILITY_MISMATCH",
      { edge },
      `未登记的聚合算法 ${String(algorithm)}`,
    );

  const binding: AggregateBinding = {
    parties,
    timeout_s: timeout,
    encryption: "per_recipient_pubkey",
    algorithm: "fedavg",
    steps: ["contribute", "upload"],
  };
  return {
    primaryNode: parties[0],
    parties,
    outputLabel: "C3",
    binding,
    params: { ...input.params, aggregate: binding },
    subplan: parties.map((node) => ({
      node,
      steps: ["contribute", "upload"] as const,
    })),
  };
}

export function isAggregateStage(stage: {
  params?: Record<string, unknown>;
}): boolean {
  const aggregate = stage.params?.aggregate;
  return !!aggregate && typeof aggregate === "object";
}

/** 聚合阶段在每个参与方片段里各放一份，输入只保留本节点上游。 */
export function expandAggregateStage(
  stage: PhysicalStage,
  all: readonly PhysicalStage[],
): PhysicalStage[] | undefined {
  const aggregate = stage.params.aggregate as
    { parties?: string[] } | undefined;
  if (!aggregate?.parties?.length) return undefined;
  const nodeOf = new Map(all.map((item) => [item.id, item.node]));
  return aggregate.parties.map((party) => ({
    ...stage,
    node: party,
    inputs: stage.inputs.filter((input) => nodeOf.get(input.from) === party),
  }));
}
