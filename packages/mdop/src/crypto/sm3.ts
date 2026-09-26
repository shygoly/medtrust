import { sm3 } from "sm-crypto";
import { canonicalBytes } from "../canonical/jcs";

/** 真国密 SM3（64 hex 小写）。禁止以 sha256 冒充（check-meta-docs 有守护）。 */
export function sm3Hex(input: string | Uint8Array): string {
  return sm3(input as string | number[]);
}

/** 规范化 + SM3：协议里「对象的哈希」一律指这个。返回 `sm3:<64hex>`。 */
export function canonicalSm3(value: unknown): string {
  return `sm3:${sm3Hex(canonicalBytes(value))}`;
}

/** 规范化 + SM3（不带 `sm3:` 前缀），给需要裸摘要的地方（如 kid、快照标识）。 */
export function canonicalSm3Hex(value: unknown): string {
  return sm3Hex(canonicalBytes(value));
}

/** 剥离 `sm3:` 前缀（幂等）。 */
export function stripSm3Prefix(value: string): string {
  return value.startsWith("sm3:") ? value.slice(4) : value;
}

/** 校验 `sm3:<64hex>` 形状。 */
export function isSm3Digest(value: unknown): value is string {
  return typeof value === "string" && /^sm3:[0-9a-f]{64}$/.test(value);
}
