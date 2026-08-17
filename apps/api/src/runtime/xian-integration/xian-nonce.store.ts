import { Injectable } from "@nestjs/common";

// 单实例内存 nonce 防重放（PDF §5.2）。注意：本实现只对单实例有效，
// 多实例部署必须换 Redis/Postgres 等共享存储，否则每个实例各自记账，
// 无法防跨实例重放。
@Injectable()
export class XianNonceStore {
  private readonly seen = new Map<string, number>();
  private readonly maxEntries = 10_000;

  claim(nonce: string, ttlMs: number): boolean {
    if (!nonce || nonce.length > 128) return false;
    const now = Date.now();
    const expireAt = this.seen.get(nonce);
    if (expireAt !== undefined && expireAt > now) return false;

    // 有界：先清过期，清完仍满则拒绝（fail closed），防止内存无限增长。
    if (this.seen.size >= this.maxEntries) {
      for (const [k, v] of this.seen) {
        if (v <= now) this.seen.delete(k);
      }
      if (this.seen.size >= this.maxEntries) return false;
    }

    this.seen.set(nonce, now + ttlMs);
    return true;
  }
}
