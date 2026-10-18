import { InMemorySessionRepository } from './in-memory-session.repository';
import { runSessionRepositoryContract } from '../test-utils/session-repository.contract';

/**
 * better-sqlite3 是原生模块，ABI 与 Node 版本绑定（仓内基线 Node 20 / NODE_MODULE_VERSION 115）。
 * 只做 `require` 不够：部分加载路径是惰性的，必须真的建一个库才算探测成功。
 */
function sqliteDriverAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const probe = new Database(':memory:');
    probe.close();
    return true;
  } catch {
    return false;
  }
}

runSessionRepositoryContract(
  '会话仓储契约 · 内存实现',
  describe,
  it,
  async (ttlHours) => {
    const repo = new InMemorySessionRepository({
      ttlHours,
      maxMessagesPerSession: 200,
    });
    return { repo, dispose: async () => undefined };
  },
);

if (sqliteDriverAvailable()) {
  runSessionRepositoryContract(
    '会话仓储契约 · TypeORM-SQLite（:memory:）',
    describe,
    it,
    async (ttlHours) => {
      const { createSqliteSessionRepository } = await import('./sqlite/create-sqlite-repository');
      const repo = await createSqliteSessionRepository({
        database: ':memory:',
        ttlHours,
        maxMessagesPerSession: 200,
        synchronize: true,
      });
      return { repo, dispose: async () => repo.onModuleDestroy() };
    },
  );
} else {
  describe('会话仓储契约 · TypeORM-SQLite', () => {
    it.skip('跳过：better-sqlite3 原生模块在当前 Node ABI 下不可用（仓内基线为 Node 20）；用 Node 20 跑本套件可完整验证', () => {
      // 在 Node 20 下（或 CHAT_AGENT_DB=sqlite 的部署里）这条套件会真正跑起来。
    });
  });
}
