import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  AppendMessageInput,
  ChatMessage,
  ChatSession,
  SessionRepository,
} from './session.types';
import type { ScenarioDraft } from '../agent/scenario-draft';

export interface InMemorySessionOptions {
  ttlHours: number;
  maxMessagesPerSession: number;
}

export const DEFAULT_SESSION_OPTIONS: InMemorySessionOptions = {
  ttlHours: 24,
  maxMessagesPerSession: 200,
};

/**
 * 会话存储（内存实现）。
 *
 * 设计文档写的是 PostgreSQL + Redis；本实现把 `SessionRepository` 抽成接口，
 * 先用内存跑通链路（dev/test/E2E 无外部依赖）。换 TypeORM/Redis 实现时不动上层。
 */
@Injectable()
export class InMemorySessionRepository implements SessionRepository {
  readonly kind = 'memory' as const;
  private readonly sessions = new Map<string, ChatSession>();

  constructor(private readonly options: InMemorySessionOptions = DEFAULT_SESSION_OPTIONS) {}

  async create(userId: string, spaceId: string, title?: string): Promise<ChatSession> {
    const now = new Date();
    const session: ChatSession = {
      id: randomUUID(),
      userId,
      spaceId,
      title: title ?? '新会话',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: this.expiry(now).toISOString(),
      messages: [],
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async get(id: string): Promise<ChatSession | null> {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (this.isExpired(session)) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  async list(userId: string, spaceId?: string): Promise<ChatSession[]> {
    await this.purgeExpired();
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId)
      .filter((session) => (spaceId ? session.spaceId === spaceId : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async appendMessage(
    sessionId: string,
    input: AppendMessageInput,
  ): Promise<ChatMessage | null> {
    const session = await this.get(sessionId);
    if (!session) return null;
    const now = new Date();
    const message: ChatMessage = {
      id: randomUUID(),
      sessionId,
      role: input.role,
      content: input.content,
      cards: input.cards,
      toolCalls: input.toolCalls,
      toolName: input.toolName,
      createdAt: now.toISOString(),
    };
    session.messages.push(message);
    if (session.messages.length > this.options.maxMessagesPerSession) {
      session.messages.splice(0, session.messages.length - this.options.maxMessagesPerSession);
    }
    session.updatedAt = now.toISOString();
    session.expiresAt = this.expiry(now).toISOString();
    if (session.title === '新会话' && input.role === 'user') {
      session.title = input.content.replace(/\s+/g, ' ').slice(0, 40);
    }
    return message;
  }

  async setScenarioDraft(sessionId: string, draft: ScenarioDraft | null): Promise<boolean> {
    const session = await this.get(sessionId);
    if (!session) return false;
    if (draft) session.scenarioDraft = { ...draft, values: { ...draft.values } };
    else delete session.scenarioDraft;
    session.updatedAt = new Date().toISOString();
    return true;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId) return false;
    return this.sessions.delete(id);
  }

  async purgeExpired(now: Date = new Date()): Promise<number> {
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (this.isExpired(session, now)) {
        this.sessions.delete(id);
        removed++;
      }
    }
    return removed;
  }

  private isExpired(session: ChatSession, now: Date = new Date()): boolean {
    return Date.parse(session.expiresAt) <= now.getTime();
  }

  private expiry(from: Date): Date {
    return new Date(from.getTime() + this.options.ttlHours * 3600_000);
  }
}
