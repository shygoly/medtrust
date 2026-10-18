import { MetricsService } from '../observability/metrics.service';
import { FakeKeyValueStore } from '../test-utils/key-value-store.fake';
import { InMemoryRateLimitStore, RedisRateLimitStore } from './rate-limit.store';

describe('InMemoryRateLimitStore（每实例滑动窗口）', () => {
  it('未超限放行；到限即拒并给出 Retry-After', async () => {
    const store = new InMemoryRateLimitStore();
    expect((await store.hit('u:1', 60_000, 2)).allowed).toBe(true);
    expect((await store.hit('u:1', 60_000, 2)).allowed).toBe(true);

    const blocked = await store.hit('u:1', 60_000, 2);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('不同键各自计数', async () => {
    const store = new InMemoryRateLimitStore();
    expect((await store.hit('u:1', 60_000, 1)).allowed).toBe(true);
    expect((await store.hit('u:2', 60_000, 1)).allowed).toBe(true);
    expect((await store.hit('u:1', 60_000, 1)).allowed).toBe(false);
  });

  it('窗口滑过后重新放行', async () => {
    const store = new InMemoryRateLimitStore();
    expect((await store.hit('u:1', 50, 1)).allowed).toBe(true);
    expect((await store.hit('u:1', 50, 1)).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect((await store.hit('u:1', 50, 1)).allowed).toBe(true);
  });
});

describe('RedisRateLimitStore（跨实例固定窗口）', () => {
  it('计数超过上限即拒，Retry-After 取整个窗口（保守上界）', async () => {
    const store = new RedisRateLimitStore(new FakeKeyValueStore(), new MetricsService());
    expect((await store.hit('u:1', 60_000, 2)).allowed).toBe(true);
    expect((await store.hit('u:1', 60_000, 2)).allowed).toBe(true);

    const blocked = await store.hit('u:1', 60_000, 2);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it('窗口秒数按秒向上取整下发', async () => {
    const fake = new FakeKeyValueStore();
    const store = new RedisRateLimitStore(fake, new MetricsService());
    await store.hit('u:1', 1_500, 5);
    expect(fake.incrCalls[0]).toEqual({ key: 'ratelimit:u:1', ttl: 2 });
  });

  it('存储不可用时失败开放 + 计数（限流故障不等于服务不可用）', async () => {
    const fake = new FakeKeyValueStore();
    fake.failing = true;
    const metrics = new MetricsService();
    const store = new RedisRateLimitStore(fake, metrics);

    const decision = await store.hit('u:1', 60_000, 1);
    expect(decision.allowed).toBe(true);
    expect(metrics.render()).toContain('rate_limit_store_errors_total 1');
  });
});
