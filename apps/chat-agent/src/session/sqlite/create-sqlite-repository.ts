import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DataSource } from 'typeorm';
import { ChatMessageEntity } from './chat-message.entity';
import { ChatSessionEntity } from './chat-session.entity';
import { TypeOrmSessionRepository, type SqliteSessionOptions } from './typeorm-session.repository';

export interface CreateSqliteOptions extends SqliteSessionOptions {
  /** 非生产同步表结构；生产应改为 migrations（M4） */
  synchronize: boolean;
}

/**
 * 独立 SQLite 库（`./data/chat-agent.db`）。
 *
 * 不复用 packages/database 的 ControlPlaneDataSource：那是控制面的固定实体集，
 * 会话表属于本应用，混进去会把 DOMAIN 的实体覆盖矩阵搅乱。
 */
export async function createSqliteSessionRepository(
  options: CreateSqliteOptions,
): Promise<TypeOrmSessionRepository> {
  if (options.database !== ':memory:') {
    mkdirSync(dirname(options.database), { recursive: true });
  }
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: options.database,
    entities: [ChatSessionEntity, ChatMessageEntity],
    synchronize: options.synchronize,
  });
  await dataSource.initialize();
  return new TypeOrmSessionRepository(dataSource, options);
}
