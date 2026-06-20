import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// L2 引擎对一个 composition 的裁决结果(结构 = spec §6 两段 YAML)。
@Entity('compliance_evaluation')
export class ComplianceEvaluation {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() compositionId!: string;
  @Column({ type: 'varchar' }) overallRisk!: 'low' | 'medium' | 'high';
  // required: { anonymization, kAnonymity, lDiversity?, epsilon?, securityCapability, approvalRequired }
  @Column({ type: 'simple-json' }) required!: Record<string, unknown>;
  @Column({ type: 'varchar' }) autoVerdict!: 'auto_approve' | 'manual_review' | 'block';
  @Column({ type: 'simple-json', default: '[]' }) blockingRulesMatched!: string[];
  @Column({ type: 'simple-json', default: '[]' }) warnings!: string[];
  @Column({ type: 'simple-json', default: '[]' }) structuralIssues!: string[];
  @CreateDateColumn() evaluatedAt!: Date;
}
