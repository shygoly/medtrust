import { Logger } from "@nestjs/common";
import { sm3 } from "sm-crypto";

/**
 * 平台私钥的**信封加密存储**（D-MDOP-3 / 规格「平台密钥按用途分离」）。
 *
 * 三把私钥 MUST 以 SM4 加密后落库，密钥加密密钥（KEK）由部署配置 `PLATFORM_KEK`
 * 提供（配置了 Vault 则从 Vault 取）。落到库里的值一律是 `enc:v1:<iv>:<cipher>`，
 * 读取这一列**拿不到可直接使用的私钥**。
 *
 * 生产环境缺少 KEK 时平台 MUST 拒绝启动 —— 见 {@link assertKekAvailable}。
 */

export type PlatformKeyPurpose = "certificate" | "platform-node" | "registry";

export const PLATFORM_KEY_PURPOSES: readonly PlatformKeyPurpose[] = [
  "certificate",
  "platform-node",
  "registry",
];

export const ENCRYPTED_PREFIX = "enc:v1:";

/**
 * 仅开发/测试使用的 KEK。生产环境缺 `PLATFORM_KEK` 会直接拒绝启动，
 * 所以这个常量不会出现在任何生产路径上；用它只是为了本机与单测能跑起来。
 */
export const DEV_KEK_FALLBACK = "medtrust-dev-only-kek";

export interface Sm4Box {
  sm4Encrypt(plaintext: string, key: string, mode: "cbc"): string;
  sm4Decrypt(ciphertext: string, key: string, mode: "cbc"): string;
}

/** 把任意长度的 KEK 归一成 16 字节 SM4 密钥（32 hex 字符）。 */
export function normalizeKek(raw: string): string {
  const value = raw.trim();
  if (/^[0-9a-fA-F]{32}$/.test(value)) return value.toLowerCase();
  // 非 32 hex 的口令：SM3 派生（前 32 hex = 16 字节），跨进程稳定。
  return sm3(value).slice(0, 32);
}

/**
 * 生产环境必须有 KEK，否则拒绝启动。开发/测试回落到 {@link DEV_KEK_FALLBACK}
 * 并显式告警 —— 不静默假装加密。
 */
export function assertKekAvailable(
  env: NodeJS.ProcessEnv,
  logger: Pick<Logger, "warn">,
): string {
  const configured = (env.PLATFORM_KEK ?? "").trim();
  if (configured) return normalizeKek(configured);
  if (env.NODE_ENV === "production") {
    throw new Error(
      "缺少 PLATFORM_KEK：生产环境必须提供平台密钥加密密钥（D-MDOP-3），拒绝启动",
    );
  }
  logger.warn(
    "未配置 PLATFORM_KEK —— 使用开发用固定 KEK。生产环境会拒绝启动，此处仅为本地/单测可用。",
  );
  return normalizeKek(DEV_KEK_FALLBACK);
}

export function isEncryptedStoredKey(
  value: string | null | undefined,
): boolean {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptStoredKey(
  plaintextPrivateKey: string,
  kek: string,
  box: Sm4Box,
): string {
  return `${ENCRYPTED_PREFIX}${box.sm4Encrypt(plaintextPrivateKey, kek, "cbc")}`;
}

export function decryptStoredKey(
  stored: string,
  kek: string,
  box: Sm4Box,
): string {
  if (!isEncryptedStoredKey(stored))
    throw new Error("平台私钥列不是密文：拒绝按明文私钥使用（D-MDOP-3）");
  return box.sm4Decrypt(stored.slice(ENCRYPTED_PREFIX.length), kek, "cbc");
}

/**
 * 读出一个用途的私钥：密文就解密；**明文一律拒绝**（除非显式要求迁移）。
 * 明文迁移只在启动路径由 {@link migratePlaintextKey} 走一次。
 */
export function readPrivateKey(
  stored: string | null | undefined,
  kek: string,
  box: Sm4Box,
): string | null {
  if (!stored) return null;
  if (isEncryptedStoredKey(stored)) return decryptStoredKey(stored, kek, box);
  throw new Error(
    "平台私钥列读到了明文：拒绝使用（须经启动迁移加密落库，D-MDOP-3）",
  );
}

export function looksLikePlaintextPrivateKey(
  value: string | null | undefined,
): boolean {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value.trim());
}

/** 历史明文私钥 → 密文（启动时原地迁移）。 */
export function migratePlaintextKey(
  stored: string | null | undefined,
  kek: string,
  box: Sm4Box,
): string | null {
  if (!stored) return null;
  if (isEncryptedStoredKey(stored)) return stored;
  if (!looksLikePlaintextPrivateKey(stored))
    throw new Error("平台私钥列的形态既不是密文也不是 64 hex 明文：拒绝猜测");
  return encryptStoredKey(stored.trim().toLowerCase(), kek, box);
}
