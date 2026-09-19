import { Injectable } from '@nestjs/common';

const DEFAULT_TTL_MS = 10 * 60_000;

/**
 * 下发任务去重（design D4）：同一 taskId 在 TTL 内只执行一次。
 * 防止长轮询超时重发 / 分派重排导致的重复执行。
 */
@Injectable()
export class ConnectorTaskDedupe {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  /** 首次出现返回 true（可以执行）；重复返回 false（丢弃）。 */
  accept(key: string, now = Date.now()): boolean {
    this.prune(now);
    if (this.seen.has(key)) return false;
    this.seen.set(key, now);
    return true;
  }

  size(): number {
    return this.seen.size;
  }

  private prune(now: number): void {
    for (const [key, at] of this.seen) {
      if (now - at > this.ttlMs) this.seen.delete(key);
    }
  }
}
