import { PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { TAXONOMY_VERSION } from './layer-kind';

// 能力层(L1、L3-L7)共享的系统对象公共列。L2 规则表不继承此基类(规则非能力)。
export abstract class CapabilityObject {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // 层内唯一稳定标识(slug),如 'meditron-7b'、'tee-sgx'。跨层引用用它。
  @Column({ unique: true })
  key!: string;

  @Column()
  name!: string;

  @Column({ default: TAXONOMY_VERSION })
  version!: string;

  @Column({ type: 'varchar', default: 'active' })
  status!: 'active' | 'deprecated' | 'draft';

  @Column({ type: 'simple-json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ nullable: true })
  basedOn!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
