import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// 图形验证码(P0-3):答案只存 SHA-256 哈希,一次性、短时有效。
// 用于账号密码登录防爆破;生产多实例部署时应改为共享存储(见整改计划 P0-3 备注)。
@Entity('auth_captchas')
export class AuthCaptcha {
  @PrimaryColumn({ length: 36 })
  id: string;

  @Column({ name: 'answer_hash', length: 64 })
  answerHash: string;

  @Column({ name: 'expires_at' })
  expiresAt: Date;

  @Column({ name: 'used_at', nullable: true })
  usedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
