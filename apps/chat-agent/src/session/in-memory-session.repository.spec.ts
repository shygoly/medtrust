import { InMemorySessionRepository } from './in-memory-session.repository';

describe('会话仓储（内存实现）', () => {
  it('创建后可读、列表按更新时间倒序', async () => {
    const repo = new InMemorySessionRepository({ ttlHours: 24, maxMessagesPerSession: 10 });
    const first = await repo.create('user-1', 'sh-med');
    const second = await repo.create('user-1', 'sh-med');
    await repo.appendMessage(first.id, { role: 'user', content: '你好' });

    expect((await repo.get(first.id))?.id).toBe(first.id);
    const list = await repo.list('user-1');
    expect(list.map((session) => session.id)).toEqual([first.id, second.id]);
    expect(list[0].title).toBe('你好');
  });

  it('只返回本用户会话，且可按空间过滤', async () => {
    const repo = new InMemorySessionRepository({ ttlHours: 24, maxMessagesPerSession: 10 });
    await repo.create('user-1', 'sh-med');
    await repo.create('user-1', 'other-space');
    await repo.create('user-2', 'sh-med');

    expect((await repo.list('user-1')).length).toBe(2);
    expect((await repo.list('user-1', 'sh-med')).length).toBe(1);
  });

  it('过期会话读不到、清理时被移除', async () => {
    const repo = new InMemorySessionRepository({ ttlHours: 0, maxMessagesPerSession: 10 });
    const session = await repo.create('user-1', 'sh-med');
    expect(await repo.get(session.id)).toBeNull();
    expect(await repo.purgeExpired()).toBe(0);
  });

  it('追加消息刷新过期时间并限制条数', async () => {
    const repo = new InMemorySessionRepository({ ttlHours: 24, maxMessagesPerSession: 2 });
    const session = await repo.create('user-1', 'sh-med');
    await repo.appendMessage(session.id, { role: 'user', content: 'a' });
    await repo.appendMessage(session.id, { role: 'assistant', content: 'b' });
    await repo.appendMessage(session.id, { role: 'user', content: 'c' });

    const stored = await repo.get(session.id);
    expect(stored?.messages.map((message) => message.content)).toEqual(['b', 'c']);
  });

  it('删除需归属本人', async () => {
    const repo = new InMemorySessionRepository({ ttlHours: 24, maxMessagesPerSession: 10 });
    const session = await repo.create('user-1', 'sh-med');
    expect(await repo.delete(session.id, 'user-2')).toBe(false);
    expect(await repo.delete(session.id, 'user-1')).toBe(true);
    expect(await repo.get(session.id)).toBeNull();
  });

  it('向不存在的会话追加消息返回 null', async () => {
    const repo = new InMemorySessionRepository({ ttlHours: 24, maxMessagesPerSession: 10 });
    expect(await repo.appendMessage('missing', { role: 'user', content: 'x' })).toBeNull();
  });
});
