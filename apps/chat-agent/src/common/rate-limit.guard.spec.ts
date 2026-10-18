import { ExecutionContext, HttpException } from '@nestjs/common';
import { buildChatConfig } from '../config/agent.config';
import { MetricsService } from '../observability/metrics.service';
import { FakeKeyValueStore } from '../test-utils/key-value-store.fake';
import { RateLimitGuard } from './rate-limit.guard';
import { InMemoryRateLimitStore, RedisRateLimitStore, type RateLimitStore } from './rate-limit.store';

const context = (
  headers: Record<string, string>,
  ip = '10.0.0.1',
  setHeader = jest.fn(),
): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers, ip, socket: { remoteAddress: ip } }),
      getResponse: () => ({ setHeader }),
    }),
  }) as unknown as ExecutionContext;

const guardWith = (env: Record<string, string>, store?: RateLimitStore) =>
  new RateLimitGuard(
    buildChatConfig(env),
    store ?? new InMemoryRateLimitStore(),
  );

describe('RateLimitGuard（4.3.1）', () => {
  it('未超限放行，超限抛 429 并带 Retry-After', async () => {
    const guard = guardWith({ RATE_LIMIT_PER_USER_PER_MIN: '2', RATE_LIMIT_PER_IP_PER_MIN: '0' });
    const setHeader = jest.fn();
    const ctx = context({ 'x-user-id': 'u-1' }, '10.0.0.1', setHeader);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });

  it('不同用户各自计数，互不影响', async () => {
    const guard = guardWith({ RATE_LIMIT_PER_USER_PER_MIN: '1', RATE_LIMIT_PER_IP_PER_MIN: '0' });
    await expect(guard.canActivate(context({ 'x-user-id': 'a' }))).resolves.toBe(true);
    await expect(guard.canActivate(context({ 'x-user-id': 'b' }))).resolves.toBe(true);
    await expect(guard.canActivate(context({ 'x-user-id': 'a' }))).rejects.toThrow();
  });

  it('IP 维度独立生效（即使没带用户头）', async () => {
    const guard = guardWith({ RATE_LIMIT_PER_USER_PER_MIN: '0', RATE_LIMIT_PER_IP_PER_MIN: '1' });
    await expect(guard.canActivate(context({}, '192.0.2.1'))).resolves.toBe(true);
    await expect(guard.canActivate(context({}, '192.0.2.1'))).rejects.toThrow();
    await expect(guard.canActivate(context({}, '192.0.2.2'))).resolves.toBe(true);
  });

  it('两个维度都配 0 时关闭限流', async () => {
    const guard = guardWith({ RATE_LIMIT_PER_USER_PER_MIN: '0', RATE_LIMIT_PER_IP_PER_MIN: '0' });
    for (let i = 0; i < 50; i += 1) {
      await expect(guard.canActivate(context({ 'x-user-id': 'u' }))).resolves.toBe(true);
    }
  });

  it('共享存储时两个实例看到同一份配额（多实例限流成立的接缝）', async () => {
    const env = { RATE_LIMIT_PER_USER_PER_MIN: '2', RATE_LIMIT_PER_IP_PER_MIN: '0' };
    const shared = new RedisRateLimitStore(new FakeKeyValueStore(), new MetricsService());
    const instanceA = guardWith(env, shared);
    const instanceB = guardWith(env, shared);

    await expect(instanceA.canActivate(context({ 'x-user-id': 'u-1' }))).resolves.toBe(true);
    await expect(instanceA.canActivate(context({ 'x-user-id': 'u-1' }))).resolves.toBe(true);
    // 配额已被 A 用光：B 也必须拒
    await expect(instanceB.canActivate(context({ 'x-user-id': 'u-1' }))).rejects.toThrow(
      HttpException,
    );
  });
});
