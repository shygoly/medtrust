import {
  SchemaError,
  asArray,
  asObject,
  checkKeys,
  optBoolean,
  optNumber,
  reqArray,
  reqNumber,
  reqObject,
  reqString,
} from "./strict";

/**
 * 阶段模板定义（服务计算管道拓扑节点）。
 * 中间阶段严格使用 C0_internal 标签，强制限制在飞地内存流转，绝不出节点。
 */
export interface ServicePipelineStageTemplate {
  stage_id: string;
  required_op: string;
  depends_on: string[];
  intermediate_label: "C0_internal";
}

/**
 * 管道拓扑：限定服务计算的多步算子执行结构。
 */
export interface ServicePipelineTopology {
  stages: ServicePipelineStageTemplate[];
  final_stage_id: string;
}

/**
 * 算子约束：限定管道各步允许引用的算子标识、版本、类型及 SM3 完整性摘要。
 */
export interface ServiceOperatorConstraint {
  op: string;
  version: string;
  kind: "wasm";
  sm3_digest: string;
}

/**
 * 参数空间定义：防御高维参数嗅探与注入攻击。
 */
export interface ServiceParameterSpace {
  allowed_filter_columns: string[];
  max_time_window_days?: number;
  allowed_grouping_columns: string[];
  prohibited_predicates?: string[];
}

/**
 * 累积预算与调用频次策略。
 */
export interface ServiceBudgetPolicy {
  total_epsilon: number;
  delta?: number;
  max_queries: number;
  min_cell_size: number;
  rate_limit_per_hour?: number;
  circuit_breaker_enabled?: boolean;
}

/**
 * 服务计算协议标准规范（Service Protocol Specification）。
 * 声明于数字合约内，为服务计算定义声明式的执行管道结构、算子白名单与边界策略。
 */
export interface ServiceProtocolSpec {
  protocol_version: string;
  target_corpus_ids: string[];
  topology: ServicePipelineTopology;
  operator_whitelist: ServiceOperatorConstraint[];
  parameter_space: ServiceParameterSpace;
  budget_policy: ServiceBudgetPolicy;
}

const SM3_HEX_RE = /^[0-9a-fA-F]{64}$/;

export function parseServiceProtocolSpec(
  input: unknown,
  path = "service_protocol",
): ServiceProtocolSpec {
  const obj = asObject(input, path);
  checkKeys(obj, path, {
    required: [
      "protocol_version",
      "target_corpus_ids",
      "topology",
      "operator_whitelist",
      "parameter_space",
      "budget_policy",
    ],
  });

  const protocolVersion = reqString(obj, "protocol_version", path);

  const corpusIdsRaw = reqArray(obj, "target_corpus_ids", path);
  if (corpusIdsRaw.length === 0)
    throw new SchemaError(`${path}.target_corpus_ids`, "至少指定一个托管语料标识");
  const targetCorpusIds = corpusIdsRaw.map((item, i) => {
    if (typeof item !== "string" || item.length === 0)
      throw new SchemaError(`${path}.target_corpus_ids[${i}]`, "必须是非空字符串");
    return item;
  });

  const topology = parseServicePipelineTopology(
    reqObject(obj, "topology", path),
    `${path}.topology`,
  );
  validateServiceTopology(topology, `${path}.topology`);

  const whitelistRaw = reqArray(obj, "operator_whitelist", path);
  if (whitelistRaw.length === 0)
    throw new SchemaError(`${path}.operator_whitelist`, "算子白名单不得为空");
  const operatorWhitelist = whitelistRaw.map((item, i) =>
    parseServiceOperatorConstraint(item, `${path}.operator_whitelist[${i}]`),
  );

  const parameterSpace = parseServiceParameterSpace(
    reqObject(obj, "parameter_space", path),
    `${path}.parameter_space`,
  );

  const budgetPolicy = parseServiceBudgetPolicy(
    reqObject(obj, "budget_policy", path),
    `${path}.budget_policy`,
  );

  return {
    protocol_version: protocolVersion,
    target_corpus_ids: targetCorpusIds,
    topology,
    operator_whitelist: operatorWhitelist,
    parameter_space: parameterSpace,
    budget_policy: budgetPolicy,
  };
}

export function parseServicePipelineTopology(
  input: unknown,
  path: string,
): ServicePipelineTopology {
  const obj = asObject(input, path);
  checkKeys(obj, path, { required: ["stages", "final_stage_id"] });

  const finalStageId = reqString(obj, "final_stage_id", path);
  const stagesRaw = reqArray(obj, "stages", path);
  if (stagesRaw.length === 0)
    throw new SchemaError(`${path}.stages`, "管道阶段集合不得为空");

  const stages: ServicePipelineStageTemplate[] = stagesRaw.map((item, i) => {
    const stagePath = `${path}.stages[${i}]`;
    const sObj = asObject(item, stagePath);
    checkKeys(sObj, stagePath, {
      required: ["stage_id", "required_op", "depends_on", "intermediate_label"],
    });

    const stageId = reqString(sObj, "stage_id", stagePath);
    const requiredOp = reqString(sObj, "required_op", stagePath);
    const label = reqString(sObj, "intermediate_label", stagePath);
    if (label !== "C0_internal")
      throw new SchemaError(
        `${stagePath}.intermediate_label`,
        `中间阶段标签必须为 C0_internal（收到 ${label}）`,
      );

    const depsRaw = reqArray(sObj, "depends_on", stagePath);
    const dependsOn = depsRaw.map((dep, dIdx) => {
      if (typeof dep !== "string" || dep.length === 0)
        throw new SchemaError(`${stagePath}.depends_on[${dIdx}]`, "依赖标识必须是非空字符串");
      return dep;
    });

    return {
      stage_id: stageId,
      required_op: requiredOp,
      depends_on: dependsOn,
      intermediate_label: "C0_internal",
    };
  });

  return {
    stages,
    final_stage_id: finalStageId,
  };
}

export function validateServiceTopology(
  topology: ServicePipelineTopology,
  path = "topology",
): void {
  const stageMap = new Map<string, ServicePipelineStageTemplate>();
  for (const stage of topology.stages) {
    if (stageMap.has(stage.stage_id))
      throw new SchemaError(`${path}.stages`, `发现重复的阶段标识 ${stage.stage_id}`);
    stageMap.set(stage.stage_id, stage);
  }

  if (!stageMap.has(topology.final_stage_id))
    throw new SchemaError(
      `${path}.final_stage_id`,
      `最终阶段 ${topology.final_stage_id} 不在管道阶段列表中`,
    );

  // 依赖图验证与环路检测（DFS）
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(stageId: string, trace: string[]): void {
    if (visiting.has(stageId))
      throw new SchemaError(
        `${path}`,
        `管道拓扑存在环路依赖: ${[...trace, stageId].join(" -> ")}`,
      );
    if (visited.has(stageId)) return;

    visiting.add(stageId);
    const stage = stageMap.get(stageId);
    if (!stage) {
      visiting.delete(stageId);
      visited.add(stageId);
      return;
    }

    for (const dep of stage.depends_on) {
      if (dep.startsWith("ds://")) continue; // 数据源引用
      if (!stageMap.has(dep))
        throw new SchemaError(
          `${path}.stages[${stage.stage_id}].depends_on`,
          `引用了不存在的前序阶段 ${dep}`,
        );
      dfs(dep, [...trace, stageId]);
    }

    visiting.delete(stageId);
    visited.add(stageId);
  }

  for (const stageId of stageMap.keys()) {
    if (!visited.has(stageId)) dfs(stageId, []);
  }
}

export function parseServiceOperatorConstraint(
  input: unknown,
  path: string,
): ServiceOperatorConstraint {
  const obj = asObject(input, path);
  checkKeys(obj, path, {
    required: ["op", "version", "kind", "sm3_digest"],
  });

  const op = reqString(obj, "op", path);
  const version = reqString(obj, "version", path);
  const kind = reqString(obj, "kind", path);
  if (kind !== "wasm")
    throw new SchemaError(`${path}.kind`, `服务计算算子仅支持 wasm（收到 ${kind}）`);

  const digest = reqString(obj, "sm3_digest", path);
  if (!SM3_HEX_RE.test(digest))
    throw new SchemaError(`${path}.sm3_digest`, "sm3_digest 必须是 64 字节十六进制哈希");

  return {
    op,
    version,
    kind: "wasm",
    sm3_digest: digest.toLowerCase(),
  };
}

export function parseServiceParameterSpace(
  input: unknown,
  path: string,
): ServiceParameterSpace {
  const obj = asObject(input, path);
  checkKeys(obj, path, {
    required: ["allowed_filter_columns", "allowed_grouping_columns"],
    optional: ["max_time_window_days", "prohibited_predicates"],
  });

  const filterColsRaw = reqArray(obj, "allowed_filter_columns", path);
  const allowedFilterColumns = filterColsRaw.map((c, i) => {
    if (typeof c !== "string" || c.length === 0)
      throw new SchemaError(`${path}.allowed_filter_columns[${i}]`, "列名必须是非空字符串");
    return c;
  });

  const groupingColsRaw = reqArray(obj, "allowed_grouping_columns", path);
  const allowedGroupingColumns = groupingColsRaw.map((c, i) => {
    if (typeof c !== "string" || c.length === 0)
      throw new SchemaError(`${path}.allowed_grouping_columns[${i}]`, "列名必须是非空字符串");
    return c;
  });

  const maxDays = optNumber(obj, "max_time_window_days", path);
  if (maxDays !== undefined && maxDays <= 0)
    throw new SchemaError(`${path}.max_time_window_days`, "最大时间窗口天数必须大于 0");

  let prohibitedPredicates: string[] | undefined;
  if (obj.prohibited_predicates !== undefined) {
    const rawProhib = reqArray(obj, "prohibited_predicates", path);
    prohibitedPredicates = rawProhib.map((p, i) => {
      if (typeof p !== "string" || p.length === 0)
        throw new SchemaError(`${path}.prohibited_predicates[${i}]`, "谓词必须是非空字符串");
      return p;
    });
  }

  return {
    allowed_filter_columns: allowedFilterColumns,
    ...(maxDays !== undefined ? { max_time_window_days: maxDays } : {}),
    allowed_grouping_columns: allowedGroupingColumns,
    ...(prohibitedPredicates ? { prohibited_predicates: prohibitedPredicates } : {}),
  };
}

export function parseServiceBudgetPolicy(
  input: unknown,
  path: string,
): ServiceBudgetPolicy {
  const obj = asObject(input, path);
  checkKeys(obj, path, {
    required: ["total_epsilon", "max_queries"],
    optional: [
      "delta",
      "min_cell_size",
      "rate_limit_per_hour",
      "circuit_breaker_enabled",
    ],
  });

  const totalEpsilon = reqNumber(obj, "total_epsilon", path);
  if (totalEpsilon <= 0)
    throw new SchemaError(`${path}.total_epsilon`, "总差分隐私预算必须大于 0");

  const delta = optNumber(obj, "delta", path);
  if (delta !== undefined && (delta < 0 || delta >= 1))
    throw new SchemaError(`${path}.delta`, "差分隐私 delta 必须在 [0, 1) 之间");

  const maxQueries = reqNumber(obj, "max_queries", path);
  if (maxQueries <= 0 || !Number.isInteger(maxQueries))
    throw new SchemaError(`${path}.max_queries`, "最大查询调用次数必须为正整数");

  const minCellSize = optNumber(obj, "min_cell_size", path) ?? 5;
  if (minCellSize < 1)
    throw new SchemaError(`${path}.min_cell_size`, "最小单元格限制必须 >= 1");

  const rateLimit = optNumber(obj, "rate_limit_per_hour", path);
  if (rateLimit !== undefined && rateLimit <= 0)
    throw new SchemaError(`${path}.rate_limit_per_hour`, "每小时限流次数必须大于 0");

  const circuitBreaker = optBoolean(obj, "circuit_breaker_enabled", path) ?? true;

  return {
    total_epsilon: totalEpsilon,
    ...(delta !== undefined ? { delta } : {}),
    max_queries: maxQueries,
    min_cell_size: minCellSize,
    ...(rateLimit !== undefined ? { rate_limit_per_hour: rateLimit } : {}),
    circuit_breaker_enabled: circuitBreaker,
  };
}
