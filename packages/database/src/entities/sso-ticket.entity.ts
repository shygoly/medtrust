import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

// 免登一次性票据（PDF §7）：能力中心拿到 loginUrl 后 302 给用户浏览器，
// 浏览器用 ticket 换本地会话；ticket 一次性、短时有效。
@Entity('sso_tickets')
export class SsoTicket {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index({ unique: true })
  @Column({ name: "ticket_hash", length: 64 })
  ticketHash: string;

  @Index()
  @Column({ name: "user_id", type: "integer" })
  userId: number;

  @Column({ name: "expires_at" })
  expiresAt: Date;

  @Column({ name: "used_at", nullable: true })
  usedAt: Date;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
