import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum FlowerAuditAction {
  SUBMIT = 'submit',
  STATUS_UPDATE = 'status_update',
  COMPLETE = 'complete',
  CANCEL = 'cancel',
  ERROR = 'error',
}

@Entity('flower_audit_logs')
@Index(['action'])
@Index(['taskId'])
@Index(['userId'])
@Index(['createdAt'])
export class FlowerAuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'simple-enum',
    enum: FlowerAuditAction,
  })
  action: FlowerAuditAction;

  @Column({ name: 'task_id' })
  taskId: number;

  @Column({ name: 'user_id' })
  userId: number;

  @Column({ type: 'simple-json', nullable: true })
  details: Record<string, any>;

  @Column({ length: 45, nullable: true, name: 'ip_address' })
  ipAddress: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
