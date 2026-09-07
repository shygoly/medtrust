import { sm3 } from 'sm-crypto';

// 真国密 SM3 摘要(64 hex 小写)。用于连接器侧存证/假名化,禁止以 sha256 冒充 SM3。
export function sm3Hex(input: string): string {
  return sm3(input);
}

// "SM3:" + 16 hex 指纹(沿用既有口径),底层为国密 SM3 而非 sha256。
// 与 rws-orchestrator / settlement / secretflow spec hash 的历史前缀保持一致。
export function sm3Fingerprint(input: string): string {
  return 'SM3:' + sm3(input).slice(0, 16);
}
