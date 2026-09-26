import {
  publicKeyFromPrivateKey,
  publicKeyKid,
  signCanonicalObject,
  sm2Decrypt,
  sm2Encrypt,
  verifyCanonicalObject,
} from "../crypto/sm2";
import { MdopError, type MdopEdgeRef } from "../errors";
import type { AttestationPolicy } from "../label/lattice";
import { asObject, checkKeys, reqEnum, reqString, reqTimestamp, SchemaError } from "../schema/strict";
import type { SessionWarrant } from "./execution";
import type { AttestationReport, AttestationVerifier } from "./provider";
import { evaluateKeyRelease, warrantDigest } from "./release";

/**
 * 数据密钥释放（KMS）的**客户端接缝**（任务 3.3 / 4.1–4.3、决策 D-TEE-1）。
 *
 * 这一层存在的理由与证明提供者一样：**换 KMS 实现不动调用点**。节点只知道
 * 「提交证明 + 凭证 + `key_id`，拿回一份以一次性公钥封好的数据密钥与一份可离线核验的释放凭据」；
 * KMS 是持有方自建还是与运营方共管、是软件库还是硬件密码机，都在实现里，不在协议里。
 *
 * 归属（D-TEE-1，不得含糊）：
 *  - ① 数据持有方自建 KMS；② 与运营方共管（门限/双签）。
 *  - **平台 MUST NOT 持有解密能力**（`platform-no-key-access.spec.ts` 有用例守着）。
 *  - 本文件里的 `LocalDevKms` **只是本机演练**：密钥在进程内存里、无远程证明服务、
 *    **不得**用于真实数据（真实数据下必须换成持有方自建/共管的 KMS）。
 */

export interface KeyReleaseRequest {
  key_id: string;
  /** 该 `key_id` 登记所属的作业与合约（**登记侧的事实**，不是请求方声明的）。 */
  key_owner: { job_id: string; contract_id: string };
  context: { job_id: string; credential_id: string; contract_id: string };
  report: AttestationReport;
  policy: AttestationPolicy;
  /** 调用方已完成的凭证校验结果（签名完整且在有效期内）。 */
  credential_valid: boolean;
  /** 合约是否仍然有效（未终止、在有效期内）。 */
  contract_active: boolean;
  now?: Date;
  where?: MdopEdgeRef;
}

/**
 * 释放凭据：KMS 对**本次会话**的处置结果（D13）。
 *
 * 三件事都必须在里面：① 用**一次性公钥**封好的数据密钥；② 封给了哪把一次性公钥的指纹
 * （否则拿别次会话的凭据重放，节点看不出）；③ KMS 的签名（持有方据此离线复核，
 * 不必把信任交给平台）。
 */
export interface KeyReleaseWarrant {
  key_id: string;
  kms: string;
  /** `evaluateKeyRelease` 算出的释放摘要：证明摘要 + 度量 + TCB + 归属 + 有效期。 */
  warrant_digest: string;
  /** 用证明报告里的一次性公钥封装的数据密钥（base64 或 hex，由实现自述 `wrapped_key_encoding`）。 */
  wrapped_key: string;
  wrapped_key_encoding: "hex" | "base64";
  /** 一次性公钥指纹（`kid`）：节点据此确认这份凭据是封给**本次**证明的。 */
  ephemeral_key_digest: string;
  issued_at: string;
  expires_at: string;
  sig: { alg: "SM2-SM3"; kid: string; value: string };
}

export interface KmsClient {
  /** KMS 标识（写进审计与凭据）。 */
  readonly kmsRef: string;
  requestRelease(input: KeyReleaseRequest): Promise<KeyReleaseWarrant>;
}

/**
 * 严格解析一份释放凭据（**跨网络收来的对象必须走这里**）。
 * 与证明报告同理：凭据在 KMS 侧是内部对象，随见证消息上网后就是不受信输入。
 */
export function parseKeyReleaseWarrant(input: unknown): KeyReleaseWarrant {
  const obj = asObject(input, "attestation.warrant");
  checkKeys(obj, "attestation.warrant", {
    required: [
      "key_id",
      "kms",
      "warrant_digest",
      "wrapped_key",
      "wrapped_key_encoding",
      "ephemeral_key_digest",
      "issued_at",
      "expires_at",
      "sig",
    ],
  });
  const warrantDigest = reqString(obj, "warrant_digest", "attestation.warrant");
  if (!/^sm3:[0-9a-f]{64}$/.test(warrantDigest))
    throw new SchemaError("attestation.warrant.warrant_digest", "必须是 sm3:<64hex>");
  const ephemeralKeyDigest = reqString(obj, "ephemeral_key_digest", "attestation.warrant");
  if (!/^[0-9a-f]{64}$/.test(ephemeralKeyDigest))
    throw new SchemaError("attestation.warrant.ephemeral_key_digest", "必须是 64 hex 的公钥摘要");
  const encoding = reqEnum(obj, "wrapped_key_encoding", "attestation.warrant", [
    "hex",
    "base64",
  ] as const);
  const wrapped = reqString(obj, "wrapped_key", "attestation.warrant");
  const wrappedOk =
    encoding === "hex" ? /^[0-9a-f]+$/i.test(wrapped) : /^[A-Za-z0-9+/=]+$/.test(wrapped);
  if (!wrappedOk)
    throw new SchemaError("attestation.warrant.wrapped_key", `与 ${encoding} 编码不符`);

  const sigObj = asObject(obj.sig, "attestation.warrant.sig");
  checkKeys(sigObj, "attestation.warrant.sig", { required: ["alg", "kid", "value"] });
  const alg = reqString(sigObj, "alg", "attestation.warrant.sig");
  if (alg !== "SM2-SM3")
    throw new SchemaError("attestation.warrant.sig.alg", "线上链路只接受 SM2-SM3（不接受旧格式）");
  const kid = reqString(sigObj, "kid", "attestation.warrant.sig");
  if (!/^[0-9a-f]{64}$/.test(kid))
    throw new SchemaError("attestation.warrant.sig.kid", "kid 必须是公钥 SM3 全长（64 hex）");

  return {
    key_id: reqString(obj, "key_id", "attestation.warrant"),
    kms: reqString(obj, "kms", "attestation.warrant"),
    warrant_digest: warrantDigest,
    wrapped_key: wrapped,
    wrapped_key_encoding: encoding,
    ephemeral_key_digest: ephemeralKeyDigest,
    issued_at: reqTimestamp(obj, "issued_at", "attestation.warrant"),
    expires_at: reqTimestamp(obj, "expires_at", "attestation.warrant"),
    sig: { alg, kid, value: reqString(sigObj, "value", "attestation.warrant.sig") },
  };
}

/**
 * 释放凭据的**统一核对口径**（节点侧与持有方侧共用）。
 *
 * 逐项 fail-closed：验签 → 归属与作业对得上 → 摘要重算一致 → 封给了本次证明的一次性公钥 → 未过期。
 * 通过后返回可直接喂给 `verifyC2Execution` 的会话凭据——**只有这一条路径**能产出它。
 */
export function verifyReleaseWarrant(input: {
  warrant: KeyReleaseWarrant;
  /** KMS 公钥：**来自部署配置或合约**，MUST NOT 取自平台消息（否则平台被攻破即可连公钥一起换）。 */
  kmsPublicKey: string;
  report: AttestationReport;
  context: { job_id: string; credential_id: string; contract_id: string; key_id: string };
  /**
   * 数据持有方**指定的** KMS 标识（通常来自信封 `wrapped_key.kms`）。
   *
   * 为什么要单独对拍：签名只能证明「这是配置里那把公钥对应的 KMS 签的」，
   * 不能证明「它就是我当初指定的那个保管方」。D-TEE-1 的模型里**每个数据持有方可以自建 KMS**
   * （或与节点运营方共管），一旦部署里存在多个 KMS，「谁有权释放这份数据的密钥」就必须逐份核对，
   * 否则会出现「信封指定持有方甲方的 KMS 保管、却由别家 KMS 释放并被接受」。
   */
  expectedKms?: string;
  now?: Date;
  where?: MdopEdgeRef;
}): SessionWarrant {
  const { warrant, report, context, where = {}, now = new Date() } = input;

  if (warrant.key_id !== context.key_id)
    throw new MdopError("E_KEY_RELEASE_DENIED", where, "释放凭据的 key_id 与本作业不符");

  // KMS 归属：信封指定的保管方必须就是签发这份凭据的那一个（签名只证明「是某个配置内的 KMS」）
  if (input.expectedKms !== undefined && warrant.kms !== input.expectedKms)
    throw new MdopError(
      "E_KEY_RELEASE_DENIED",
      where,
      `释放凭据不是信封指定的 KMS 签发（期望 ${input.expectedKms}，实际 ${warrant.kms}）`,
    );

  const { sig, ...signed } = warrant;
  if (sig.alg !== "SM2-SM3" || !verifyCanonicalObject(signed, sig, input.kmsPublicKey))
    throw new MdopError("E_KEY_RELEASE_DENIED", where, "释放凭据签名无效（不是该 KMS 签发）");

  const expected = warrantDigest({
    job_id: context.job_id,
    credential_id: context.credential_id,
    contract_id: context.contract_id,
    key_id: context.key_id,
    report,
  });
  if (warrant.warrant_digest !== expected)
    throw new MdopError(
      "E_KEY_RELEASE_DENIED",
      where,
      "释放凭据的摘要与本次证明/作业不符（不得把别次会话的凭据拿来用）",
    );

  // 封给谁：必须是**本次证明**的一次性公钥，否则等于拿别人的密钥封装顶替
  const ephemeral = report.ephemeral_public_key;
  if (!ephemeral)
    throw new MdopError("E_KEY_RELEASE_DENIED", where, "本次证明没有一次性公钥，凭据无从核对");
  if (warrant.ephemeral_key_digest !== ephemeralKeyDigest(ephemeral))
    throw new MdopError("E_KEY_RELEASE_DENIED", where, "释放凭据不是封给本次证明的一次性公钥");

  const expires = Date.parse(warrant.expires_at);
  if (!Number.isFinite(expires) || expires <= now.getTime())
    throw new MdopError("E_KEY_RELEASE_DENIED", where, "释放凭据已过期，必须重新证明并重新释放");

  return {
    digest: warrant.warrant_digest,
    signature_valid: true,
    job_id: context.job_id,
    credential_id: context.credential_id,
    contract_id: context.contract_id,
    key_id: context.key_id,
    quote_digest: report.quote_digest ?? "",
    measurement: report.measurement,
    tcb: report.tcb,
    expires_at: warrant.expires_at,
  };
}

/** 一次性公钥指纹：未压缩点的 SM3（与 `kid` 同口径）。 */
export function ephemeralKeyDigest(publicKey: string): string {
  return publicKeyKid(publicKey);
}

export interface LocalDevKmsOptions {
  /** KMS 标识（写进信封的 `wrapped_key.kms` 与本类的凭据）。 */
  kmsRef?: string;
  /** KMS 的 SM2 私钥（签释放凭据）。生产实现由持有方自建/共管 KMS 持有。 */
  privateKey: string;
  /** 部署侧配置的厂商信任根。**只有 KMS 做 quote 验签**（平台与连接器都没有证明根）。 */
  verifier: AttestationVerifier;
  /** 本机演练的密钥表：`key_id` → 数据密钥。真实 KMS 里密钥由 KMS 生成与保管，节点与平台都拿不到。 */
  keys: Map<string, Uint8Array>;
  ttlMs?: number;
  now?: () => Date;
}

/**
 * 本机演练用 KMS（`LocalDevKms`）。
 *
 * 它把「释放判据」做成真判据：**同一个 `evaluateKeyRelease`**，一条不过就拒——
 * 因此用例里的负例（度量不符 / TCB 过旧 / 证明过期 / 凭证过期 / 合约终止 / `key_id` 串作业）
 * 都是真的被拒绝，而不是演练脚本自己编的。
 *
 * 它**不**做的事（真实 KMS 才做的）：厂商证明服务/CRL 的实际校验、硬件密码机保管、
 * 门限/双签共管、密钥不出机。因此：真实数据不得走这条实现（D-TEE-1）。
 */
export class LocalDevKms implements KmsClient {
  readonly kmsRef: string;
  private readonly ttlMs: number;

  constructor(private readonly opts: LocalDevKmsOptions) {
    this.kmsRef = opts.kmsRef ?? "kms://local-dev";
    this.ttlMs = opts.ttlMs ?? 10 * 60_000;
  }

  /** 登记一把数据密钥的归属（真实 KMS 里这发生在封装侧；本机演练由调用方显式登记）。 */
  registerKey(input: {
    keyId: string;
    dek: Uint8Array;
    owner: { job_id: string; contract_id: string };
  }): void {
    this.keyOwners.set(input.keyId, input.owner);
    this.opts.keys.set(input.keyId, input.dek);
  }

  private readonly keyOwners = new Map<string, { job_id: string; contract_id: string }>();

  async requestRelease(input: KeyReleaseRequest): Promise<KeyReleaseWarrant> {
    const now = input.now ?? (this.opts.now ?? (() => new Date()))();
    const owner = this.keyOwners.get(input.key_id) ?? input.key_owner;

    // 判据只有一份：任何一条不过即拒，且**不回退**到明文或旧密钥（D-TEE-1）。
    const decision = evaluateKeyRelease({
      job_id: input.context.job_id,
      credential_id: input.context.credential_id,
      contract_id: input.context.contract_id,
      key_id: input.key_id,
      key_owner: owner,
      credential_valid: input.credential_valid,
      contract_active: input.contract_active,
      report: input.report,
      policy: input.policy,
      verifier: this.opts.verifier,
      now,
      where: input.where ?? {},
    });

    const dek = this.opts.keys.get(input.key_id);
    if (!dek) throw new MdopError("E_KEY_RELEASE_DENIED", {}, `KMS 中没有该密钥：${input.key_id}`);
    const ephemeral = input.report.ephemeral_public_key;
    if (!ephemeral)
      throw new MdopError("E_KEY_RELEASE_DENIED", {}, "证明里没有一次性公钥，密钥无处可封");

    const unsigned = {
      key_id: input.key_id,
      kms: this.kmsRef,
      warrant_digest: decision.warrant_digest,
      wrapped_key: sm2Encrypt(dek, ephemeral),
      wrapped_key_encoding: "hex" as const,
      ephemeral_key_digest: ephemeralKeyDigest(ephemeral),
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + this.ttlMs).toISOString(),
    };
    const publicKey = this.publicKey();
    const sig = signCanonicalObject(unsigned, this.opts.privateKey, { publicKey });
    return { ...unsigned, sig: { alg: "SM2-SM3", kid: sig.kid, value: sig.value } };
  }

  /** 本机演练用：把一次性公钥对应的私钥解开密钥（真实节点在飞地内做）。 */
  unwrapKey(warrant: KeyReleaseWarrant, ephemeralPrivateKey: string): Uint8Array {
    if (warrant.wrapped_key_encoding !== "hex")
      throw new MdopError("E_KEY_RELEASE_DENIED", {}, "本机演练只支持 hex 封装的密钥");
    return sm2Decrypt(warrant.wrapped_key, ephemeralPrivateKey);
  }

  /** 供调用方核对「凭据是不是这个 KMS 签的」。 */
  publicKey(): string {
    return publicKeyFromPrivateKey(this.opts.privateKey);
  }
}
