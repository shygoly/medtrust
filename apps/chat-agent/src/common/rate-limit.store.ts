import { Injectable, Logger } from '@nestjs/common';
import { MetricsService } from '../observability/metrics.service';
import type { KeyValueStore } from '../store/key-value.store';

export const RATE_LIMIT_STORE = 'RATE_LIMIT_STORE';

export interface RateLimitDecision {
  allowed: boolean;
  /** 超限时还要等多少秒（用于 Retry-After） */
  retryAfterSeconds: number;
}

/**
 * 限流计数存储。
 *
 * 两个实现的语义差别要写清楚：
 * - 内存实现是**每实例**的滑动窗口（精确到毫秒）；
 * - Redis 实现是**跨实例共享**的固定窗口（INCR + EXPIRE）。
 *   固定窗口的代价是边界处最多 2× 突发，换来的是多实例下配额真的成立。
 *   要精确滑窗得用 ZSET 脚本，当前不值得。
 */
export interface RateLimitStore {
  readonly kind: 'memory' | 'redis';
  hit(key: string, windowMs: number, limit: number): Promise<RateLimitDecision>;
}

@Injectable()
export class InMemoryRateLimitStore implements RateLimitStore {
  readonly kind = 'memory' as const;
  private readonly hits = new Map<string, number[]>();
  private lastPrune = Date.now();

  async hit(key: string, windowMs: number, limit: number): Promise<RateLimitDecision> {
    const now = Date.now();
    this.prune(now, windowMs);
    const timestamps = (this.hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (timestamps.length >= limit) {
      this.hits.set(key, timestamps);
      const oldest = timestamps[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
      };
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** 清掉所有窗口都已过期的键，避免 Map 无界增长。 */
  private prune(now: number, windowMs: number): void {
    if (now - this.lastPrune < windowMs) return;
    this.lastPrune = now;
    for (const [key, timestamps] of this.hits) {
      const alive = timestamps.filter((at) => now - at < windowMs);
      if (alive.length === 0) this.hits.delete(key);
      else this.hits.set(key, alive);
    }
  }
}

/**
 * Redis 实现：**跨实例共享**的固定窗口。
 *
 * 失败策略写明白：Redis 在运行期不可用时**失败开放**（放行 + 计数 + 告警）。
 * 理由：限流是滥用防护，不是授权；把"限流存储抖动"升级成"对话不可用"不划算。
 * 反过来，**启动期**连不上 Redis 是拒绝启动的（配置了却连不上 = 部署错误，不能静默降级成每实例限流）。
 */
export class RedisRateLimitStore implements RateLimitStore {
  readonly kind = 'redis' as const;
  private readonly logger = new Logger(RedisRateLimitStore.name);

  constructor(
    private readonly store: KeyValueStore,
    private readonly metrics: MetricsService,
  ) {}

  async hit(key: string, windowMs: number, limit: number): Promise<RateLimitDecision> {
    const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
    try {
      const count = await this.store.incrWithTtl(`ratelimit:${key}`, windowSeconds);
      if (count > limit) {
        // 固定窗口：返回整个窗口是**保守上界**（真实剩余时间更短），不会误导客户端重试过早。
        return { allowed: false, retryAfterSeconds: windowSeconds };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    } catch (error) {
      this.metrics.increment('rate_limit_store_errors_total');
      this.logger.warn(
        `限流存储不可用，本次放行：${error instanceof Error ? error.message : '未知错误'}`,
      );
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }
}
