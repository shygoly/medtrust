import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('l2_block_rule')
export class L2BlockRule {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) key!: string; // 'block-high-partial' ...
  // P0 忠实持久化原始条件串;结构化解析是 P1 引擎职责
  @Column({ type: 'text' }) condition!: string;
  @Column({ default: true }) block!: boolean;
  @Column({ type: 'text' }) reason!: string;
  @CreateDateColumn() createdAt!: Date;
}
