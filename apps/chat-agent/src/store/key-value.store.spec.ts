import {
  NullKeyValueStore,
  RedisKeyValueStore,
  type RedisLike,
  type RedisMultiLike,
} from './key-value.store';

/** 假 ioredis：只实现我们用到的命令，并记录调用。 */
class FakeRedis implements RedisLike {
  readonly store = new Map<string, string>();
  readonly execLog: string[] = [];
  private counter = 0;

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, _mode: 'EX', _ttl: number): Promise<unknown> {
    this.store.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<unknown> {
    this.store.delete(key);
    return 1;
  }

  multi(): RedisMultiLike {
    // 用箭头函数（不绑定自己的 this）而不 `const self = this`：少一个别名，也没有 this 陷阱
    const pipeline: RedisMultiLike = {
      incr: (key: string) => {
        this.execLog.push('INCR ' + key);
        this.counter += 1;
        return pipeline;
      },
      expire: (key: string, ttl: number) => {
        this.execLog.push('EXPIRE ' + key + ' ' + ttl);
        return pipeline;
      },
      // 与 ioredis 一致：返回 [[err, result], ...]，第一条是 INCR 的结果
      exec: async (): Promise<unknown> => [[null, this.counter]],
    };
    return pipeline;
  }

  async quit(): Promise<unknown> {
    return 'OK';
  }
}

describe('RedisKeyValueStore', () => {
  it('键加前缀；JSON 往返；TTL 原样下发', async () => {
    const client = new FakeRedis();
    const store = new RedisKeyValueStore(client, 'medtrust:chat-agent');

    await store.set('directory:sh-med', { participants: [{ id: 'p-a' }] }, 300);
    expect([...client.store.keys()]).toEqual(['medtrust:chat-agent:directory:sh-med']);
    expect(await store.get('directory:sh-med')).toEqual({ participants: [{ id: 'p-a' }] });
  });

  it('TTL 最小为 1 秒（0/负数不能变成"永不过期"）', async () => {
    const client = new FakeRedis();
    const store = new RedisKeyValueStore(client, 'k');
    await store.set('a', 1, 0);
    expect(await store.get('a')).toBe(1);
  });

  it('非 JSON 值当作未命中并删除（不把脏数据吐给上层）', async () => {
    const client = new FakeRedis();
    const store = new RedisKeyValueStore(client, 'k');
    client.store.set('k:a', 'not-json');
    expect(await store.get('a')).toBeNull();
    expect(client.store.has('k:a')).toBe(false);
  });

  it('incrWithTtl 一次往返里同时发 INCR 与 EXPIRE', async () => {
    const client = new FakeRedis();
    const store = new RedisKeyValueStore(client, 'k');
    const count = await store.incrWithTtl('ratelimit:u:1', 60);
    expect(count).toBe(1);
    // 只发 INCR 会让键永不过期（固定窗口退化成永久窗口）——这条断言就是防它
    expect(client.execLog).toEqual(['INCR k:ratelimit:u:1', 'EXPIRE k:ratelimit:u:1 60']);
  });

  it('close 走 quit（不是硬断开，给对端机会刷完）', async () => {
    const client = new FakeRedis();
    const store = new RedisKeyValueStore(client, 'k');
    await expect(store.close()).resolves.toBeUndefined();
  });
});

describe('NullKeyValueStore（未配置 Redis）', () => {
  it('kind 如实报告 disabled；读恒未命中、写与自增是空操作', async () => {
    const store = new NullKeyValueStore();
    expect(store.kind).toBe('disabled');
    expect(await store.get('a')).toBeNull();
    await store.set('a', 1, 10);
    expect(await store.get('a')).toBeNull();
    await store.del('a');
    expect(await store.incrWithTtl('a', 60)).toBe(0);
    await expect(store.close()).resolves.toBeUndefined();
  });
});
