import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, LessThanOrEqual, type Repository } from 'typeorm';
import type {
  AppendMessageInput,
  ChatMessage,
  ChatSession,
  SessionRepository,
} from '../session.types';
import type { ScenarioDraft } from '../../agent/scenario-draft';
import { ChatMessageEntity } from './chat-message.entity';
import { ChatSessionEntity } from './chat-session.entity';

export interface TypeOrmSessionOptions {
  ttlHours: number;
  maxMessagesPerSession: number;
}

/**
 * TypeORM(PostgreSQL) 会话仓储：与 InMemorySessionRepository 同一契约。
 * `kind` 会进 /health/ready，用于如实报告当前真正在用的存储。
 */
export class TypeOrmSessionRepository implements SessionRepository, OnModuleDestroy {
  readonly kind = 'postgres' as const;
  private readonly logger = new Logger(TypeOrmSessionRepository.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly options: TypeOrmSessionOptions,
  ) {}

  private get sessions(): Repository<ChatSessionEntity> {
    return this.dataSource.getRepository(ChatSessionEntity);
  }

  private get messages(): Repository<ChatMessageEntity> {
    return this.dataSource.getRepository(ChatMessageEntity);
  }

  async create(userId: string, spaceId: string, title?: string): Promise<ChatSession> {
    const now = new Date();
    const row = this.sessions.create({
      id: randomUUID(),
      userId,
      spaceId,
      title: title ?? '新会话',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: this.expiry(now).toISOString(),
      messages: [],
      scenarioDraft: null,
    });
    await this.sessions.save(row);
    return this.toDomain(row, []);
  }

  async get(id: string): Promise<ChatSession | null> {
    const row = await this.sessions.findOne({ where: { id }, relations: { messages: true } });
    if (!row) return null;
    if (Date.parse(row.expiresAt) <= Date.now()) {
      await this.sessions.delete({ id });
      return null;
    }
    return this.toDomain(row, row.messages ?? []);
  }

  async list(userId: string, spaceId?: string): Promise<ChatSession[]> {
    await this.purgeExpired();
    const rows = await this.sessions.find({
      where: spaceId ? { userId, spaceId } : { userId },
      relations: { messages: true },
      order: { updatedAt: 'DESC' },
    });
    return rows.map((row) => this.toDomain(row, row.messages ?? []));
  }

  async appendMessage(
    sessionId: string,
    input: AppendMessageInput,
  ): Promise<ChatMessage | null> {
    const session = await this.get(sessionId);
    if (!session) return null;

    const now = new Date();
    const row = this.messages.create({
      id: randomUUID(),
      sessionId,
      role: input.role,
      content: input.content,
      cards: input.cards ?? null,
      toolCalls: input.toolCalls ?? null,
      toolName: input.toolName ?? null,
      createdAt: now.toISOString(),
    });
    await this.messages.save(row);

    // 只更新标量列（不碰 messages 关系）：Partial<Entity> 会带上关系字段，与 update 的
    // _QueryDeepPartialEntity 不兼容。
    const patch: { updatedAt: string; expiresAt: string; title?: string } = {
      updatedAt: now.toISOString(),
      expiresAt: this.expiry(now).toISOString(),
    };
    if (session.title === '新会话' && input.role === 'user') {
      patch.title = input.content.replace(/\s+/g, ' ').slice(0, 40);
    }
    await this.sessions.update({ id: sessionId }, patch);

    return {
      id: row.id,
      sessionId,
      role: input.role,
      content: input.content,
      ...(input.cards ? { cards: input.cards } : {}),
      ...(input.toolCalls ? { toolCalls: input.toolCalls } : {}),
      ...(input.toolName ? { toolName: input.toolName } : {}),
      createdAt: row.createdAt,
    };
  }

  async setScenarioDraft(sessionId: string, draft: ScenarioDraft | null): Promise<boolean> {
    const row = await this.sessions.findOne({ where: { id: sessionId } });
    if (!row) return false;
    row.scenarioDraft = draft;
    row.updatedAt = new Date().toISOString();
    await this.sessions.save(row);
    return true;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await this.sessions.delete({ id, userId });
    return (result.affected ?? 0) > 0;
  }

  async purgeExpired(now: Date = new Date()): Promise<number> {
    const result = await this.sessions.delete({ expiresAt: LessThanOrEqual(now.toISOString()) });
    return result.affected ?? 0;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
      this.logger.log('chat-agent 会话库连接已关闭');
    }
  }

  private expiry(from: Date): Date {
    return new Date(from.getTime() + this.options.ttlHours * 3600_000);
  }

  private toDomain(row: ChatSessionEntity, messages: ChatMessageEntity[]): ChatSession {
    const ordered = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const trimmed =
      ordered.length > this.options.maxMessagesPerSession
        ? ordered.slice(ordered.length - this.options.maxMessagesPerSession)
        : ordered;
    return {
      id: row.id,
      userId: row.userId,
      spaceId: row.spaceId,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt,
      messages: trimmed.map((message) => ({
        id: message.id,
        sessionId: message.sessionId,
        role: message.role as ChatMessage['role'],
        content: message.content,
        ...(message.cards ? { cards: message.cards } : {}),
        ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
        ...(message.toolName ? { toolName: message.toolName } : {}),
        createdAt: message.createdAt,
      })),
      ...(row.scenarioDraft ? { scenarioDraft: row.scenarioDraft } : {}),
    };
  }
}
