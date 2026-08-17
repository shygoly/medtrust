import { Injectable } from "@nestjs/common";

// 单实例内存 nonce 防重放（PDF §5.2 推荐 Redis，本地/单实例用 TTL Map）。
@Injectable()
export class XianNonceStore {
  private readonly seen = new Map<string, number>();

  claim(nonce: string, ttlMs: number): boolean {
    if (!nonce || nonce.length > 128) return false;
    const now = Date.now();
    const expireAt = this.seen.get(nonce);
    if (expireAt && expireAt > now) return false;
    this.seen.set(nonce, now + ttlMs);
    if (this.seen.size > 10_000) {
      for (const [k, v] of this.seen) if (v <= now) this.seen.delete(k);
    }
    return true;
  }
}
