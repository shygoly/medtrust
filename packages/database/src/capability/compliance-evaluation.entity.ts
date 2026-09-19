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
  // 复评所用风险维度(事实优先) + 各维度来源(derived|declared) + 冲突 + 规则摘要(D-CMP-2/design D2、D9)
  @Column({ type: 'simple-json', nullable: true }) dimensions!: Record<string, unknown> | null;
  @Column({ type: 'simple-json', nullable: true }) dimensionSources!: Record<string, string> | null;
  @Column({ type: 'simple-json', default: '[]' }) dimensionConflicts!: string[];
  @Column({ type: 'varchar', nullable: true }) rulesDigest!: string | null;
  @CreateDateColumn() evaluatedAt!: Date;
}
