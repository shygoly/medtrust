import type { CardMessage } from '@medtrust/chat-cards';
import type { ToolCall } from '@medtrust/pi-agent';
import type { ScenarioDraft } from '../agent/scenario-draft';

export type ChatRole = 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  /** assistant 消息里抽出的卡片（已过结构校验） */
  cards?: CardMessage[];
  toolCalls?: ToolCall[];
  toolName?: string;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  userId: string;
  spaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  messages: ChatMessage[];
  /** 结构化场景草稿独立于聊天窗口持久化。 */
  scenarioDraft?: ScenarioDraft;
}

export interface AppendMessageInput {
  role: ChatRole;
  content: string;
  cards?: CardMessage[];
  toolCalls?: ToolCall[];
  toolName?: string;
}

export const SESSION_REPOSITORY = 'SESSION_REPOSITORY';

export interface SessionRepository {
  /** 实际在用的存储实现，进 /health/ready（不谎报"数据库已连"） */
  readonly kind: 'memory' | 'sqlite';
  create(userId: string, spaceId: string, title?: string): Promise<ChatSession>;
  get(id: string): Promise<ChatSession | null>;
  list(userId: string, spaceId?: string): Promise<ChatSession[]>;
  appendMessage(sessionId: string, input: AppendMessageInput): Promise<ChatMessage | null>;
  setScenarioDraft(sessionId: string, draft: ScenarioDraft | null): Promise<boolean>;
  delete(id: string, userId: string): Promise<boolean>;
  purgeExpired(now?: Date): Promise<number>;
}
