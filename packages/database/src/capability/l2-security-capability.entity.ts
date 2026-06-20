import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('l2_security_capability')
export class L2SecurityCapability {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) key!: string; // 'enhanced' | 'basic'
  @Column() name!: string;
  @Column({ type: 'simple-json', default: '[]' }) requiredProtocolKeys!: string[];
  @Column({ type: 'text', nullable: true }) description!: string;
  @CreateDateColumn() createdAt!: Date;
}
