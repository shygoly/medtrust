import { canonicalize } from "../canonical/jcs";
import {
  SM2_ALGORITHM,
  publicKeyKid,
  signCanonicalObject,
  verifyCanonicalObject,
  type Sm2Signature,
} from "../crypto/sm2";
import { sm3Hex } from "../crypto/sm3";
import { MdopError } from "../errors";
import { fragmentHash } from "../plan/hash";
import { type Fragment } from "../schema/plan";
import {
  holderAcceptanceMessage,
  parseTicketCore,
  type ExecutionTicket,
  type TicketCore,
  type TicketSignature,
} from "../schema/ticket";

/**
 * 凭证构造与执行前校验（规格「执行凭证与持有方否决」「执行前凭证校验」）。
 *
 * 签名口径（写在协议里，平台与连接器同实现）：
 *  - 平台签名：对**凭证核心**签名 → SM3(JCS(core))；
 *  - 持有方签名：对 {core, snapshot} 签名 → SM3(JCS({core, snapshot}))，
 *    这样每个节点只为**自己的**数据快照背书，改快照即失效（E_SNAPSHOT_CHANGED）。
 */

export function platformSignCore(
  core: TicketCore,
  privateKey: string,
  publicKey: string,
  signer = "",
): TicketSignature {
  return {
    signer,
    role: "platform",
    sig: signCanonicalObject(core, privateKey, { publicKey }),
  };
}

export function holderSignAcceptance(
  core: TicketCore,
  snapshot: string,
  signer: string,
  privateKey: string,
  publicKey: string,
): TicketSignature {
  const message = holderAcceptanceMessage(core, snapshot);
  return {
    signer,
    role: "holder",
    snapshot,
    sig: signCanonicalObject(message, privateKey, { publicKey }),
  };
}

export function buildTicket(
  core: TicketCore,
  holderSignatures: TicketSignature[],
  platformSignature: TicketSignature,
): ExecutionTicket {
  return { core: parseTicketCore(core), signatures: [...holderSignatures, platformSignature] };
}

export interface TicketVerificationInput {
  ticket: ExecutionTicket;
  /** 本节点标识。 */
  node: string;
  /** 待执行片段。 */
  fragment: Fragment;
  /** 本方公钥（本地私钥对应的那把）。 */
  nodePublicKey: string;
  /** 本地固定的平台节点公钥（D-MDOP-3 三钥分离）。 */
  platformPublicKey: string;
  /** 平台节点标识（凭证里平台签名的 signer）。 */
  platformParty?: string;
  now: Date;
  /**
   * 执行时重算的数据快照标识。给了就与接受时签入的值比对，
   * 不一致 → E_SNAPSHOT_CHANGED。不给则跳过该项（如纯离线校验）。
   */
  recomputedSnapshot?: string | null;
}

/**
 * 执行方校验，逐项失败对应错误码：
 *  - 缺/无效本方签名、平台签名、超期、片段哈希不符 → E_TICKET_INVALID
 *  - 重算快照与签入值不一致 → E_SNAPSHOT_CHANGED
 */
export function verifyTicketForExecution(input: TicketVerificationInput): void {
  const { ticket, node } = input;
  const core = parseTicketCore(ticket.core);

  const holders = ticket.signatures.filter((s) => s.role === "holder");
  const platform = ticket.signatures.filter((s) => s.role === "platform");

  // 1. 本方签名：最关键——平台无法让本院执行一份本院没签过的计划。
  const own = holders.find((s) => s.signer === node);
  if (!own) throw new MdopError("E_TICKET_INVALID", { node }, "凭证里没有本院的接受签名");
  if (own.sig.alg !== SM2_ALGORITHM || own.sig.kid !== publicKeyKid(input.nodePublicKey))
    throw new MdopError("E_TICKET_INVALID", { node }, "本院签名的算法或 kid 不符");
  if (typeof own.snapshot !== "string")
    throw new MdopError("E_TICKET_INVALID", { node }, "本院签名未带数据快照标识");
  if (
    !verifyCanonicalObject(
      holderAcceptanceMessage(core, own.snapshot),
      own.sig,
      input.nodePublicKey,
    )
  )
    throw new MdopError("E_TICKET_INVALID", { node }, "本院对凭证核心的签名无效");

  // 2. 平台签名
  if (platform.length === 0) throw new MdopError("E_TICKET_INVALID", { node }, "凭证缺少平台签名");
  const platformSig = platform[0];
  if (
    platformSig.sig.alg !== SM2_ALGORITHM ||
    platformSig.sig.kid !== publicKeyKid(input.platformPublicKey)
  )
    throw new MdopError("E_TICKET_INVALID", {}, "平台签名的算法或 kid 不符");
  if (input.platformParty && platformSig.signer !== input.platformParty)
    throw new MdopError("E_TICKET_INVALID", {}, "平台签名的主体不是本地固定的平台节点");
  if (!verifyCanonicalObject(core, platformSig.sig, input.platformPublicKey))
    throw new MdopError("E_TICKET_INVALID", {}, "平台签名无效");

  // 3. 有效期
  const now = input.now.getTime();
  if (now < Date.parse(core.not_before) || now > Date.parse(core.not_after))
    throw new MdopError("E_TICKET_INVALID", { node }, "凭证不在有效期内");

  // 4. 待执行片段的哈希与凭证一致
  const declared = core.fragments[node];
  if (!declared) throw new MdopError("E_TICKET_INVALID", { node }, "凭证里没有本节点的片段哈希");
  if (fragmentHash(input.fragment) !== declared)
    throw new MdopError("E_TICKET_INVALID", { node }, "待执行片段的哈希与凭证不一致");

  // 5. 数据快照
  if (
    input.recomputedSnapshot !== undefined &&
    input.recomputedSnapshot !== null &&
    input.recomputedSnapshot !== own.snapshot
  )
    throw new MdopError("E_SNAPSHOT_CHANGED", { node }, "执行时数据快照与接受时不一致");
}

/** 离线校验工具用：某节点接受签名是否有效（不查有效期与片段哈希）。 */
export function verifyHolderAcceptance(
  core: TicketCore,
  signature: TicketSignature,
  publicKey: string,
): boolean {
  if (signature.role !== "holder" || typeof signature.snapshot !== "string") return false;
  return verifyCanonicalObject(
    holderAcceptanceMessage(core, signature.snapshot),
    signature.sig,
    publicKey,
  );
}

/** 供排查/审计：凭证核心的规范化哈希（不等于 plan_hash，勿混用）。 */
export function ticketCoreDigest(core: TicketCore): string {
  return `sm3:${sm3Hex(canonicalize(core))}`;
}

/** 便于调用方核对签名对象形状。 */
export function isSm2Signature(value: unknown): value is Sm2Signature {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.alg === "string" && typeof obj.kid === "string" && typeof obj.value === "string"
  );
}
