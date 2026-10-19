import { InMemorySessionRepository } from './in-memory-session.repository';
import { runSessionRepositoryContract } from '../test-utils/session-repository.contract';

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
