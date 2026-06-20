import { Entity, Column } from 'typeorm';
import { CapabilityObject } from './system-object.base';

@Entity('l6_protocol')
export class L6Protocol extends CapabilityObject {
  @Column() family!: string;
  @Column({ type: 'text' }) securityAssumption!: string;
  @Column({ type: 'varchar' }) securityCapabilityLevel!: 'basic' | 'enhanced';
  // 指向 privacy/* 或 security/crypto 的具体实现(P1+ 绑定);P0 仅持久化
  @Column({ nullable: true }) handlerKey!: string;
}
