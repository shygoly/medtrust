import { canonicalSm3 } from "../crypto/sm3";
import { SchemaError } from "../schema/strict";
import { type Fragment, type JobHeader, parseFragment } from "../schema/plan";

/**
 * 片段哈希与 plan_hash（规格「片段切分与计划哈希」，D-MDOP-1 D11）。
 *
 * plan_hash = SM3(JCS({作业头, fragments: {节点: 片段哈希}}))。
 * 作业头包括作业 ID、用途、申请方、合约、伦理批件、预算、有效期。
 *
 * 数据快照**不进** plan_hash：各节点复核时才算出快照标识，事先无法写入作业头。
 * 改由各持有方把本节点快照标识与凭证核心一起签名。
 */

export interface PlanHashJobHeader extends JobHeader {
  job_id: string;
  not_before: string;
  not_after: string;
}

export interface PlanHashInput {
  job: PlanHashJobHeader;
  /** 节点 → 该节点片段哈希（sm3:<64hex>）。 */
  fragments: Record<string, string>;
}

/** 规范化片段对象的 SM3。 */
export function fragmentHash(fragment: Fragment): string {
  return canonicalSm3(fragment);
}

/** 对任意片段形状求哈希（先按结构校验，拒未定义字段）。 */
export function fragmentHashOf(input: unknown): string {
  return canonicalSm3(parseFragment(input));
}

/**
 * 作业头的规范化形状：可选字段一律显式写成 null，
 * 否则「省略」与「显式 null」会算出不同哈希。
 */
export function normalizeJobHeaderForHash(job: PlanHashJobHeader): Record<string, unknown> {
  return {
    job_id: job.job_id,
    purpose: job.purpose,
    applicant: { org: job.applicant.org, project: job.applicant.project },
    contracts: [...job.contracts],
    ethics_ref: job.ethics_ref ?? null,
    dp_budget: job.dp_budget ?? null,
    not_before: job.not_before,
    not_after: job.not_after,
    // Bundle 语义已通过物理阶段参数进入片段哈希；作业头保持与既有节点兼容，
    // 避免迁移期节点因多出的元数据字段重算出不同 plan_hash。
  };
}

export function computePlanHash(input: PlanHashInput): string {
  const nodes = Object.keys(input.fragments);
  if (nodes.length === 0) throw new SchemaError("planHash.fragments", "至少要有一个节点片段");
  for (const [node, hash] of Object.entries(input.fragments)) {
    if (!/^sm3:[0-9a-f]{64}$/.test(hash))
      throw new SchemaError(`planHash.fragments.${node}`, "片段哈希必须是 sm3:<64hex>");
  }
  return canonicalSm3({
    job: normalizeJobHeaderForHash(input.job),
    fragments: input.fragments,
  });
}

/** 节点用「本方片段 + 作业头 + 片段哈希表」独立重算，结果须与要约中的值一致。 */
export function recomputeForNode(input: {
  job: PlanHashJobHeader;
  fragment: Fragment;
  fragments: Record<string, string>;
}): { fragment_hash: string; plan_hash: string } {
  const own = fragmentHash(input.fragment);
  const declared = input.fragments[input.fragment.node];
  if (!declared)
    throw new SchemaError("fragment.node", `片段哈希表里没有本节点 ${input.fragment.node}`);
  return {
    fragment_hash: own,
    plan_hash: computePlanHash({ job: input.job, fragments: input.fragments }),
  };
}
