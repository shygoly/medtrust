import { parseOperatorRef } from "./operator";
import {
  SchemaError,
  asObject,
  checkKeys,
  reqArray,
  reqBoolean,
  reqDigest,
  reqEnum,
  reqNumber,
  reqObject,
  reqString,
} from "./strict";

/**
 * 节点侧安全聚合的阶段规格与三种消息（协议 v0.3 §7.6）。
 * 平台只见密文句柄；本模块不接受明文载荷字段。
 */

export const AGGREGATE_ALGORITHMS = ["fedavg"] as const;
export type AggregateAlgorithm = (typeof AGGREGATE_ALGORITHMS)[number];

export const AGGREGATE_ENCRYPTION = ["per_recipient_pubkey"] as const;
export type AggregateEncryption = (typeof AGGREGATE_ENCRYPTION)[number];

export interface AggregateStageSpec {
  algorithm: AggregateAlgorithm;
  params: Record<string, unknown>;
  /** 编译期闭合的参与方列表，运行时不可变。 */
  parties: string[];
  timeout_s: number;
  encryption: AggregateEncryption;
}

export interface AggregateRequest {
  stage_id: string;
  op: string;
  spec: AggregateStageSpec;
}

export interface AggregateContribution {
  stage_id: string;
  contributor_id: string;
  contribution_ref: string;
  digest: string;
  partial_signature: string;
}

export interface ContributionRef {
  contributor_id: string;
  contribution_ref: string;
  digest: string;
}

export interface AggregateResult {
  stage_id: string;
  contribution_refs: ContributionRef[];
  complete: true;
}

export function parseAggregateStageSpec(input: unknown, path = "aggregate.spec"): AggregateStageSpec {
  const obj = asObject(input, path);
  checkKeys(obj, path, {
    required: ["algorithm", "params", "parties", "timeout_s", "encryption"],
  });
  const timeout = reqNumber(obj, "timeout_s", path);
  if (!Number.isInteger(timeout) || timeout <= 0)
    throw new SchemaError(`${path}.timeout_s`, "必须是正整数");
  return {
    algorithm: reqEnum(obj, "algorithm", path, AGGREGATE_ALGORITHMS),
    params: reqObject(obj, "params", path),
    parties: parseParties(obj, path),
    timeout_s: timeout,
    encryption: reqEnum(obj, "encryption", path, AGGREGATE_ENCRYPTION),
  };
}

export function parseAggregateRequest(input: unknown): AggregateRequest {
  const obj = asObject(input, "aggregate.request");
  checkKeys(obj, "aggregate.request", {
    required: ["stage_id", "op", "aggregation", "parties", "timeout_s", "encryption"],
  });
  const op = reqString(obj, "op", "aggregate.request");
  parseOperatorRef(op);
  const aggregation = reqObject(obj, "aggregation", "aggregate.request");
  checkKeys(aggregation, "aggregate.request.aggregation", {
    required: ["algorithm", "params"],
  });
  const spec = parseAggregateStageSpec(
    {
      algorithm: aggregation.algorithm,
      params: aggregation.params,
      parties: obj.parties,
      timeout_s: obj.timeout_s,
      encryption: obj.encryption,
    },
    "aggregate.request",
  );
  return { stage_id: reqString(obj, "stage_id", "aggregate.request"), op, spec };
}

export function serializeAggregateRequest(req: AggregateRequest): Record<string, unknown> {
  return {
    stage_id: req.stage_id,
    op: req.op,
    aggregation: { algorithm: req.spec.algorithm, params: req.spec.params },
    parties: [...req.spec.parties],
    timeout_s: req.spec.timeout_s,
    encryption: req.spec.encryption,
  };
}

export function parseAggregateContribution(input: unknown): AggregateContribution {
  const obj = asObject(input, "aggregate.contribution");
  checkKeys(obj, "aggregate.contribution", {
    required: ["stage_id", "contributor_id", "contribution_ref", "digest", "partial_signature"],
  });
  return {
    stage_id: reqString(obj, "stage_id", "aggregate.contribution"),
    contributor_id: reqString(obj, "contributor_id", "aggregate.contribution"),
    contribution_ref: reqString(obj, "contribution_ref", "aggregate.contribution"),
    digest: reqDigest(obj, "digest", "aggregate.contribution"),
    partial_signature: reqString(obj, "partial_signature", "aggregate.contribution"),
  };
}

export function parseAggregateResult(input: unknown): AggregateResult {
  const obj = asObject(input, "aggregate.result");
  checkKeys(obj, "aggregate.result", {
    required: ["stage_id", "contribution_refs", "complete"],
  });
  if (reqBoolean(obj, "complete", "aggregate.result") !== true)
    throw new SchemaError("aggregate.result.complete", "缺参与方时不得发送聚合结果");
  const refs = reqArray(obj, "contribution_refs", "aggregate.result").map((item, i) =>
    parseContributionRef(item, i),
  );
  if (refs.length === 0)
    throw new SchemaError("aggregate.result.contribution_refs", "必须列出全部贡献句柄");
  const ids = refs.map((ref) => ref.contributor_id);
  if (new Set(ids).size !== ids.length)
    throw new SchemaError("aggregate.result.contribution_refs", "参与方不得重复");
  return {
    stage_id: reqString(obj, "stage_id", "aggregate.result"),
    contribution_refs: refs,
    complete: true,
  };
}

function parseContributionRef(item: unknown, index: number): ContributionRef {
  const path = `aggregate.result.contribution_refs[${index}]`;
  const obj = asObject(item, path);
  checkKeys(obj, path, { required: ["contributor_id", "contribution_ref", "digest"] });
  return {
    contributor_id: reqString(obj, "contributor_id", path),
    contribution_ref: reqString(obj, "contribution_ref", path),
    digest: reqDigest(obj, "digest", path),
  };
}

export const AGGREGATE_STEPS = ["contribute", "upload"] as const;

/** 写在物理阶段 `params.aggregate` 里的闭合绑定。缺省表示这不是聚合阶段。 */
export interface AggregateBinding {
  parties: string[];
  timeout_s: number;
  encryption: AggregateEncryption;
  algorithm: AggregateAlgorithm;
  steps: ["contribute", "upload"];
}

export function readAggregateBinding(
  params: Record<string, unknown> | null | undefined,
): AggregateBinding | undefined {
  if (!params || params.aggregate === undefined) return undefined;
  const binding = asObject(params.aggregate, "aggregate.binding");
  checkKeys(binding, "aggregate.binding", {
    required: ["parties", "timeout_s", "encryption", "algorithm", "steps"],
  });
  const steps = reqArray(binding, "steps", "aggregate.binding").map((item, i) => {
    if (item !== "contribute" && item !== "upload")
      throw new SchemaError(`aggregate.binding.steps[${i}]`, "步骤非法");
    return item;
  });
  if (steps.join(",") !== "contribute,upload")
    throw new SchemaError("aggregate.binding.steps", "聚合片段步骤必须是 contribute → upload");
  const timeout = reqNumber(binding, "timeout_s", "aggregate.binding");
  if (!Number.isInteger(timeout) || timeout <= 0)
    throw new SchemaError("aggregate.binding.timeout_s", "必须是正整数");
  return {
    parties: parseParties(binding, "aggregate.binding"),
    timeout_s: timeout,
    encryption: reqEnum(binding, "encryption", "aggregate.binding", AGGREGATE_ENCRYPTION),
    algorithm: reqEnum(binding, "algorithm", "aggregate.binding", AGGREGATE_ALGORITHMS),
    steps: ["contribute", "upload"],
  };
}

function parseParties(obj: Record<string, unknown>, path: string): string[] {
  const parties = reqArray(obj, "parties", path).map((item, i) => {
    if (typeof item !== "string" || item.length === 0)
      throw new SchemaError(`${path}.parties[${i}]`, "必须是非空字符串");
    return item;
  });
  if (parties.length === 0) throw new SchemaError(`${path}.parties`, "参与方列表不得为空");
  if (new Set(parties).size !== parties.length)
    throw new SchemaError(`${path}.parties`, "参与方不得重复");
  return parties;
}
