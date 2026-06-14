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
  participantRole: 'provider' | 'consumer' | 'operator';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ nullable: true, name: 'last_login_at' })
  lastLoginAt: Date;

  @Column({ nullable: true, name: 'deleted_at' })
  deletedAt: Date;

  // 关联关系
  @OneToMany(() => AuditLog, (log) => log.user)
  auditLogs: AuditLog[];
}
