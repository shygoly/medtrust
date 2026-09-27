import { canonicalize } from "@medtrust/mdop";
import type { MdopContract, MdopContractRecipient } from "@medtrust/mdop";
import type {
  DigitalContract,
  DigitalContractEntity,
  MdopContractTerms,
} from "@medtrust/database";

/**
 * 控制面合约实体 ↔ MDOP 规范化合约（D-MDOP-4 / 规格「持有方签署的数字合约」）。
 *
 * 规范化合约就是**被持有方签名、平台副署**的那份对象：`canonicalize()` 出来的一串 JSON
 * 改一个字节，持有方签名即失效。所以映射 MUST 是确定性的（同样的实体永远得到同样的串），
 * 且两端（平台 / 连接器）MUST 用同一个函数构造。
 */

export const MDOP_CONTRACT_API_VERSION = "mdop/v0.2";

export type ContractLike = DigitalContract | DigitalContractEntity;

function minCellOf(contract: ContractLike): number | undefined {
  const policy = (contract as DigitalContract).outputPolicy;
  return policy?.minCell;
}

export function isMdopContract(contract: ContractLike): boolean {
  return !!(contract as DigitalContractEntity).mdopTerms;
}

/** 合约是否带有效的持有方签名（没有就只能服务旧管线，D-MDOP-4）。 */
export function isHolderSigned(contract: ContractLike): boolean {
  const c = contract as DigitalContractEntity;
  return !!c.mdopTerms && !!c.holderSignature && !!c.platformCountersignature;
}

/**
 * 构造规范化合约。`terms` 缺失时（旧合约）仍能构造，但 `holder` 签名不可能有效 ——
 * 用于让编译期给出统一的 `E_CONTRACT_UNSIGNED`。
 */
export function buildMdopContract(
  contract: ContractLike,
  terms: MdopContractTerms,
): MdopContract {
  return {
    apiVersion: MDOP_CONTRACT_API_VERSION,
    contract_id: contract.id,
    data_product_id: terms.dataProductId,
    provider: contract.providerId,
    consumer: contract.consumerId,
    purpose: contract.purpose,
    retention: contract.retention,
    recipients: terms.recipients.map((r) => ({ ...r })),
    allowed_ops: [...terms.allowedOpDigests],
    review: {
      mode: terms.review.mode,
      deadline_hours: terms.review.deadlineHours,
    },
    ethics: {
      required: terms.ethics.required,
      ref: terms.ethics.ref ?? null,
      valid_until: terms.ethics.validUntil ?? null,
    },
    provider_public_key_kid: terms.providerPublicKeyKid,
    platform_public_key_kid: terms.platformPublicKeyKid,
    pre_review_snapshot: terms.preReviewSnapshot ?? null,
    publication:
      terms.publication.minCell === undefined
        ? {}
        : { minCell: terms.publication.minCell },
    valid_from: (contract as DigitalContractEntity).createdAt
      ? new Date((contract as DigitalContractEntity).createdAt).toISOString()
      : new Date(0).toISOString(),
    valid_until: contract.validUntil,
    // 证明策略：**只在合约声明了 C2 时才写进条款**。缺省不写这个键，非 C2 合约的
    // 规范化与哈希因此与升级前完全一致（否则一次部署就会让所有既有持签合约的哈希变掉）。
    ...(terms.attestationPolicy
      ? {
          attestation_policy: {
            tee: [...terms.attestationPolicy.tee],
            ...(terms.attestationPolicy.minTcb !== undefined
              ? {
                  min_tcb:
                    typeof terms.attestationPolicy.minTcb === "string"
                      ? terms.attestationPolicy.minTcb
                      : { ...terms.attestationPolicy.minTcb },
                }
              : {}),
            ...(terms.attestationPolicy.allowedMeasurements !== undefined
              ? {
                  allowed_measurements: [
                    ...terms.attestationPolicy.allowedMeasurements,
                  ],
                }
              : {}),
          },
        }
      : {}),
    ...(terms.serviceProtocol
      ? {
          service_protocol: {
            protocol_version: terms.serviceProtocol.protocol_version,
            target_corpus_ids: [...terms.serviceProtocol.target_corpus_ids],
            topology: {
              stages: terms.serviceProtocol.topology.stages.map((s) => ({
                stage_id: s.stage_id,
                required_op: s.required_op,
                depends_on: [...s.depends_on],
                intermediate_label: "C0_internal" as const,
              })),
              final_stage_id: terms.serviceProtocol.topology.final_stage_id,
            },
            operator_whitelist: terms.serviceProtocol.operator_whitelist.map(
              (o) => ({
                op: o.op,
                version: o.version,
                kind: "wasm" as const,
                sm3_digest: o.sm3_digest,
              }),
            ),
            parameter_space: {
              allowed_filter_columns: [
                ...terms.serviceProtocol.parameter_space.allowed_filter_columns,
              ],
              ...(terms.serviceProtocol.parameter_space.max_time_window_days !==
              undefined
                ? {
                    max_time_window_days:
                      terms.serviceProtocol.parameter_space
                        .max_time_window_days,
                  }
                : {}),
              allowed_grouping_columns: [
                ...terms.serviceProtocol.parameter_space
                  .allowed_grouping_columns,
              ],
              ...(terms.serviceProtocol.parameter_space
                .prohibited_predicates !== undefined
                ? {
                    prohibited_predicates: [
                      ...terms.serviceProtocol.parameter_space
                        .prohibited_predicates,
                    ],
                  }
                : {}),
            },
            budget_policy: {
              total_epsilon: terms.serviceProtocol.budget_policy.total_epsilon,
              ...(terms.serviceProtocol.budget_policy.delta !== undefined
                ? { delta: terms.serviceProtocol.budget_policy.delta }
                : {}),
              max_queries: terms.serviceProtocol.budget_policy.max_queries,
              min_cell_size: terms.serviceProtocol.budget_policy.min_cell_size,
              ...(terms.serviceProtocol.budget_policy.rate_limit_per_hour !==
              undefined
                ? {
                    rate_limit_per_hour:
                      terms.serviceProtocol.budget_policy.rate_limit_per_hour,
                  }
                : {}),
              circuit_breaker_enabled:
                terms.serviceProtocol.budget_policy.circuit_breaker_enabled ??
                true,
            },
          },
        }
      : {}),
  };
}

/** 规范化合约的 JSON 串（JCS）——被签、被比对的就是它。 */
export function canonicalContractJson(contract: MdopContract): string {
  return canonicalize(contract);
}

export function buildCanonicalFromEntity(
  contract: ContractLike,
  terms: MdopContractTerms,
): string {
  return canonicalContractJson(buildMdopContract(contract, terms));
}

/** 平台作为 C3 接收方与合并方，MUST 显式列入接收方列表（D-MDOP-2）。 */
export function withPlatformRecipient(
  recipients: MdopContractRecipient[],
  platformParty: string,
  jurisdiction = "CN",
): MdopContractRecipient[] {
  if (recipients.some((r) => r.party === platformParty)) return [...recipients];
  return [
    ...recipients,
    { party: platformParty, role: "merger", jurisdiction },
  ];
}

export function contractRecipients(terms: MdopContractTerms): string[] {
  return terms.recipients.map((r) => r.party);
}

/** 合约发布条件（降密算子参数不得弱于它）。 */
export function publicationConditions(terms: MdopContractTerms): {
  minCell?: number;
} {
  return { ...terms.publication };
}

export { minCellOf };
