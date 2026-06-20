import { Entity, Column } from 'typeorm';
import { CapabilityObject } from './system-object.base';

@Entity('l1_scenario')
export class L1Scenario extends CapabilityObject {
  @Column({ type: 'text', nullable: true }) description!: string;
  @Column({ type: 'varchar' }) riskLevel!: 'low' | 'medium' | 'high';
  @Column({ type: 'text', nullable: true }) criteria!: string;
  @Column({ type: 'simple-json', default: '[]' }) typicalModelKeys!: string[];
  @Column({ type: 'simple-json', default: '[]' }) typicalAlgorithmKeys!: string[];
}
