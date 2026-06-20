import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('l2_guardrail')
export class L2Guardrail {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) key!: string; // 'k-anonymity' / 'epsilon-dp' ...
  @Column() name!: string;
  @Column({ type: 'varchar' }) kind!: 'privacy_model' | 'crypto_model';
  @Column({ type: 'text', nullable: true }) description!: string;
  // 异构阈值: k-anon {medical_general,high_risk} / l-div、t-close 标量 /
  //          ε-DP {epsilon_range, medical_guidelines, privacy_budget_tracking}
  @Column({ type: 'simple-json', nullable: true }) thresholds!: Record<string, unknown> | null;
  @Column({ type: 'simple-json', default: '[]' }) requiredOperatorKeys!: string[];
  @Column({ type: 'simple-json', default: '[]' }) requiredAlgorithmKeys!: string[];
  @Column({ type: 'simple-json', default: '[]' }) applicableScenarios!: string[];
  @Column({ nullable: true }) basedOn!: string;
  @CreateDateColumn() createdAt!: Date;
}
