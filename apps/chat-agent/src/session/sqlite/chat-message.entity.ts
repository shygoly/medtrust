import type { CardMessage } from '@medtrust/chat-cards';
import type { ToolCall } from '@medtrust/pi-agent';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { ChatSessionEntity } from './chat-session.entity';

@Entity('chat_messages')
export class ChatMessageEntity {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  sessionId!: string;

  @ManyToOne(() => ChatSessionEntity, (session) => session.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: ChatSessionEntity;

  /** user | assistant | tool */
  @Column('text')
  role!: string;

  @Column('text')
  content!: string;

  /** 下发的卡片（已过结构校验）；无卡片为 null */
  @Column('simple-json', { nullable: true })
  cards!: CardMessage[] | null;

  @Column('simple-json', { nullable: true })
  toolCalls!: ToolCall[] | null;

  @Column('text', { nullable: true })
  toolName!: string | null;

  @Column('text')
  createdAt!: string;
}
