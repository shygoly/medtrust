// 脱敏词表清单（openspec/changes/connector-agent-deidentification Phase 2）。
//
// **只存摘要与版本，不存词表内容。** 姓名表/术语表这类词表本身可能带院内特征
// （员工姓名、合作方名单），与盐同向：内容留在医院，平台签的是"这份摘要就是我审查过的第 N 版"。
// agent 按 `dictionaryRef` 读本院文件并核对摘要；对不上即 DENIED。
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('cp_deid_dictionary')
@Index(['dictionaryId', 'version'], { unique: true })
export class DeidDictionaryEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;

  /** 词表标识（`deid:cn-names`），与版本一起构成 `dictionaryRef`。 */
  @Index() @Column({ name: 'dictionary_id' }) dictionaryId!: string;

  @Column({ type: 'integer' }) version!: number;

  /** 词表文件的 SM3（64 hex 小写）——医院本地那份文件必须 hash 到它。 */
  @Column({ length: 64 }) sm3!: string;

  /** 字节数（上限 32 MB，防"词表"变成数据通道）。 */
  @Column({ name: 'byte_size', type: 'integer' }) byteSize!: number;

  /** SM2 签名（注册中心用途密钥，载荷 `medtrust.deid-dictionary.v1:<sm3>`）。 */
  @Column({ type: 'text' }) signature!: string;

  @Column({ name: 'key_id', length: 64 }) keyId!: string;

  @Column({ name: 'issued_at' }) issuedAt!: string;
  @Column({ name: 'not_after' }) notAfter!: string;

  /** active = 可用；revoked = 拒用（引用它的规格在连接器侧 fail-closed）。 */
  @Column({ type: 'varchar', default: 'active' }) status!: 'active' | 'revoked';

  @Column({ name: 'submitted_by' }) submittedBy!: string;
  @Column({ name: 'approved_by', type: 'varchar' }) approvedBy!: string;

  @Column({ name: 'revoked_by', type: 'varchar', nullable: true })
  revokedBy?: string | null;
  @Column({ name: 'revoke_reason', type: 'varchar', nullable: true })
  revokeReason?: string | null;
  @Column({ name: 'revoked_at', type: 'varchar', nullable: true })
  revokedAt?: string | null;

  @CreateDateColumn() createdAt!: Date;
}
