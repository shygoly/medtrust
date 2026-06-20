import { Entity, Column } from 'typeorm';
import { CapabilityObject } from './system-object.base';

@Entity('l3_model')
export class L3Model extends CapabilityObject {
  @Column() category!: string;
  @Column({ type: 'simple-json', default: '[]' }) trainingAlgorithmKeys!: string[];
  @Column({ type: 'text', nullable: true }) complianceNote!: string;
}
