import type { AttestationPolicy } from "../label/lattice";
import {
  type ServiceProtocolSpec,
  parseServiceProtocolSpec,
} from "./service-protocol";
import {
  SchemaError,
  asObject,
  checkKeys,
  optNumber,
  optString,
  reqArray,
  reqBoolean,
  reqObject,
  reqString,
  reqTimestamp,
} from "./strict";

/**
 * MDOP 合约条款的规范化形式（规格「持有方签署的数字合约」，D-MDOP-4）。
 *
 * 这是**被 JCS 规范化后签名**的那份对象：持有方连接器用本院私钥签它，平台节点密钥副署。
 * 控制面的 `cp_digital_contract` 实体是持久化形态，本类型是协议层形态——两者由
 * `ContractService` 做映射。字段一旦进入这里就计入签名，改一个字节签名即失效。
 */

export const RECIPIENT_ROLES = ["merger", "final"] as const;
export type RecipientRole = (typeof RECIPIENT_ROLES)[number];

export interface MdopContractRecipient {
  party: string;
  role: RecipientRole;
  jurisdiction: string;
}

export const REVIEW_MODES = ["auto", "manual"] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export interface MdopContract {
  apiVersion: string;
  contract_id: string;
  data_product_id: string;
  provider: string;
  consumer: string;
  purpose: string;
  retention: string;
  recipients: MdopContractRecipient[];
  allowed_ops: string[];
  review: { mode: ReviewMode; deadline_hours: number };
  ethics: { required: boolean; ref: string | null; valid_until: string | null };
  provider_public_key_kid: string;
  platform_public_key_kid: string;
  pre_review_snapshot: string | null;
  publication: { minCell?: number };
  valid_from: string;
  valid_until: string;
  /**
   * 证明策略（C2 作业必需）：允许的链型、按链的最低可信基、以及可进一步收窄的度量清单。
   * **缺省即不允许任何 C2 目标**（fail-closed）；非 C2 作业可以不带该字段。
   * 该字段进入合约规范化与哈希——改了它就是要约条款变了，需重新走签署。
   */
  attestation_policy?: AttestationPolicy;
  /**
   * 服务计算协议标准（服务计算作业必需）：锁定执行拓扑、算子白名单、参数空间与累积预算。
   * 缺省即表示为单次协同计算作业（非服务计算）。
   */
  service_protocol?: ServiceProtocolSpec;
}

export function parseMdopContract(input: unknown): MdopContract {
  const obj = asObject(input, "contract");
  checkKeys(obj, "contract", {
    required: [
      "apiVersion",
      "contract_id",
      "data_product_id",
      "provider",
      "consumer",
      "purpose",
      "retention",
      "recipients",
      "allowed_ops",
      "review",
      "ethics",
      "provider_public_key_kid",
      "platform_public_key_kid",
      "pre_review_snapshot",
      "publication",
      "valid_from",
      "valid_until",
    ],
    optional: ["attestation_policy", "service_protocol"],
  });

  const reviewPath = "contract.review";
  const review = reqObject(obj, "review", "contract");
  checkKeys(review, reviewPath, { required: ["mode", "deadline_hours"] });
  const mode = reqString(review, "mode", reviewPath);
  if (mode !== "auto" && mode !== "manual")
    throw new SchemaError(`${reviewPath}.mode`, `必须 auto 或 manual（收到 ${mode}）`);
  const deadline = optNumber(review, "deadline_hours", reviewPath) ?? 72;
  if (deadline <= 0) throw new SchemaError(`${reviewPath}.deadline_hours`, "必须大于 0");

  const ethicsPath = "contract.ethics";
  const ethics = reqObject(obj, "ethics", "contract");
  checkKeys(ethics, ethicsPath, {
    required: ["required", "ref", "valid_until"],
  });
  const required = reqBoolean(ethics, "required", ethicsPath);
  const ref = optString(ethics, "ref", ethicsPath) ?? null;
  const ethicsUntil = optString(ethics, "valid_until", ethicsPath) ?? null;
  if (required && !ref)
    throw new SchemaError(ethicsPath, "要求伦理批件时必须给出批件号");

  const publicationPath = "contract.publication";
  const publication = reqObject(obj, "publication", "contract");
  checkKeys(publication, publicationPath, { optional: ["minCell"] });
  const minCell = optNumber(publication, "minCell", publicationPath);

  const attestationPolicy =
    obj.attestation_policy === undefined
      ? undefined
      : parseAttestationPolicy(obj.attestation_policy, "contract.attestation_policy");

  const serviceProtocol =
    obj.service_protocol === undefined
      ? undefined
      : parseServiceProtocolSpec(obj.service_protocol, "contract.service_protocol");

  return {
    apiVersion: reqString(obj, "apiVersion", "contract"),
    contract_id: reqString(obj, "contract_id", "contract"),
    data_product_id: reqString(obj, "data_product_id", "contract"),
    provider: reqString(obj, "provider", "contract"),
    consumer: reqString(obj, "consumer", "contract"),
    purpose: reqString(obj, "purpose", "contract"),
    retention: reqString(obj, "retention", "contract"),
    recipients: reqArray(obj, "recipients", "contract").map((item, i) =>
      parseRecipient(item, i),
    ),
    allowed_ops: reqArray(obj, "allowed_ops", "contract").map((item, i) => {
      if (typeof item !== "string" || item.length === 0)
        throw new SchemaError(`contract.allowed_ops[${i}]`, "必须是算子摘要");
      return item as string;
    }),
    review: { mode: mode as ReviewMode, deadline_hours: deadline },
    ethics: { required, ref, valid_until: ethicsUntil },
    provider_public_key_kid: reqString(obj, "provider_public_key_kid", "contract"),
    platform_public_key_kid: reqString(obj, "platform_public_key_kid", "contract"),
    pre_review_snapshot: optString(obj, "pre_review_snapshot", "contract") ?? null,
    publication: minCell === undefined ? {} : { minCell },
    valid_from: reqTimestamp(obj, "valid_from", "contract"),
    valid_until: reqTimestamp(obj, "valid_until", "contract"),
    ...(attestationPolicy ? { attestation_policy: attestationPolicy } : {}),
    ...(serviceProtocol ? { service_protocol: serviceProtocol } : {}),
  };
}

/**
 * 证明策略解析（与信封、凭证共用同一形状，见 `label/lattice.ts` 的 `AttestationPolicy`）。
 * `min_tcb` 允许单值或按链映射；跨链版本体系不可互比，因此按链写是推荐形态。
 */
function parseAttestationPolicy(input: unknown, path: string): AttestationPolicy {
  const obj = asObject(input, path);
  checkKeys(obj, path, { required: ["tee"], optional: ["min_tcb", "allowed_measurements"] });
  const tee = reqArray(obj, "tee", path).map((item, i) => {
    if (typeof item !== "string" || item.length === 0)
      throw new SchemaError(`${path}.tee[${i}]`, "必须是链型字符串");
    return item as string;
  });
  if (tee.length === 0) throw new SchemaError(`${path}.tee`, "至少声明一条链型");

  const minRaw = obj.min_tcb;
  let minTcb: AttestationPolicy["min_tcb"];
  if (typeof minRaw === "string") {
    if (!minRaw.trim()) throw new SchemaError(`${path}.min_tcb`, "不得为空串");
    minTcb = minRaw;
  } else if (minRaw !== undefined) {
    const map = asObject(minRaw, `${path}.min_tcb`);
    const parsed: Record<string, string> = {};
    for (const [kind, value] of Object.entries(map)) {
      if (typeof value !== "string" || !value.trim())
        throw new SchemaError(`${path}.min_tcb.${kind}`, "必须是非空字符串");
      parsed[kind] = value;
    }
    minTcb = parsed;
  }

  const measurementsRaw = obj.allowed_measurements;
  let allowedMeasurements: string[] | undefined;
  if (measurementsRaw !== undefined) {
    allowedMeasurements = reqArray(obj, "allowed_measurements", path).map((item, i) => {
      if (typeof item !== "string" || item.length === 0)
        throw new SchemaError(`${path}.allowed_measurements[${i}]`, "必须是非空字符串");
      return item as string;
    });
    if (allowedMeasurements.length === 0)
      throw new SchemaError(`${path}.allowed_measurements`, "不得为空数组（缺省表示不限）");
  }

  return {
    tee,
    ...(minTcb !== undefined ? { min_tcb: minTcb } : {}),
    ...(allowedMeasurements !== undefined
      ? { allowed_measurements: allowedMeasurements }
      : {}),
  };
}

function parseRecipient(input: unknown, index: number): MdopContractRecipient {
  const path = `contract.recipients[${index}]`;
  const obj = asObject(input, path);
  checkKeys(obj, path, { required: ["party", "role", "jurisdiction"] });
  const role = reqString(obj, "role", path);
  if (role !== "merger" && role !== "final")
    throw new SchemaError(`${path}.role`, `必须 merger 或 final（收到 ${role}）`);
  return {
    party: reqString(obj, "party", path),
    role: role as RecipientRole,
    jurisdiction: reqString(obj, "jurisdiction", path),
  };
}

/** 平台是否被明示为接收方（D-MDOP-2：C3 投递给平台的前提）。 */
export function isPlatformRecipient(contract: MdopContract, platform: string): boolean {
  return contract.recipients.some((r) => r.party === platform);
}

export function recipientParties(contract: MdopContract): string[] {
  return contract.recipients.map((r) => r.party);
}
