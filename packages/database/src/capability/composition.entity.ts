import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// 一个任务的"跨层组合": 每层选 ≥1 系统对象 + 所选隐私参数 + 风险维度。
// L2 ComplianceEngine 据此做"已选 vs 要求"对比并裁决。
@Entity('composition')
export class Composition {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ nullable: true }) computeTaskId!: string; // 关联 compute_task(P2 接入)
  @Column() scenarioKey!: string; // → l1_scenario.key
  @Column({ type: 'simple-json', default: '[]' }) modelKeys!: string[];
  @Column({ type: 'simple-json', default: '[]' }) algorithmKeys!: string[];
  @Column({ type: 'simple-json', default: '[]' }) operatorKeys!: string[];
  @Column({ type: 'simple-json', default: '[]' }) protocolKeys!: string[];
  @Column({ type: 'simple-json', default: '[]' }) infraKeys!: string[];
  // 所选隐私参数(已选,用于"已选 vs 要求"对比)
  @Column({ type: 'simple-json', nullable: true })
  chosenParams!: { anonymizationKey?: string; kAnonymity?: number; epsilon?: number } | null;
  // 风险维度: dataSensitivity/participantCount/dataFlowChain/quasiIdentifierDensity
  //          /humanGeneticResources/crossBorder/approvedByNHCC
  @Column({ type: 'simple-json', nullable: true }) riskDimensions!: Record<string, unknown> | null;
  @CreateDateColumn() createdAt!: Date;
}
