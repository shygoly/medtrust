import { type Sm2Signature } from "../crypto/sm2";
import {
  SchemaError,
  asObject,
  checkKeys,
  reqArray,
  reqObject,
  reqString,
  reqTimestamp,
} from "./strict";

/**
 * 执行凭证（协议 §7.5 / 规格「执行凭证与持有方否决」，D-MDOP-1 D11）。
 *
 * 凭证核心在**要约阶段就已确定**，各持有方签的就是这份核心（加自己的快照标识），
 * 平台收齐后加自己的签名组成凭证。`plan_hash` 是「作业头 + 各节点片段哈希」的 SM3，
 * 数据快照**不进 plan_hash**——各节点复核时才算出快照，故由各持有方把快照标识和
 * 凭证核心一起签名，凭证逐签署方记录。
 */

export interface TicketCore {
  ticket_id: string;
  job_id: string;
  plan_hash: string;
  /** 节点 → 该节点片段哈希。 */
  fragments: Record<string, string>;
  not_before: string;
  not_after: string;
  /**
   * 执行环境期望（仅 C2 作业有），**按节点**存放：各持有方签署的就是「在哪个度量下执行」。
   *
   * 这里冻结的是**代码身份与策略**（链型 / 度量 / 最低可信基），不含逐次会话的 quote 摘要——
   * 后者每次证明都会变，属于会话级的释放凭据（见 `attestation/execution.ts`）。
   * 混在一起会让「每次会话重新证明」与「凭证一次性冻结」互相打架。
   *
   * 按节点存放而不是单个对象：一份作业可能把 C2 阶段落在**多个**可信空间节点上，
   * 各节点度量与链型可以不同（同一个对象会逼着它们共用一份期望，那是错的）。
   */
  attestation?: Record<string, AttestationExpectation>;
}

/** 凭证里冻结的执行环境期望。 */
export interface AttestationExpectation {
  /** 期望的硬件证明链型。 */
  tee: string;
  /** 期望的被执行代码度量。 */
  measurement: string;
  /** 期望的最低可信基版本。 */
  min_tcb?: string;
}

export type TicketSignerRole = "holder" | "platform";

export interface TicketSignature {
  signer: string;
  role: TicketSignerRole;
  /** 持有方签入的数据快照标识（平台签名不带）。 */
  snapshot?: string;
  sig: Sm2Signature;
}

export interface ExecutionTicket {
  core: TicketCore;
  signatures: TicketSignature[];
}

export function parseTicketCore(input: unknown): TicketCore {
  const obj = asObject(input, "ticket.core");
  checkKeys(obj, "ticket.core", {
    required: ["ticket_id", "job_id", "plan_hash", "fragments", "not_before", "not_after"],
    optional: ["attestation"],
  });
  const fragments = reqObject(obj, "fragments", "ticket.core");
  const parsed: Record<string, string> = {};
  for (const [node, value] of Object.entries(fragments)) {
    if (typeof value !== "string" || !/^sm3:[0-9a-f]{64}$/.test(value))
      throw new SchemaError(`ticket.core.fragments.${node}`, "必须是 sm3:<64hex>");
    parsed[node] = value;
  }
  if (Object.keys(parsed).length === 0)
    throw new SchemaError("ticket.core.fragments", "至少要有本方的片段哈希");
  const planHash = reqString(obj, "plan_hash", "ticket.core");
  if (!/^sm3:[0-9a-f]{64}$/.test(planHash))
    throw new SchemaError("ticket.core.plan_hash", "必须是 sm3:<64hex>");
  return {
    ticket_id: reqString(obj, "ticket_id", "ticket.core"),
    job_id: reqString(obj, "job_id", "ticket.core"),
    plan_hash: planHash,
    fragments: parsed,
    not_before: reqTimestamp(obj, "not_before", "ticket.core"),
    not_after: reqTimestamp(obj, "not_after", "ticket.core"),
    ...(obj.attestation === undefined
      ? {}
      : { attestation: parseAttestationExpectations(obj.attestation) }),
  };
}

/** 逐节点解析执行环境期望；值必须是合法期望，键（节点）不得为空。 */
export function parseAttestationExpectations(
  input: unknown,
): Record<string, AttestationExpectation> {
  const obj = asObject(input, "ticket.core.attestation");
  const keys = Object.keys(obj);
  if (keys.length === 0)
    throw new SchemaError("ticket.core.attestation", "至少给出一个节点的期望");
  const out: Record<string, AttestationExpectation> = {};
  for (const node of keys) {
    if (!node.trim()) throw new SchemaError("ticket.core.attestation", "节点标识不得为空");
    out[node] = parseAttestationExpectation(obj[node], `ticket.core.attestation.${node}`);
  }
  return out;
}

export function parseAttestationExpectation(
  input: unknown,
  path = "ticket.core.attestation",
): AttestationExpectation {
  const obj = asObject(input, path);
  checkKeys(obj, path, {
    required: ["tee", "measurement"],
    optional: ["min_tcb"],
  });
  const minRaw = obj.min_tcb;
  if (minRaw !== undefined && typeof minRaw !== "string")
    throw new SchemaError(`${path}.min_tcb`, "阈值必须是字符串");
  return {
    tee: reqString(obj, "tee", path),
    measurement: reqString(obj, "measurement", path),
    ...(typeof minRaw === "string" ? { min_tcb: minRaw } : {}),
  };
}

export function parseExecutionTicket(input: unknown): ExecutionTicket {
  const obj = asObject(input, "ticket");
  checkKeys(obj, "ticket", { required: ["core", "signatures"] });
  return {
    core: parseTicketCore(reqObject(obj, "core", "ticket")),
    signatures: reqArray(obj, "signatures", "ticket").map((item, i) => {
      const path = `ticket.signatures[${i}]`;
      const sigObj = asObject(item, path);
      checkKeys(sigObj, path, {
        required: ["signer", "role", "sig"],
        optional: ["snapshot"],
      });
      const role = reqString(sigObj, "role", path);
      if (role !== "holder" && role !== "platform")
        throw new SchemaError(`${path}.role`, `必须 holder 或 platform（收到 ${role}）`);
      const sig = reqObject(sigObj, "sig", path);
      checkKeys(sig, `${path}.sig`, { required: ["alg", "kid", "value"] });
      const snapshot = sigObj.snapshot;
      if (role === "holder" && typeof snapshot !== "string")
        throw new SchemaError(path, "持有方签名必须带数据快照标识");
      return {
        signer: reqString(sigObj, "signer", path),
        role: role as TicketSignerRole,
        ...(typeof snapshot === "string" ? { snapshot } : {}),
        sig: {
          alg: reqString(sig, "alg", `${path}.sig`),
          kid: reqString(sig, "kid", `${path}.sig`),
          value: reqString(sig, "value", `${path}.sig`),
        },
      };
    }),
  };
}

/** 持有方在 `PlanFragmentAccept` 里签的内容：凭证核心 + 本节点快照标识。 */
export interface HolderAcceptance {
  core: TicketCore;
  snapshot: string;
}

export function holderAcceptanceMessage(core: TicketCore, snapshot: string): HolderAcceptance {
  return { core, snapshot };
}
