// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import { rejectForbiddenOutput } from "./seams";

/**
 * 八个应用的合并点，以及合约明文条款如何改写弃电比较和辅助服务比较。
 * 控制面只消费这里返回的合并点标识，不存放曲线或明细。
 */

export const MERGE_TEE = "tee";
export const MERGE_FEDERATED = "federated-coordinator";
export const MERGE_AGGREGATOR = "aggregator-connector";
export const MERGE_OPERATOR = "operator-connector";
export const MERGE_HOLDER = "holder-connector";

/** 合约可逐项允许明文发布的输入。缺一即不视为已允许。 */
export const PLAINTEXT_INPUT_IDS = [
  "section-margin",
  "net-load",
  "agc",
  "price",
  "reserve-demand",
] as const;

export type PlaintextInputId = (typeof PLAINTEXT_INPUT_IDS)[number];

/** 场站调节能力不得进入明文列表，也不得离开场站。 */
export const FORBIDDEN_PLAINTEXT_INPUT = "plant-flexibility";

const CURTAILMENT_REQUIRED: readonly PlaintextInputId[] = [
  "section-margin",
  "net-load",
  "agc",
];

const ANCILLARY_REQUIRED: readonly PlaintextInputId[] = ["price", "reserve-demand"];

export interface ExchangeApplication {
  readonly id: string;
  readonly scenarioId: string;
  readonly name: string;
  readonly defaultMerge: string;
}

export const POWER_APPLICATIONS: readonly ExchangeApplication[] = [
  {
    id: "flood-warning",
    scenarioId: "urban-anomaly",
    name: "洪涝内涝预警",
    defaultMerge: MERGE_TEE,
  },
  {
    id: "fire-score",
    scenarioId: "urban-anomaly",
    name: "火灾隐患预警",
    defaultMerge: MERGE_TEE,
  },
  {
    id: "elder-link",
    scenarioId: "urban-anomaly",
    name: "独居老人异常关怀",
    defaultMerge: MERGE_TEE,
  },
  {
    id: "bid-quote",
    scenarioId: "renewable-absorption",
    name: "市场化交易报量报价",
    defaultMerge: MERGE_FEDERATED,
  },
  {
    id: "curtailment",
    scenarioId: "renewable-absorption",
    name: "弃风弃光风险预警",
    defaultMerge: MERGE_TEE,
  },
  {
    id: "ancillary",
    scenarioId: "renewable-absorption",
    name: "辅助服务市场决策",
    defaultMerge: MERGE_TEE,
  },
  {
    id: "v2g-capacity",
    scenarioId: "v2g-coordination",
    name: "面向调峰的聚合充放电",
    defaultMerge: MERGE_AGGREGATOR,
  },
  {
    id: "smart-charge",
    scenarioId: "v2g-coordination",
    name: "有序智能充电",
    defaultMerge: MERGE_OPERATOR,
  },
];

export interface ExchangeContract {
  readonly id: string;
  readonly status: string;
  readonly coversInputs: boolean;
  readonly plaintextInputs?: readonly string[];
}

export interface ExchangeRequest {
  readonly applicationId: string;
  readonly callerSubjectId: string;
  readonly spaceMemberIds: readonly string[];
  readonly contract: ExchangeContract | null;
  readonly operatorDigest?: string | null;
  readonly outputFields?: readonly string[];
}

export interface ExchangeRecord {
  readonly contractId: string | null;
  readonly mergePoint: string | null;
  readonly outputHash: string | null;
  readonly rejection: string | null;
}

const PLACEHOLDER_DIGESTS = new Set(["n/a", "placeholder", "pending", "todo"]);

export function reproducibleDigest(digest: string | null | undefined): boolean {
  if (!digest) return false;
  const normalized = digest.trim().toLowerCase();
  if (!normalized || PLACEHOLDER_DIGESTS.has(normalized)) return false;
  return /^[0-9a-f]{64}$/.test(normalized);
}

export function applicationById(id: string): ExchangeApplication {
  const found = POWER_APPLICATIONS.find((app) => app.id === id);
  if (!found) throw new Error("unknown-application");
  return found;
}

function allowsAll(
  plaintextInputs: readonly string[],
  required: readonly string[],
): boolean {
  const granted = new Set(plaintextInputs);
  return required.every((id) => granted.has(id));
}

/**
 * 缺省合并点。弃风弃光与辅助服务在合约逐项允许对应输入时改为持有方连接器。
 * 列表中出现场站调节能力则拒绝，不改合并点。
 */
export function resolveMergePoint(
  applicationId: string,
  plaintextInputs: readonly string[] = [],
): string {
  if (plaintextInputs.includes(FORBIDDEN_PLAINTEXT_INPUT)) {
    throw new Error("plant-flexibility-forbidden");
  }
  const app = applicationById(applicationId);
  if (
    app.id === "curtailment" &&
    allowsAll(plaintextInputs, CURTAILMENT_REQUIRED)
  ) {
    return MERGE_HOLDER;
  }
  if (app.id === "ancillary" && allowsAll(plaintextInputs, ANCILLARY_REQUIRED)) {
    return MERGE_HOLDER;
  }
  return app.defaultMerge;
}

export function admitExchange(input: ExchangeRequest): ExchangeRecord {
  const contractId = input.contract?.id ?? null;
  const rejected = (rejection: string): ExchangeRecord => ({
    contractId,
    mergePoint: null,
    outputHash: null,
    rejection,
  });

  if (!input.spaceMemberIds.includes(input.callerSubjectId)) {
    return rejected("not-space-member");
  }
  const contract = input.contract;
  if (!contract || contract.status !== "active" || !contract.coversInputs) {
    return rejected("no-contract");
  }
  if (!reproducibleDigest(input.operatorDigest)) {
    return rejected("operator-digest-missing");
  }
  if (rejectForbiddenOutput(input.outputFields ?? [])) {
    return rejected("forbidden-output");
  }
  try {
    const mergePoint = resolveMergePoint(
      input.applicationId,
      contract.plaintextInputs ?? [],
    );
    return {
      contractId: contract.id,
      mergePoint,
      outputHash: null,
      rejection: null,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "rejected";
    return rejected(reason);
  }
}
