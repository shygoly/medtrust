import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('l2_anonymization_degree')
export class L2AnonymizationDegree {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) key!: string; // 'complete' | 'adequate'
  @Column() name!: string;
  @Column({ type: 'text' }) definition!: string;
  @Column({ type: 'simple-json', default: '[]' }) requiredTechniques!: string[];
  @Column({ type: 'float', nullable: true }) reIdentificationRiskUpper!: number;
  @Column({ type: 'simple-json', default: '[]' }) allowedScenarios!: string[];
  @CreateDateColumn() createdAt!: Date;
}
