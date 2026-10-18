import assert from 'node:assert/strict';
import type { SessionRepository } from '../session/session.types';

export interface ContractFixture {
  repo: SessionRepository;
  dispose: () => Promise<void>;
}

/**
 * 会话仓储契约：两个实现（内存 / TypeORM-SQLite）必须同样满足。
 * 放在 test-utils（构建排除），由各实现的 spec 调用。
 */
export function runSessionRepositoryContract(
  name: string,
  describeFn: (title: string, fn: () => void) => void,
  itFn: (title: string, fn: () => Promise<void>) => void,
  make: (ttlHours: number) => Promise<ContractFixture>,
): void {
  describeFn(name, () => {
    itFn('创建/读取/列表：标题取首条用户消息，列表按更新时间倒序', async () => {
      const { repo, dispose } = await make(24);
      try {
        const first = await repo.create('user-1', 'sh-med');
        const second = await repo.create('user-1', 'sh-med');
        await repo.appendMessage(first.id, { role: 'user', content: '我想做单臂对照' });

        const loaded = await repo.get(first.id);
        assert.equal(loaded?.id, first.id);
        assert.equal(loaded?.messages.length, 1);
        assert.equal(loaded?.title, '我想做单臂对照');

        const list = await repo.list('user-1');
        assert.deepEqual(list.map((s) => s.id), [first.id, second.id]);
      } finally {
        await dispose();
      }
    });

    itFn('列表按用户与空间隔离，缺省只过滤用户', async () => {
      const { repo, dispose } = await make(24);
      try {
        await repo.create('user-1', 'sh-med');
        await repo.create('user-1', 'power-space');
        await repo.create('user-2', 'sh-med');
        assert.equal((await repo.list('user-1')).length, 2);
        assert.equal((await repo.list('user-1', 'sh-med')).length, 1);
        assert.equal((await repo.list('user-2')).length, 1);
      } finally {
        await dispose();
      }
    });

    itFn('ttl=0 的会话读不到（过期即不可见）', async () => {
      const { repo, dispose } = await make(0);
      try {
        const session = await repo.create('user-1', 'sh-med');
        assert.equal(await repo.get(session.id), null);
      } finally {
        await dispose();
      }
    });

    itFn('追加消息刷新更新时间；未知会话返回 null；消息条数受上限约束', async () => {
      const ttl = 24;
      const { repo, dispose } = await make(ttl);
      try {
        const session = await repo.create('user-1', 'sh-med');
        const before = (await repo.get(session.id))?.updatedAt;
        await repo.appendMessage(session.id, { role: 'assistant', content: 'a' });
        const after = (await repo.get(session.id))?.updatedAt;
        assert.ok(before && after && after >= before);

        assert.equal(
          await repo.appendMessage('missing-session', { role: 'user', content: 'x' }),
          null,
        );
      } finally {
        await dispose();
      }
    });

    itFn('删除需归属本人，删除后读不到', async () => {
      const { repo, dispose } = await make(24);
      try {
        const session = await repo.create('user-1', 'sh-med');
        assert.equal(await repo.delete(session.id, 'user-2'), false);
        assert.equal(await repo.delete(session.id, 'user-1'), true);
        assert.equal(await repo.get(session.id), null);
      } finally {
        await dispose();
      }
    });

    itFn('卡片随消息一起持久化（simple-json 往返）', async () => {
      const { repo, dispose } = await make(24);
      try {
        const session = await repo.create('user-1', 'sh-med');
        await repo.appendMessage(session.id, {
          role: 'assistant',
          content: '好的',
          cards: [
            {
              type: 'form',
              title: '外部对照配置',
              scenario: 'external-control',
              fields: [{ name: 'trial', label: '试验方', type: 'text' }],
            },
          ],
        });
        const loaded = await repo.get(session.id);
        assert.equal(loaded?.messages[0].cards?.[0].scenario, 'external-control');
        assert.equal(loaded?.messages[0].cards?.[0].fields?.[0].name, 'trial');
      } finally {
        await dispose();
      }
    });

    itFn('场景草稿独立持久化，清空后不再回放', async () => {
      const { repo, dispose } = await make(24);
      try {
        const session = await repo.create('user-1', 'sh-med');
        const draft = {
          scenarioId: 'external-control',
          assistantIntent: 'access-contract' as const,
          values: { trial: 'p-a', trialDataProduct: 'dp-a' },
          purposeCode: '对话式任务配置（AI Chat Agent）',
          contractDependencies: [
            { role: 'trial', participantId: 'p-a', dataProductId: 'dp-a' },
          ],
          status: 'checking' as const,
          updatedAt: '2026-10-17T00:00:00.000Z',
        };
        assert.equal(await repo.setScenarioDraft(session.id, draft), true);
        assert.deepEqual((await repo.get(session.id))?.scenarioDraft, draft);
        assert.equal(await repo.setScenarioDraft(session.id, null), true);
        assert.equal((await repo.get(session.id))?.scenarioDraft, undefined);
      } finally {
        await dispose();
      }
    });
  });
}
