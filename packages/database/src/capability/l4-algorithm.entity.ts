import { Entity, Column } from 'typeorm';
import { CapabilityObject } from './system-object.base';

@Entity('l4_algorithm')
export class L4Algorithm extends CapabilityObject {
  @Column() category!: string;
  @Column({ type: 'simple-json', default: '[]' }) underlyingOperatorKeys!: string[];
  @Column({ type: 'simple-json', default: '[]' }) compliancePrivacyModels!: string[];
}
