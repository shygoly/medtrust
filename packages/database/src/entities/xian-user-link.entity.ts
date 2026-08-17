import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

// 西安节点能力中心用户 → MedTrust 本地用户 绑定表（PDF §6 用户同步）。
// 能力中心 userId 是字符串且租户内唯一；(tenantId, userId) 作为天然幂等键。
@Entity('xian_user_links')
@Index(["tenantId", "userId"], { unique: true })
export class XianUserLink {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "tenant_id", length: 64 })
  tenantId: string;

  @Column({ name: "user_id", length: 128 })
  userId: string;

  @Index()
  @Column({ name: "local_user_id", type: "integer" })
  localUserId: number;

  // 企业认证信息只保留公开工商字段；法人证件号不落库（PDF V1.2 为可选项）。
  @Column({ name: "enterprise_name", type: "varchar", length: 255, nullable: true })
  enterpriseName: string;

  @Column({
    name: "unified_social_credit_code",
    type: "varchar",
    length: 64,
    nullable: true,
  })
  unifiedSocialCreditCode: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
