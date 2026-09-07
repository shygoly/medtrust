import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { AuditLog } from './audit-log.entity';

@Entity('users')
@Index(['email'], { unique: true })
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100, nullable: true })
  name: string;

  @Column({ length: 255, unique: true })
  email: string;

  // P1-2 手机快捷登录:中国大陆手机号,可空、唯一。正式运营接入短信服务后
  // 按 TRUST.md 控制点做加密存储与全链路脱敏(P2-7,未应用脱敏装饰器前不落敏感数据)。
  @Column({ length: 20, nullable: true, unique: true })
  phone: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ length: 255, nullable: true })
  avatar: string;

  @Column({ default: false, name: 'email_verified' })
  emailVerified: boolean;

  @Column({ length: 255, nullable: true, name: 'mfa_secret' })
  mfaSecret: string;

  @Column({ default: false, name: 'mfa_enabled' })
  mfaEnabled: boolean;

  // Federated authorization: which participant (org) the user belongs to and
  // its role in the data space. Coarse route-level authz derives from this;
  // fine-grained "who may use which data" stays in digital contracts (PEP).
  @Column({ nullable: true, name: 'participant_id' })
  participantId: string;

  @Column({ length: 20, nullable: true, name: 'participant_role' })
  participantRole: 'provider' | 'consumer' | 'operator' | 'compliance' | 'admin';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ nullable: true, name: 'last_login_at' })
  lastLoginAt: Date;

  @Column({ nullable: true, name: 'deleted_at' })
  deletedAt: Date;

  // P0-2 账号生命周期:active(正常) / disabled(运营禁用) / pending(注册未分配角色)。
  // 登录/刷新/SSO 兑换统一校验;JwtStrategy 查询库兜底禁用立即生效(60s 缓存)。
  @Column({ length: 20, default: 'active', name: 'status' })
  status: 'active' | 'disabled' | 'pending';

  // P0-4 登录防爆破:同账号连续失败计数与锁定截止时间。
  @Column({ default: 0, name: 'failed_login_count' })
  failedLoginCount: number;

  @Column({ nullable: true, name: 'locked_until' })
  lockedUntil: Date;

  @Column({ nullable: true, name: 'last_password_changed_at' })
  lastPasswordChangedAt: Date;

  // 关联关系
  @OneToMany(() => AuditLog, (log) => log.user)
  auditLogs: AuditLog[];
}
