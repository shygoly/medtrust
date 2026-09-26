import { sm2 } from "sm-crypto";
import { canonicalize } from "../canonical/jcs";
import { sm3Hex, stripSm3Prefix } from "./sm3";
import { MdopError } from "../errors";

/**
 * 国标 SM2 签名口径（D-MDOP-3 / 规格「SM2 签名口径」）：
 *  - GM/T 0003.2 签名，带 Z_A 预处理，缺省用户 ID `1234567812345678`；
 *  - 签名值按 GM/T 0009 用 DER 编码；
 *  - 算法标识 `SM2-SM3`；
 *  - `kid` = 公钥 SM3 摘要的完整十六进制（64 位字符）。
 *
 * 实现用 sm-crypto 的 `{ hash: true, der: true, publicKey }` 参数：`hash: true` 让它先做
 * `SM3(Z_A || M)`，`der: true` 输出 DER——与 gmssl/Tongsuo 的缺省口径一致
 * （互验脚本 `scripts/interop-sm2.mjs`）。
 *
 * 旧格式（不做 Z_A、原始 r‖s）只保留 `verifyLegacySm2`，供核验切换前的历史对象
 * （如链上元数据）。线上链路 MUST NOT 用旧格式签，也 MUST NOT 接受旧格式。
 */

export const SM2_ALGORITHM = "SM2-SM3" as const;
/** GM/T 0003 缺省用户 ID。 */
export const DEFAULT_SM2_USER_ID = "1234567812345678";
/** 旧格式算法标识（仅验签历史对象）。 */
export const SM2_LEGACY_ALGORITHM = "SM2-legacy-raw" as const;

export interface Sm2KeyPair {
  /** 130 hex 未压缩点 `04‖x‖y`——与 sm-crypto 的 `getPublicKeyFromPrivateKey` 同口径，
   *  也是仓库既有的公钥存储形态。 */
  publicKey: string;
  /** 64 hex 标量。 */
  privateKey: string;
}

export interface Sm2Signature {
  /** 算法标识。签发时写 `SM2-SM3`；解析出的对象可为任意字符串，校验时判定。 */
  alg: string;
  kid: string;
  value: string;
}

const HEX = /^[0-9a-fA-F]+$/;

/**
 * 归一化公钥为 130 hex 的未压缩点 `04‖x‖y`（大写转小写，无前缀时补 `04`）。
 * 这是本包的**规范公钥形状**：`kid` 与所有 sm-crypto 调用都用它。
 */
export function normalizePublicKey(publicKey: string): string {
  if (typeof publicKey !== "string" || !HEX.test(publicKey))
    throw new MdopError("E_AUTH_INVALID", {}, "公钥不是十六进制");
  const lower = publicKey.toLowerCase();
  if (lower.length === 130 && lower.startsWith("04")) return lower;
  if (lower.length === 128) return `04${lower}`;
  throw new MdopError("E_AUTH_INVALID", {}, "公钥不是未压缩点（64 字节 x‖y 或 65 字节 04‖x‖y）");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/**
 * `kid` = 公钥 SM3 摘要的完整十六进制（64 位字符，无 `sm3:` 前缀）。
 * 摘要输入是未压缩点 `04‖x‖y` 的 65 字节——独立实现（gmssl/Tongsuo）算同一口径。
 */
export function publicKeyKid(publicKey: string): string {
  return sm3Hex(hexToBytes(normalizePublicKey(publicKey)));
}

export function generateSm2KeyPair(): Sm2KeyPair {
  const kp = sm2.generateKeyPairHex();
  return { publicKey: normalizePublicKey(kp.publicKey), privateKey: kp.privateKey.toLowerCase() };
}

export function publicKeyFromPrivateKey(privateKey: string): string {
  assertPrivateKey(privateKey);
  return normalizePublicKey(sm2.getPublicKeyFromPrivateKey(privateKey));
}

function assertPrivateKey(privateKey: string): void {
  if (typeof privateKey !== "string" || !/^[0-9a-f]{64}$/.test(privateKey))
    throw new MdopError("E_AUTH_INVALID", {}, "SM2 私钥形状非法");
}

/** 签名接受的报文类型：字符串（原样 UTF-8）或字节（通常是 32 字节摘要）。 */
export type SignableMessage = string | Uint8Array | readonly number[];

/**
 * sm-crypto 的 `arrayToHex` 用 `arr.map(...)`：**TypedArray 的 map 会把回调返回值强制转回数字**
 * （`"cb"` → NaN → 0），所以直接传 Buffer/Uint8Array 会签出一份与真实字节无关的消息。
 * 必须先摊平成普通数组。这条在互验（`scripts/interop-sm2.mjs`）里被真实抓出来过。
 */
function toLibraryMessage(message: SignableMessage): string | number[] {
  return typeof message === "string" ? message : Array.from(message as ArrayLike<number>);
}

/**
 * 按国标口径签名。调用方给 `publicKey` 时必须与该私钥匹配——
 * Z_A 预处理要用公钥，给错公钥会签出别人验不过的签名。
 */
export function sm2Sign(
  message: SignableMessage,
  privateKey: string,
  options: { publicKey?: string; userId?: string } = {},
): string {
  assertPrivateKey(privateKey);
  const publicKey = options.publicKey
    ? normalizePublicKey(options.publicKey)
    : publicKeyFromPrivateKey(privateKey);
  return sm2.doSignature(toLibraryMessage(message), privateKey, {
    hash: true,
    der: true,
    publicKey,
    userId: options.userId ?? DEFAULT_SM2_USER_ID,
  });
}

export function sm2Verify(
  message: SignableMessage,
  signature: string,
  publicKey: string,
  options: { userId?: string } = {},
): boolean {
  try {
    return sm2.doVerifySignature(
      toLibraryMessage(message),
      signature,
      normalizePublicKey(publicKey),
      {
        hash: true,
        der: true,
        userId: options.userId ?? DEFAULT_SM2_USER_ID,
      },
    );
  } catch {
    return false;
  }
}

/**
 * 旧格式验签：不做 Z_A 预处理、原始 r‖s（128 hex）。只给切换前的历史对象用。
 * 线上链路 MUST NOT 走这条路径（降级攻击面）。
 */
export function verifyLegacySm2(message: string, signature: string, publicKey: string): boolean {
  try {
    return sm2.doVerifySignature(message, signature, normalizePublicKey(publicKey));
  } catch {
    return false;
  }
}

/** 对协议对象签名：签名内容 = JCS 规范化后的 SM3 摘要（摘要字节作为消息）。 */
export function signCanonicalObject(
  value: unknown,
  privateKey: string,
  options: { publicKey?: string; userId?: string } = {},
): Sm2Signature {
  const publicKey = options.publicKey
    ? normalizePublicKey(options.publicKey)
    : publicKeyFromPrivateKey(privateKey);
  const digest = hexToBytes(sm3Hex(canonicalize(value)));
  return {
    alg: SM2_ALGORITHM,
    kid: publicKeyKid(publicKey),
    value: sm2Sign(digest, privateKey, { publicKey, userId: options.userId }),
  };
}

/** 验签协议对象。`alg` 不是国标口径即拒（线上链路不接受旧格式）。 */
export function verifyCanonicalObject(
  value: unknown,
  signature: Sm2Signature,
  publicKey: string,
  options: { userId?: string } = {},
): boolean {
  if (!signature || signature.alg !== SM2_ALGORITHM) return false;
  if (signature.kid !== publicKeyKid(publicKey)) return false;
  const digest = hexToBytes(sm3Hex(canonicalize(value)));
  return sm2Verify(digest, signature.value, publicKey, options);
}

/** 供互验脚本使用：把消息摘要成 32 字节（gmssl 的 `-in` 输入）。 */
export function canonicalDigestBytes(value: unknown): Uint8Array {
  return hexToBytes(sm3Hex(canonicalize(value)));
}

/**
 * SM2 公钥加密（缺省 C1C3C2，GM/T 0009 口径），输出十六进制密文。
 *
 * 用途单一：**KMS 把数据密钥封给证明报告里的一次性公钥**（`mdop.env/1.0` 的密钥释放）。
 * 与签名的区别要说清：签名证「谁说的」，加密保「只有谁能解」——两者不可互相替代。
 */
export function sm2Encrypt(message: Uint8Array | readonly number[] | string, publicKey: string): string {
  const msg = typeof message === "string" ? message : Array.from(message as ArrayLike<number>);
  return sm2.doEncrypt(msg, normalizePublicKey(publicKey), 1);
}

/** SM2 私钥解密：入参为 `sm2Encrypt` 的十六进制密文，返回明文字节。 */
export function sm2Decrypt(ciphertextHex: string, privateKey: string): Uint8Array {
  assertPrivateKey(privateKey);
  const plain = sm2.doDecrypt(ciphertextHex, privateKey, 1, { output: "array" }) as unknown;
  return Uint8Array.from(plain as number[]);
}

/** 把 32 字节摘要转成文档/日志用的 `sm3:` 形式。 */
export function digestBytesToSm3Label(digest: Uint8Array): string {
  return `sm3:${Buffer.from(digest).toString("hex")}`;
}

/** 剥 `sm3:` 前缀后取字节，便于把摘要作为签名消息。 */
export function sm3LabelToBytes(label: string): Uint8Array {
  const hex = stripSm3Prefix(label);
  if (!/^[0-9a-f]{64}$/.test(hex))
    throw new MdopError("E_AUTH_INVALID", {}, "摘要不是 32 字节 SM3");
  return hexToBytes(hex);
}
