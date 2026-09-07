import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

// 邮箱/短信验证码(P0-6 忘记密码 + P1-2 手机快捷登录):
// 答案只存 SHA-256 哈希,一次性、短时有效;错误尝试次数上限后作废。
@Entity('verification_codes')
export class VerificationCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ length: 255 })
  target: string;

  @Column({ length: 32 })
  purpose: string;

  @Column({ name: 'code_hash', length: 64 })
  codeHash: string;

  @Column({ name: 'expires_at' })
  expiresAt: Date;

  @Column({ name: 'used_at', nullable: true })
  usedAt: Date;

  @Column({ default: 0 })
  attempts: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
