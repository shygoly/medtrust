import { Entity, Column } from 'typeorm';
import { CapabilityObject } from './system-object.base';

@Entity('l7_infrastructure')
export class L7Infrastructure extends CapabilityObject {
  @Column() infraType!: string;
  @Column() vendor!: string;
  @Column({ type: 'text', nullable: true }) complianceNote!: string;
  @Column({ nullable: true }) handlerKey!: string;
}
