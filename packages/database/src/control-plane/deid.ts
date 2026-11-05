// 脱敏规格（DeidSpec）的控制面版本表（openspec/changes/connector-agent-deidentification）。
//
// 只存**元数据与签名**：规格 JSON + 摘要 + SM2 签名 + 版本/吊销状态。
// 不含盐、不含密钥、不含任何行级数据 —— 盐归医院（agent 侧按 saltRef 取），
// 数据在院内变换（D-CN-6 / D-CN-7 同向）。
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** active = 可用于新任务；revoked = 拒用（已签发的任务也 fail-closed）。 */
export type DeidSpecStatus = 'active' | 'revoked';

export const DEID_SPEC_STATUSES: readonly DeidSpecStatus[] = ['active', 'revoked'];

@Entity('cp_deid_spec')
@Index(['specId', 'version'], { unique: true })
export class DeidSpecEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;

  /** 规格标识（`deid.ckd.v3` 这类），与版本一起构成单调序列。 */
  @Index() @Column({ name: 'spec_id' }) specId!: string;

  /** 同一 specId 下版本必须严格递增（防回放旧口径）。 */
  @Column({ type: 'integer' }) version!: number;

  /**
   * 规范化 JSON（键递归排序）——SM3 与 SM2 签名的**原像**。
   * 逐字节保存，读取不重排；连接器按同一规范化口径重算摘要。
   */
  @Column({ type: 'text' }) specJson!: string;

  /** `stableStringify(spec)` 的 SM3（64 hex 小写）。 */
  @Column({ name: 'spec_sm3', length: 64 }) specSm3!: string;

  /** SM2 签名（注册中心用途密钥，载荷 `medtrust.deid-spec.v1:<sm3>`）。 */
  @Column({ type: 'text' }) signature!: string;

  /** 签名公钥的 kid（公钥 SM3 全长），用于事后核验与换钥追溯。 */
  @Column({ name: 'key_id', length: 64 }) keyId!: string;

  @Column({ name: 'scope_product' }) scopeProduct!: string;
  @Column({ name: 'scope_level' }) scopeLevel!: string;

  /** ISO 时间戳（签发时写入，不依赖库时钟）。 */
  @Column({ name: 'issued_at' }) issuedAt!: string;

  /** 过期即拒用（连接器本地也会按时效拒绝，不靠平台在线）。 */
  @Column({ name: 'not_after' }) notAfter!: string;

  @Column({ type: 'varchar', default: 'active' }) status!: DeidSpecStatus;

  @Column({ name: 'issued_by' }) issuedBy!: string;

  @Column({ name: 'revoked_by', type: 'varchar', nullable: true })
  revokedBy?: string | null;

  @Column({ name: 'revoke_reason', type: 'varchar', nullable: true })
  revokeReason?: string | null;

  @Column({ name: 'revoked_at', type: 'varchar', nullable: true })
  revokedAt?: string | null;

  @CreateDateColumn() createdAt!: Date;
}
