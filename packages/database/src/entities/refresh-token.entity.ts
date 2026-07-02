import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// Refresh-token state (auth-session-hardening). Stores a HASH of the token, not
// the token itself; rotation revokes the presented token and issues a new one.
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'token_hash' })
  tokenHash: string;

  @Index()
  @Column({ name: 'user_id', type: 'integer' })
  userId: number;

  // No explicit type: TypeORM infers from `Date` → `datetime` on sqlite,
  // `timestamp` on postgres (sqlite-only `datetime` breaks PG metadata build).
  @Column({ name: 'expires_at' })
  expiresAt: Date;

  @Column({ default: false })
  revoked: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
