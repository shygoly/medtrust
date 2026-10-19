import { DataSource } from 'typeorm';
import { ChatMessageEntity } from '../typeorm/chat-message.entity';
import { ChatSessionEntity } from '../typeorm/chat-session.entity';
import {
  TypeOrmSessionRepository,
  type TypeOrmSessionOptions,
} from '../typeorm/typeorm-session.repository';
import { join } from 'node:path';

export interface CreatePostgresOptions extends TypeOrmSessionOptions {
  url: string;
  synchronize: boolean;
}

export async function createPostgresSessionRepository(
  options: CreatePostgresOptions,
): Promise<TypeOrmSessionRepository> {
  if (!/^postgres(ql)?:\/\//.test(options.url)) {
    throw new Error('CHAT_AGENT_DATABASE_URL must be a postgres:// URL');
  }
  const dataSource = new DataSource({
    type: 'postgres',
    url: options.url,
    entities: [ChatSessionEntity, ChatMessageEntity],
    migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
    migrationsRun: true,
    synchronize: options.synchronize,
  });
  await dataSource.initialize();
  return new TypeOrmSessionRepository(dataSource, options);
}
