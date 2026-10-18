import { sm3 } from 'sm-crypto';

// 真国密 SM3 摘要(64 hex 小写)。用于连接器侧存证/假名化,禁止以 sha256 冒充 SM3。
export function sm3Hex(input: string): string {
  return sm3(input);
}

// 字节序列的 SM3(64 hex 小写) —— 算法模块字节的指纹口径。
// 与 sm3Hex(string) 不同:不经过任何字符编码,直接对原始字节求摘要。
// 与平台侧 GMCryptoService.sm3HashBytes / packages/wasm-algorithms 构建脚本同口径。
export function sm3BytesHex(bytes: Uint8Array): string {
  return sm3(bytes);
}

// "SM3:" + 16 hex 指纹(沿用既有口径),底层为国密 SM3 而非 sha256。
// 与 rws-orchestrator / settlement / secretflow spec hash 的历史前缀保持一致。
export function sm3Fingerprint(input: string): string {
  return 'SM3:' + sm3(input).slice(0, 16);
}

const SM3_BLOCK_BYTES = 64;

function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

// HMAC-SM3(RFC 2104 结构,分组 64 字节),返回 64 hex 小写。
// 键控假名(HMAC)必须与裸摘要分开口径:裸 sm3 谁都能算,键控才能做到「平台无从反查」。
// 放在本文件是因为连接器平面只许这一个 sm-crypto 直引入口(见 scripts/check-crypto-imports.mjs)。
export function hmacSm3Hex(key: string, message: string): string {
  let k = [...Buffer.from(key, 'utf-8')];
  if (k.length > SM3_BLOCK_BYTES) k = hexToBytes(sm3BytesHex(new Uint8Array(k)));
  while (k.length < SM3_BLOCK_BYTES) k.push(0);
  const ipad = k.map((b) => b ^ 0x36);
  const opad = k.map((b) => b ^ 0x5c);
  const inner = sm3BytesHex(new Uint8Array([...ipad, ...Buffer.from(message, 'utf-8')]));
  return sm3BytesHex(new Uint8Array([...opad, ...hexToBytes(inner)]));
}
