import { Logger } from '@nestjs/common';

export const KEY_VALUE_STORE = 'KEY_VALUE_STORE';

/**
 * 需要的键值能力（刻意很小）：取 / 放（带 TTL）/ 删 / 原子自增。
 *
 * 不做通用 KV 抽象：接口越大，两个实现（Redis / 关闭）越难保持语义一致。
 */
export interface KeyValueStore {
  /** 实际在用的实现，进 /health/ready 如实报告 */
  readonly kind: 'redis' | 'disabled';
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /**
   * 原子自增并在第一次自增时设置过期（固定窗口计数）。
   * `kind: 'disabled'` 的实现返回 0，调用方据此走本地兜底。
   */
  incrWithTtl(key: string, ttlSeconds: number): Promise<number>;
  close(): Promise<void>;
}

/** 未配置 Redis 时的实现：一切"未命中/不限流"，但**如实报告 kind=disabled**。 */
export class NullKeyValueStore implements KeyValueStore {
  readonly kind = 'disabled' as const;

  async get<T>(_key: string): Promise<T | null> {
    return null;
  }

  async set(_key: string, _value: unknown, _ttlSeconds: number): Promise<void> {
    // 有意为之：没有 Redis 就没有缓存，不假装写了。
  }

  async del(_key: string): Promise<void> {
    // 同上。
  }

  async incrWithTtl(_key: string, _ttlSeconds: number): Promise<number> {
    return 0;
  }

  async close(): Promise<void> {
    // 无连接可关。
  }
}

/** 多命令事务（MULTI）的链式形态：incr/expire 返回自身才能一行写完。 */
export interface RedisMultiLike {
  incr(key: string): RedisMultiLike;
  expire(key: string, ttl: number): RedisMultiLike;
  exec(): Promise<unknown>;
}

/** ioredis 里我们实际用到的那一小撮命令（导出是为了能用假客户端测适配层）。 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  multi(): RedisMultiLike;
  quit(): Promise<unknown>;
}

export interface RedisStoreOptions {
  url: string;
  /** 键前缀：同一 Redis 上多服务/多环境共存时避免撞键 */
  keyPrefix: string;
}

/**
 * Redis 实现。
 *
 * 为什么动态 import：`ioredis` 只在**配置了 REDIS_URL** 时才需要；不配 Redis 的部署
 * （本地、CI、演示）不该因为一个用不到的依赖而承担加载失败的风险。
 */
export class RedisKeyValueStore implements KeyValueStore {
  readonly kind = 'redis' as const;
  private readonly logger = new Logger(RedisKeyValueStore.name);

  constructor(
    private readonly client: RedisLike,
    private readonly keyPrefix: string,
  ) {}

  private key(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(this.key(key));
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // 值不是我们写的 JSON（别的进程/手工塞的）：当成未命中，顺手删掉。
      this.logger.warn(`缓存值不是 JSON，已丢弃：${key}`);
      await this.del(key);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.client.set(this.key(key), JSON.stringify(value), 'EX', Math.max(1, Math.floor(ttlSeconds)));
  }

  async del(key: string): Promise<void> {
    await this.client.del(this.key(key));
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const full = this.key(key);
    // INCR + EXPIRE 必须一次往返：只发 INCR 会漏设过期，键永不过期（固定窗口退化成永久窗口）。
    const results = (await this.client.multi().incr(full).expire(full, Math.max(1, Math.floor(ttlSeconds))).exec()) as
      | Array<[Error | null, unknown]>
      | null;
    const value = results?.[0]?.[1];
    return typeof value === 'number' ? value : Number(value ?? 1);
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

/** 建连并 ping 一次：连不上就抛（配置了 Redis 却连不上属于部署错误，不做静默降级）。 */
export async function createRedisKeyValueStore(
  options: RedisStoreOptions,
): Promise<RedisKeyValueStore> {
  const { default: Redis } = await import('ioredis');
  const client = new Redis(options.url, {
    lazyConnect: true,
    // 连不上时快速失败：不要在请求路径上挂着等重连
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
  });
  await client.connect();
  await client.ping();
  return new RedisKeyValueStore(client as unknown as RedisLike, options.keyPrefix);
}
