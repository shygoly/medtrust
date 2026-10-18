import type { KeyValueStore } from '../store/key-value.store';

/** 内存版 KV（kind 假装成 redis），用来测"配了 Redis 时"的行为分支。 */
export class FakeKeyValueStore implements KeyValueStore {
  readonly kind = 'redis' as const;
  readonly values = new Map<string, unknown>();
  readonly ttls = new Map<string, number>();
  readonly incrCalls: Array<{ key: string; ttl: number }> = [];
  private counters = new Map<string, number>();
  /** 置 true 后所有操作抛错，用于测故障分支 */
  failing = false;

  async get<T>(key: string): Promise<T | null> {
    if (this.failing) throw new Error('store down');
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (this.failing) throw new Error('store down');
    this.values.set(key, value);
    this.ttls.set(key, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    if (this.failing) throw new Error('store down');
    this.values.delete(key);
    this.ttls.delete(key);
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    if (this.failing) throw new Error('store down');
    this.incrCalls.push({ key, ttl: ttlSeconds });
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }

  async close(): Promise<void> {
    // 无连接
  }
}
