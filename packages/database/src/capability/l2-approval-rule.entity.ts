import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('l2_approval_rule')
export class L2ApprovalRule {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', unique: true })
  conditionGroup!: 'auto_block' | 'auto_approve' | 'manual';
  @Column({ type: 'simple-json', default: '[]' }) conditions!: string[];
  @CreateDateColumn() createdAt!: Date;
}
