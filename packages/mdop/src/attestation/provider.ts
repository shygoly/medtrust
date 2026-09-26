import { sm3Hex } from "../crypto/sm3";
import { MdopError, type MdopEdgeRef } from "../errors";
import type { AttestationPolicy } from "../label/lattice";
import {
  asArray,
  asObject,
  checkKeys,
  optString,
  reqEnum,
  reqString,
  reqTimestamp,
  SchemaError,
} from "../schema/strict";
import { normalizePublicKey } from "../crypto/sm2";

/**
 * 执行环境证明的统一形态（协议 §4.3 / §9.4、决策 D-TEE-1）。
 *
 * 目的很具体：把**三种硬件证明链的差异**吸收在这一层，协议其余部分（编译期判定、
 * 凭证、KMS 释放、回执）只认这一份形态——这样换链只换实现，不动协议。
 *
 * 与既有 `TeeAttestation`（连接器 `domain/tee.ts`）的关系：那份是**软件隔离**时代的口径
 * （`level` 只在 software / hardware 之间取值，`isolation` 恒 none），本模块把它扩展为
 * 可用于 C2 判定的形态（增加 `quote_digest`、`tcb`、有效期与链型）。软件实现照旧只能
 * 声明 software + none，**不得作为 C2 目标**。
 */

export const TEE_KINDS = ["csv", "tdx", "sev-snp"] as const;
export type TeeKind = (typeof TEE_KINDS)[number];

/**
 * 校验 quote 时随证明一起用的**信任材料**（collateral）。
 *
 * 为什么它必须进证明契约、而不是各实现自己缓存：气隙/受限网络的院内环境**拿不到在线更新**，
 * 只能预取后离线校验。于是「这份材料是什么时候取的、什么时候失效」必须随证明一起被看见，
 * 否则「离线校验」会退化成「用一份不知道多旧的材料验一份不知道多新的证明」。
 *
 * 四种种类对应三条候选链的公开机制（试点 design P4）：TDX 走 `crl`（PCK 证书吊销清单）
 * 与 `qvl`（quote 校验库/安全版本），SEV-SNP 走 `vcek`（VCEK→ASK→ARK 链），
 * CSV/自托管 trustee 走 `reference-values`（RVPS 参考值）。**换链不改协议**：
 * 种类是枚举而非各链专属结构。
 */
export const COLLATERAL_KINDS = ["crl", "qvl", "vcek", "reference-values"] as const;
export type CollateralKind = (typeof COLLATERAL_KINDS)[number];

export interface AttestationCollateral {
  kind: CollateralKind;
  /** 该份材料的摘要（取回字节的 SM3），用于留痕与链上锚定。 */
  digest: string;
  /** 取回时间：气隙环境下是**预取**时间，离线刷新窗口从它起算。 */
  fetched_at: string;
  /** 该份材料自身的有效期终点：过了它，**即使还在刷新窗口内也必须拒**（过期即拒）。 */
  next_update: string;
}

/**
 * collateral 新鲜度策略（**部署配置**，不是合约条款）。
 *
 * 「离线刷新窗口」是运维事实（谁能进院内网刷新、多久刷新一次），因此由部署方给出、
 * 且**必须显式给出**：`createHardwareAttestationVerifier` 的类型要求里有它，
 * 不给就装配不出来——这正是设计 P4 残余项 ① 说的「部署前硬要求」。
 */
export interface CollateralPolicy {
  /** 必须随证明提供的材料种类；缺任一项即拒（不退化成「有几样算几样」）。 */
  required: readonly CollateralKind[];
  /** 离线刷新窗口（分钟）：`now - fetched_at` 超过它即拒。 */
  max_staleness_minutes: number;
}

export type AttestationLevel = "software" | "hardware";
export type IsolationLevel = "none" | "hardware-enclave";

export interface AttestationReport {
  /** 硬件链型；软件实现为 `null`。 */
  kind: TeeKind | null;
  level: AttestationLevel;
  isolation: IsolationLevel;
  /** 被执行代码的度量。硬件链为签名覆盖的度量值；软件链只是源码摘要，不构成证明。 */
  measurement: string;
  /** 原生 quote 的摘要，供独立校验与链上锚定；软件实现为 `null`。 */
  quote_digest: string | null;
  /** 可信基（TCB）版本；软件实现为 `null`。 */
  tcb: string | null;
  /**
   * **一次性公钥**（未压缩点 `04‖x‖y`）：KMS 用它封装数据密钥，密钥只在该实例内存里解开。
   * 它必须由证明覆盖（真实实现把它的摘要写进 quote 的绑定数据），否则等于「把信封交给任何人」。
   * 软件实现为 `null`；硬件实现在 `verifyAttestationClaims` 里**必填**。
   */
  ephemeral_public_key: string | null;
  /**
   * 身份绑定：本证明所属的参与方 URN。
   * 缺省表示该链的证明里没有身份字段；判定方给出期望节点时（`node`）会要求两者一致。
   */
  node?: string;
  /**
   * 校验 quote 所需的信任材料（**硬件实现应给**）。
   * 缺省表示该实现没有随证明提供；是否接受由部署侧的 `CollateralPolicy` 决定——
   * 真实部署必须给（`createHardwareAttestationVerifier`），开发替身才允许省。
   */
  collateral?: AttestationCollateral[];
  issued_at: string;
  expires_at: string;
}

/**
 * 证明校验器。**信任根 MUST 来自部署配置或合约，MUST NOT 来自被校验的消息**——
 * 否则控制面被攻破即可连公钥一起换（与三钥分离同一原则）。
 */
export interface AttestationVerifier {
  /** 校验签名链到厂商根。`false` 表示不可信（含链型未被任何已配置根覆盖）。 */
  verify(report: AttestationReport): boolean;
}

/** 已配置的厂商信任根：按链型各一份，只认自己覆盖的链。 */
export interface TrustedRoot {
  kind: TeeKind;
  /** 校验该链的原生 quote 摘要（真实实现对接 DCAP / 厂商证明服务）。 */
  verifyQuoteDigest(quoteDigest: string, report: AttestationReport): boolean;
}

/**
 * **真实实现的信任根**：除了验 quote，还必须声明自己的 collateral 新鲜度策略。
 *
 * 为什么用「类型上要求」而不是「文档上要求」：collateral 与 quote 校验是同一件事的两半——
 * 拿一份过期的 CRL/QVL/VCEK 去验一份新 quote，结论与没验等价。把它做成必填字段之后，
 * 真实实现**没法**只写 `verifyQuoteDigest` 就交差（本册的老话：写不出 enforcement 的条款
 * 只是愿望）。
 */
export interface TrustedRootWithCollateral extends TrustedRoot {
  collateral: CollateralPolicy;
}

/**
 * 用**部署侧配置的**信任根构造校验器。注意入参是根清单而不是某份报告：
 * 这份 API 形状本身就在阻止「拿消息里的公钥当根」。
 */
export function createAttestationVerifier(roots: readonly TrustedRoot[]): AttestationVerifier {
  return {
    verify(report: AttestationReport): boolean {
      if (report.level !== "hardware") return false;
      if (!report.kind || !report.quote_digest) return false;
      const root = roots.find((r) => r.kind === report.kind);
      if (!root) return false; // 该链没有已配置的信任根：一律不信
      return root.verifyQuoteDigest(report.quote_digest, report);
    },
  };
}

/**
 * collateral 新鲜度判定（纯函数，**离线可取**）。
 *
 * 五条判据，任一条不满足即 `ok:false`（fail-closed，理由是给运维看的、不含敏感值）：
 *  1. 策略要求的种类必须都在（缺任一项即拒，不退化成「有几样算几样」）；
 *  2. 两个时间戳必须可解析（解析不了的材料等于没有材料）；
 *  3. `fetched_at` 不得在**未来**（时间倒挂的材料不可信）；
 *  4. `next_update` 必须晚于 `now`（**过期即拒**）；
 *  5. `now - fetched_at` 不得超过离线刷新窗口（气隙环境的刷新必须真的发生）。
 */
export function evaluateCollateralFreshness(input: {
  collateral: readonly AttestationCollateral[] | undefined;
  policy: CollateralPolicy;
  now?: Date;
}): { ok: true } | { ok: false; reason: string } {
  const { collateral, policy, now = new Date() } = input;
  const items = collateral ?? [];

  const missing = policy.required.filter((kind) => !items.some((c) => c.kind === kind));
  if (missing.length > 0)
    return { ok: false, reason: `证明未随带校验材料：${missing.join(" / ")}（离线校验缺料即拒）` };

  for (const item of items) {
    const fetched = Date.parse(item.fetched_at);
    const next = Date.parse(item.next_update);
    if (!Number.isFinite(fetched) || !Number.isFinite(next))
      return { ok: false, reason: `校验材料 ${item.kind} 的时间字段非法` };
    if (fetched > now.getTime())
      return { ok: false, reason: `校验材料 ${item.kind} 的取回时间在未来（时间倒挂）` };
    if (next <= now.getTime())
      return { ok: false, reason: `校验材料 ${item.kind} 已过期（过期即拒，须重新预取）` };
    const stalenessMinutes = (now.getTime() - fetched) / 60_000;
    if (stalenessMinutes > policy.max_staleness_minutes)
      return {
        ok: false,
        reason: `校验材料 ${item.kind} 已超出离线刷新窗口（${Math.round(stalenessMinutes)} > ${policy.max_staleness_minutes} 分钟）`,
      };
  }
  return { ok: true };
}

/** `evaluateCollateralFreshness` 的抛错版：给需要**精确错误信息**的调用方（KMS 策略引擎、节点）。 */
export function assertCollateralFresh(input: {
  collateral: readonly AttestationCollateral[] | undefined;
  policy: CollateralPolicy;
  now?: Date;
  where?: MdopEdgeRef;
}): void {
  const result = evaluateCollateralFreshness(input);
  if (!result.ok) throw new MdopError("E_ATTESTATION_FAILED", input.where ?? {}, result.reason);
}

/**
 * **真实部署必须用的校验器**：验 quote **并且**判 collateral 新鲜度。
 *
 * 与 `createAttestationVerifier`（开发替身/演练用）的区别只有一个，但很关键：
 * 这里的信任根必须带 `collateral` 策略，因此**装配不出来「只验 quote、不看材料新旧」的校验器**。
 * 开发替身没有真实 quote，也就没有 collateral，继续走前者；一旦接真实证明链，
 * 换的就是这个工厂（调用点不变——`evaluateKeyRelease` 收的仍是 `AttestationVerifier`）。
 */
export function createHardwareAttestationVerifier(
  roots: readonly TrustedRootWithCollateral[],
  now: () => Date = () => new Date(),
): AttestationVerifier {
  const quoteOnly = createAttestationVerifier(roots);
  return {
    verify(report: AttestationReport): boolean {
      const root = report.kind ? roots.find((r) => r.kind === report.kind) : undefined;
      if (!root) return false;
      if (!evaluateCollateralFreshness({ collateral: report.collateral, policy: root.collateral, now: now() }).ok)
        return false;
      return quoteOnly.verify(report);
    },
  };
}

export interface AttestationProvider {
  /** 软件实现返回 `"software"`。 */
  readonly providerKind: TeeKind | "software";
  prove(): Promise<AttestationReport>;
}

export interface AttestationCheckInput {
  report: AttestationReport;
  policy: AttestationPolicy;
  verifier: AttestationVerifier;
  /**
   * 期望的节点身份（参与方 URN）。给了就要求证明绑定到该身份——
   * 否则可以拿「别处一份验得通的证明」来顶替本节点（证明与身份脱钩）。
   */
  node?: string;
  now?: Date;
  where?: MdopEdgeRef;
}

/**
 * 解析生效的度量白名单：**注册中心白名单是上限，合约只能更严**。
 *
 * 规则：合约给了清单 → 取交集（合约里超出注册中心的部分不生效，绝不因为合约写了就放行）；
 * 交集为空 → 拒绝（说明合约要求的度量一个都不在白名单里，等于无法执行，不能退化成「不限」）。
 * 合约未给清单 → 直接用注册中心白名单。
 *
 * 调用方（编译期、连接器复核、KMS）MUST 先调本函数得到生效清单，再传给 `verifyAttestationForC2`，
 * 否则会出现「三处各自算一遍、结果不一致」的老问题。
 */
export function resolveMeasurementWhitelist(input: {
  registryWhitelist: readonly string[];
  policy: AttestationPolicy;
  where?: MdopEdgeRef;
}): string[] {
  const { registryWhitelist, policy, where = {} } = input;
  if (policy.allowed_measurements === undefined) return [...registryWhitelist];
  const effective = policy.allowed_measurements.filter((m) => registryWhitelist.includes(m));
  if (effective.length === 0)
    throw new MdopError(
      "E_MEASUREMENT_NOT_ALLOWED",
      where,
      "合约要求的执行环境度量与注册中心白名单没有交集",
    );
  return effective;
}

/**
 * 合并两个合约的证明策略，**取更严的一侧**（多合约作业里，C2 目标要同时满足各自合约）。
 *
 * - 链型：取交集（都要允许才算允许）；交集为空即空清单——判定侧随即 fail-closed，不做特例。
 * - 度量清单：一侧未给＝该侧不限，另一侧的限制保留；两侧都给了取交集（可能为空）。
 * - TCB 下限：一侧未给＝该侧不设下限，另一侧保留；两侧都给了则**逐链取较高**，
 *   同一链两侧写法不可比时保留「双阈值」中较严的那个字符串——不可比本身就是 fail-closed 的输入，
 *   这里不做数值猜测。
 */
export function mergeAttestationPolicies(
  a: AttestationPolicy,
  b: AttestationPolicy,
): AttestationPolicy {
  const tee = a.tee.filter((k) => b.tee.includes(k));

  let allowed_measurements: readonly string[] | undefined;
  if (a.allowed_measurements && b.allowed_measurements)
    allowed_measurements = a.allowed_measurements.filter((m) => b.allowed_measurements!.includes(m));
  else allowed_measurements = a.allowed_measurements ?? b.allowed_measurements;

  return {
    tee,
    ...(allowed_measurements !== undefined ? { allowed_measurements } : {}),
    ...mergeMinTcb(a.min_tcb, b.min_tcb),
  };
}

function mergeMinTcb(
  a: AttestationPolicy["min_tcb"],
  b: AttestationPolicy["min_tcb"],
): { min_tcb?: string | Partial<Record<string, string>> } {
  if (a === undefined) return b === undefined ? {} : { min_tcb: b };
  if (b === undefined) return { min_tcb: a };

  if (typeof a === "string" && typeof b === "string") {
    const cmp = compareTcb(a, b);
    // 不可比（版本体系不同）时不做数值猜测：保留 a（调用方按链给阈值即可避免这一情形）
    return { min_tcb: cmp === null ? a : cmp >= 0 ? a : b };
  }

  const asMap = (v: string | Partial<Record<string, string>>): Record<string, string> =>
    typeof v === "string" ? { "*": v } : { ...(v as Record<string, string>) };
  const ma = asMap(a);
  const mb = asMap(b);
  const out: Record<string, string> = {};
  for (const kind of new Set([...Object.keys(ma), ...Object.keys(mb)])) {
    const va = ma[kind];
    const vb = mb[kind];
    if (va === undefined) out[kind] = vb;
    else if (vb === undefined) out[kind] = va;
    else {
      const cmp = compareTcb(va, vb);
      out[kind] = cmp === null ? va : cmp >= 0 ? va : vb;
    }
  }
  return { min_tcb: out as Partial<Record<string, string>> };
}

/**
 * C2 目标的证明判定（协议 §4.3「C2 边的目标 MUST 声明 TEE 能力且满足合约证明策略」）。
 *
 * 逐项 fail-closed，且**按可补救性分开错误码**：
 *  - 级别/链型不对 → `E_CAPABILITY_MISMATCH`（换节点或换合约才能解）
 *  - 证明不可信或已过期 → `E_ATTESTATION_FAILED`
 *  - 度量不在允许清单 → `E_MEASUREMENT_NOT_ALLOWED`
 *  - 可信基版本过旧/缺失 → `E_TCB_TOO_OLD`
 */
export function verifyAttestationForC2(input: AttestationCheckInput): void {
  const { report, policy, verifier, node, where = {}, now = new Date() } = input;
  verifyAttestationClaims({ report, policy, where, now });
  if (node !== undefined && report.node !== node) {
    throw new MdopError(
      "E_ATTESTATION_FAILED",
      where,
      "证明未绑定到本节点身份（不得用别处的证明顶替本节点）",
    );
  }
  if (!verifier.verify(report)) {
    throw new MdopError("E_ATTESTATION_FAILED", where, "执行环境证明未通过校验");
  }
}

/**
 * 只判「证明自身声明是否可接受」：级别、链型、有效期、度量白名单、TCB 下限。
 * **不含 quote 验签**——那一步需要厂商证明根；连接器侧拿不到，只能由 KMS 做并用释放凭据背书。
 */
export function verifyAttestationClaims(input: {
  report: AttestationReport;
  policy: AttestationPolicy;
  now?: Date;
  where?: MdopEdgeRef;
}): void {
  const { report, policy, where = {}, now = new Date() } = input;
  // ① 软件实现永远不是可信空间节点：这一条是硬门槛，任何声明都不得越过。
  if (report.level !== "hardware" || report.isolation !== "hardware-enclave") {
    throw new MdopError(
      "E_CAPABILITY_MISMATCH",
      where,
      "C2 目标必须是硬件证明的执行环境（软件隔离不得作为可信空间节点）",
    );
  }

  // ② 链型必须在合约允许清单内（缺省为空 = 不允许任何链）。
  if (!report.kind || !policy.tee.includes(report.kind)) {
    throw new MdopError("E_CAPABILITY_MISMATCH", where, "C2 目标的证明链型不在合约允许范围内");
  }

  // ②b 一次性公钥必填：没有它，数据密钥就没有可释放的目标（等于把密钥交出去）。
  if (!report.ephemeral_public_key) {
    throw new MdopError(
      "E_ATTESTATION_FAILED",
      where,
      "证明报告未包含一次性公钥——数据密钥无处可释，不得当作 C2 证明",
    );
  }

  // ③ 必须能用**配置侧信任根**验通；验不通或已过期都视为不可信。
  const issued = Date.parse(report.issued_at);
  const expires = Date.parse(report.expires_at);
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) {
    throw new MdopError("E_ATTESTATION_FAILED", where, "证明的时间字段非法");
  }
  if (expires <= now.getTime()) {
    throw new MdopError("E_ATTESTATION_FAILED", where, "证明已过期，必须重新证明");
  }

  // ④ 度量白名单（注册中心清单与合约清单由调用方合并后传入）。
  if (policy.allowed_measurements && !policy.allowed_measurements.includes(report.measurement)) {
    throw new MdopError("E_MEASUREMENT_NOT_ALLOWED", where, "执行环境度量不在允许范围内");
  }

  // ⑤ 可信基版本下限。阈值可按链型分别给出（不同链的版本体系不可互比）。
  const threshold = tcbThresholdFor(policy, report.kind);
  if (threshold !== undefined) {
    if (!report.tcb) {
      throw new MdopError("E_TCB_TOO_OLD", where, "证明未给出可信基版本，无法满足下限要求");
    }
    const cmp = compareTcb(report.tcb, threshold);
    if (cmp === null) {
      // 版本体系不同 → 阈值对该链无意义，按 fail-closed 拒（并提示应改用按链阈值）
      throw new MdopError(
        "E_TCB_TOO_OLD",
        where,
        "可信基版本无法与该链的下限比较（不同链的版本体系不可互比，请按链给出阈值）",
      );
    }
    if (cmp < 0) throw new MdopError("E_TCB_TOO_OLD", where, "执行环境可信基版本低于要求");
  }
}

/** 取该链适用的可信基阈值：按链映射写法优先，字符串写法对所有链通用。 */
function tcbThresholdFor(
  policy: AttestationPolicy,
  kind: TeeKind | null,
): string | undefined {
  const min = policy.min_tcb;
  if (min === undefined) return undefined;
  if (typeof min === "string") return min;
  if (!kind) return undefined;
  return min[kind];
}

/** 版本体系：`ym`（年月，如 `2026-06`）或 `dotted`（点分数字，如 `3.1.2`）。 */
export type TcbScheme = "ym" | "dotted";

export function tcbScheme(value: string): TcbScheme | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) return "ym";
  if (/^\d+(\.\d+)*$/.test(trimmed)) return "dotted";
  return null;
}

/**
 * 可信基版本比较。返回 `null` 表示**不可比**（形态无法识别，或两侧不属于同一版本体系）——
 */
export function compareTcb(a: string, b: string): number | null {
  const schemeA = tcbScheme(a);
  const schemeB = tcbScheme(b);
  // 版本体系不同即不可比：年月与点分数字之间没有序关系（fail-closed 交给调用方）
  if (!schemeA || !schemeB || schemeA !== schemeB) return null;
  const pa = parseTcb(a)!;
  const pb = parseTcb(b)!;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function parseTcb(value: string): number[] | null {
  const trimmed = value.trim();
  const month = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (month) return [Number(month[1]), Number(month[2])];
  const dotted = /^\d+(\.\d+)*$/.exec(trimmed);
  if (dotted) return trimmed.split(".").map((n) => Number(n));
  return null;
}

/** 各厂商原生 quote 的最小公共字段：`quote` 为原始字节的 base64。 */
export interface VendorQuote {
  vendor: TeeKind;
  measurement: string;
  tcb: string;
  quote: string;
  signed_at: string;
  valid_until: string;
  /**
   * 飞地内生成的一次性公钥（未压缩点 `04‖x‖y`）。
   * 证明代理 MUST 把它的摘要写进 quote 的绑定数据一起签——否则「用这把公钥封的密钥」
   * 与「这份证明描述的那段代码」之间就没有可验证的联系。
   */
  ephemeral_public_key: string;
  /** 身份绑定：本节点（参与方）URN。 */
  node: string;
  /** 校验 quote 所需的信任材料（真实实现应随证明一起产出；开发替身可省）。 */
  collateral?: AttestationCollateral[];
}

/**
 * 把厂商原生 quote 归一化为统一证明形态（换链不改协议的落点）。
 * `quote_digest = sm3(原生 quote)`——校验与锚定都只用这个摘要，不依赖链型细节。
 */
export function mapVendorQuote(quote: VendorQuote): AttestationReport {
  if (!quote.measurement) throw new MdopError("E_ATTESTATION_FAILED", {}, "quote 缺少度量");
  if (!quote.quote) throw new MdopError("E_ATTESTATION_FAILED", {}, "quote 缺少原始内容");
  if (!quote.ephemeral_public_key)
    throw new MdopError("E_ATTESTATION_FAILED", {}, "quote 缺一次性公钥（数据密钥将无处可释）");
  if (!quote.node) throw new MdopError("E_ATTESTATION_FAILED", {}, "quote 缺身份绑定");
  return {
    kind: quote.vendor,
    level: "hardware",
    isolation: "hardware-enclave",
    measurement: quote.measurement,
    quote_digest: `sm3:${sm3Hex(quote.quote)}`,
    tcb: quote.tcb,
    ephemeral_public_key: quote.ephemeral_public_key,
    node: quote.node,
    ...(quote.collateral ? { collateral: quote.collateral } : {}),
    issued_at: quote.signed_at,
    expires_at: quote.valid_until,
  };
}

/**
 * 软件实现的证明提供者。存在的意义只有一个：**在没有硬件时让接口、协议与回执链先跑通**。
 * 它恒为 `level=software` / `isolation=none` / 无 quote / 无 TCB，因此永远过不了
 * `verifyAttestationForC2` —— 这是设计意图，不是缺陷。
 */
export class SoftwareAttestationProvider implements AttestationProvider {
  readonly providerKind = "software" as const;

  constructor(
    private readonly opts: {
      /** 被执行代码的摘要（如源码或产物的 SM3）。仅用于留痕，不构成证明。 */
      measurement: string;
      ttlMs?: number;
      now?: () => Date;
    },
  ) {}

  async prove(): Promise<AttestationReport> {
    const now = (this.opts.now ?? (() => new Date()))();
    const ttl = this.opts.ttlMs ?? 10 * 60_000;
    return {
      kind: null,
      level: "software",
      isolation: "none",
      measurement: this.opts.measurement,
      quote_digest: null,
      tcb: null,
      ephemeral_public_key: null,
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttl).toISOString(),
    };
  }
}

/**
 * 严格解析一份证明报告（**跨网络收来的对象必须走这里**）。
 *
 * 为什么必须有：报告在节点侧是内部对象，但一旦随见证消息在网上走，它就成了**不受信输入**——
 * 多一个字段、缺一个字段、`kind` 写个没定义的字符串，都不能悄悄进入判定与登记。
 * 未知字段一律拒（`checkKeys`），与信封、合约、算子清单同一套口径。
 */
export function parseAttestationReport(input: unknown): AttestationReport {
  const obj = asObject(input, "attestation.report");
  checkKeys(obj, "attestation.report", {
    required: ["kind", "level", "isolation", "measurement", "quote_digest", "tcb", "ephemeral_public_key", "issued_at", "expires_at"],
    optional: ["node", "collateral"],
  });
  const kindRaw = optString(obj, "kind", "attestation.report");
  if (kindRaw !== undefined && !(TEE_KINDS as readonly string[]).includes(kindRaw))
    throw new SchemaError("attestation.report.kind", `未定义的证明链型：${kindRaw}`);
  const level = reqEnum(obj, "level", "attestation.report", ["software", "hardware"] as const);
  const isolation = reqEnum(obj, "isolation", "attestation.report", [
    "none",
    "hardware-enclave",
  ] as const);
  const measurement = reqString(obj, "measurement", "attestation.report");
  if (!/^sm3:[0-9a-f]{64}$/.test(measurement))
    throw new SchemaError("attestation.report.measurement", "度量必须是 sm3:<64hex>");
  const quoteDigest = optString(obj, "quote_digest", "attestation.report");
  const tcb = optString(obj, "tcb", "attestation.report");
  const ephemeral = optString(obj, "ephemeral_public_key", "attestation.report");
  if (ephemeral !== undefined) {
    try {
      normalizePublicKey(ephemeral);
    } catch {
      throw new SchemaError("attestation.report.ephemeral_public_key", "一次性公钥形状非法");
    }
  }
  const node = optString(obj, "node", "attestation.report");
  return {
    kind: kindRaw === undefined ? null : (kindRaw as TeeKind),
    level,
    isolation,
    measurement,
    quote_digest: quoteDigest ?? null,
    tcb: tcb ?? null,
    ephemeral_public_key: ephemeral ?? null,
    ...(node !== undefined ? { node } : {}),
    ...(obj.collateral !== undefined
      ? { collateral: parseCollateralList(obj.collateral) }
      : {}),
    issued_at: reqTimestamp(obj, "issued_at", "attestation.report"),
    expires_at: reqTimestamp(obj, "expires_at", "attestation.report"),
  };
}

/** 严格解析 collateral 清单：跨网络收来的材料不得多字段、少字段或写个没定义的种类。 */
export function parseCollateralList(input: unknown): AttestationCollateral[] {
  return asArray(input, "attestation.report.collateral").map((raw, index) => {
    const path = `attestation.report.collateral[${index}]`;
    const obj = asObject(raw, path);
    checkKeys(obj, path, { required: ["kind", "digest", "fetched_at", "next_update"] });
    const kind = reqEnum(obj, "kind", path, COLLATERAL_KINDS);
    const digest = reqString(obj, "digest", path);
    if (!/^sm3:[0-9a-f]{64}$/.test(digest))
      throw new SchemaError(`${path}.digest`, "材料摘要必须是 sm3:<64hex>");
    return {
      kind: kind as CollateralKind,
      digest,
      fetched_at: reqTimestamp(obj, "fetched_at", path),
      next_update: reqTimestamp(obj, "next_update", path),
    };
  });
}
