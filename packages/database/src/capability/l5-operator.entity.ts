import { Entity, Column } from 'typeorm';
import { CapabilityObject } from './system-object.base';

@Entity('l5_operator')
export class L5Operator extends CapabilityObject {
  @Column() opType!: string;
  @Column({ type: 'simple-json', default: '[]' }) supportedProtocolKeys!: string[];
  @Column({ default: false }) complianceDriven!: boolean;
  @Column({ nullable: true }) triggeredBy!: string;
}
