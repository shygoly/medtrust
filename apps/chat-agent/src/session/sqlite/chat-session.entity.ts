import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { ChatMessageEntity } from './chat-message.entity';
import type { ScenarioDraft } from '../../agent/scenario-draft';

/**
 * 会话表（apps/chat-agent 自己的库；不进 packages/database 的控制面实体集，
 * 因此不参与 DOMAIN.md 的 @Entity 覆盖矩阵对拍）。
 */
@Entity('chat_sessions')
export class ChatSessionEntity {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  userId!: string;

  @Column('text')
  spaceId!: string;

  @Column('text')
  title!: string;

  @Column('text')
  createdAt!: string;

  @Column('text')
  updatedAt!: string;

  /** ISO 时间串：字符串序 = 时间序，便于用 SQL 直接比较与清理 */
  @Column('text')
  expiresAt!: string;

  @Column({ type: 'simple-json', nullable: true })
  scenarioDraft?: ScenarioDraft | null;

  @OneToMany(() => ChatMessageEntity, (message) => message.session, { cascade: true })
  messages!: ChatMessageEntity[];
}
