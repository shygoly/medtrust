import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('l2_risk_policy')
export class L2RiskPolicy {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) key!: string; // 'risk-high' | 'risk-medium' | 'risk-low'
  @Column({ type: 'varchar' }) riskLevel!: 'low' | 'medium' | 'high';
  @Column({ type: 'text' }) criteria!: string;
  @Column() requiredAnonymizationKey!: string;     // → l2_anonymization_degree.key
  @Column() requiredSecurityCapabilityKey!: string; // → l2_security_capability.key
  @Column({ type: 'simple-json', default: '[]' }) requiredAlgorithmKeys!: string[];
  @Column({ default: false }) approvalRequired!: boolean;
  @CreateDateColumn() createdAt!: Date;
}
