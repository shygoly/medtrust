// Control-plane metadata entities. The control plane holds ONLY metadata
// (catalog / identity / contract / settlement / attestation index) — never raw
// medical data. See openspec/changes/federated-data-space-rws (D7) and
// openspec/changes/persist-federated-control-plane.
import {
  Entity,
  PrimaryGeneratedColumn,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';

// provider = 数据提供方(医院),consumer = 数据使用方(药企/研究院),
// operator = 平台运营方/监管方(卫健委,只读监督)。
export type ParticipantRole = 'provider' | 'consumer' | 'operator';

// 数字合约状态。
export type ContractStatus = 'draft' | 'active' | 'expired' | 'revoked';

// 数字合约(digital contract) — 授权的标准载体(对齐 TC609-6-2025-15)。
// 这是控制面在内存/传输中使用的 DTO 形状;持久化形态是 DigitalContractEntity。
export interface DigitalContract {
  id: string;
  dataProductId: string;
  providerId: string;
  consumerId: string;
  purpose: string; // 目的限定
  retention: string; // 留存约束,如 阅后即焚
  output: string; // 输出约束,如 仅聚合
  validUntil: string; // ISO
  status: ContractStatus;
  hash?: string; // SM3 哈希,上链存证
}

// 数据产品目录项 — 只登记元数据,绝不汇聚原始数据(data-product spec)。
@Entity('cp_data_product')
export class DataProduct {
  @PrimaryColumn() id!: string;
  @Index({ unique: true }) @Column() urn!: string;
  @Column() homeSpace!: string;
  @Column() providerId!: string;
  @Column() title!: string;
  @Column({ nullable: true }) classification?: string;
  @Column({ default: false }) rightsConfirmed!: boolean;
  @Column({ type: 'integer', default: 0 }) recordCount!: number;
  @Column({ type: 'simple-json', nullable: true }) fhirSchema!: Record<string, unknown> | null;
  @CreateDateColumn() createdAt!: Date;
}

// 数字合约的持久化形态(usage-control / digital-contract spec)。
@Entity('cp_digital_contract')
export class DigitalContractEntity {
  @PrimaryColumn() id!: string;
  @Index() @Column() dataProductId!: string;
  @Column() providerId!: string;
  @Column() consumerId!: string;
  @Column() purpose!: string;
  @Column() retention!: string;
  @Column() output!: string;
  @Column() validUntil!: string; // ISO string (matches DTO)
  @Column({ type: 'varchar', default: 'active' }) status!: ContractStatus;
  @Column({ type: 'varchar', nullable: true }) hash?: string;
  @CreateDateColumn() createdAt!: Date;
}

// 价值结算台账(value-settlement spec)。append-only:更正用新条目表达。
@Entity('cp_settlement_record')
export class SettlementRecord {
  @PrimaryColumn() id!: string;
  @Column() taskId!: string;
  @Column() taskRef!: string; // task attestation hash
  @Column() consumer!: string;
  @Column() consumerId!: string;
  @Column() currency!: string;
  @Column({ type: 'integer', default: 0 }) contributionTotal!: number;
  @Column({ type: 'real', default: 0 }) total!: number;
  @Column() hash!: string;
  @Column() at!: string;
  @OneToMany(() => SettlementLine, (l) => l.record, { cascade: true, eager: true })
  lines!: SettlementLine[];
  @CreateDateColumn() createdAt!: Date;
}

@Entity('cp_settlement_line')
export class SettlementLine {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() org!: string;
  @Column() participantId!: string;
  @Column({ type: 'integer', default: 0 }) contribution!: number;
  @Column({ type: 'real', default: 0 }) amount!: number;
  @ManyToOne(() => SettlementRecord, (r) => r.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recordId' })
  record!: SettlementRecord;
}

// 跨空间互联信任清单(space-interconnect spec):每个被信任空间的 CA 公钥。
@Entity('cp_federation_trust')
export class FederationTrust {
  @PrimaryColumn() spaceId!: string;
  @Column('text') caPublicKey!: string;
  @CreateDateColumn() createdAt!: Date;
}

// 远端空间数据产品元数据缓存(只读;原始数据绝不进入)。
@Entity('cp_remote_catalog')
export class RemoteCatalogEntry {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column() spaceId!: string;
  @Column() productId!: string;
  @Column() urn!: string;
  @Column() homeSpace!: string;
  @Column() providerId!: string;
  @Column() title!: string;
  @Column({ nullable: true }) classification?: string;
  @Column({ default: false }) rightsConfirmed!: boolean;
  @Column({ type: 'integer', default: 0 }) recordCount!: number;
}

// 中心 CA 的 SM2 根密钥对(按 spaceId 持久化)。开机加载而非每次重生,
// 否则重启会让此前签发的所有证书失效。
@Entity('cp_ca_keypair')
export class CaKeypair {
  @PrimaryColumn() spaceId!: string;
  @Column('text') publicKey!: string;
  @Column('text') privateKey!: string;
  @CreateDateColumn() createdAt!: Date;
}

// 参与方注册表 + 主体/数据双认证状态(participant-identity spec)。
@Entity('cp_participant')
export class ParticipantIdentity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index({ unique: true }) @Column() org!: string;
  @Column({ type: 'varchar', nullable: true }) role?: ParticipantRole;
  @Column({ nullable: true }) region?: string;
  @Column({ default: false }) subjectVerified!: boolean; // 主体认证
  @Column({ default: false }) dataVerified!: boolean; // 数据资源认证
  @CreateDateColumn() createdAt!: Date;
}

// 已签发证书注册表。撤销 = 置 revoked(无单独 CRL 实体)。
@Entity('cp_certificate')
export class Certificate {
  @PrimaryColumn() sm2Fingerprint!: string; // "SM2:<hex>"
  @Index() @Column() participantId!: string;
  @Column() connectorId!: string;
  @Column() spaceId!: string;
  @Column({ type: 'datetime' }) validUntil!: Date;
  @Column({ default: false }) revoked!: boolean;
  @CreateDateColumn() issuedAt!: Date;
}

// 链上存证指针。链上只存哈希(D6)。
@Entity('cp_attestation_ref')
export class AttestationRef {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() taskId!: string;
  @Column({ type: 'varchar' }) kind!: 'policy' | 'task' | 'output';
  @Column() txHash!: string;
  @Column() inputFingerprint!: string;
  @Column() outputHash!: string;
  @Column({ type: 'bigint' }) block!: string;
  @CreateDateColumn() at!: Date;
}

// 连接器注册表(connector-registry spec) — 记录各参与方的连接器
// 身份、能力、健康状态和 WebSocket 会话映射。
@Entity('cp_connector_registry')
export class CpConnectorRegistry {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column() participantId!: string;
  @Column({ type: 'varchar', nullable: true }) certificateHash?: string;
  @Column({ type: 'simple-json', nullable: true }) capabilities?: string[];
  @Column({ type: 'varchar', default: 'unknown' }) healthStatus!: string;
  @Column({ type: 'datetime', nullable: true }) lastSeen?: Date;
  @Column({ type: 'varchar', nullable: true }) wsSessionId?: string;
  @CreateDateColumn() registeredAt!: Date;
}

export const controlPlaneEntities = [
  DataProduct,
  DigitalContractEntity,
  SettlementRecord,
  SettlementLine,
  FederationTrust,
  RemoteCatalogEntry,
  CaKeypair,
  ParticipantIdentity,
  Certificate,
  AttestationRef,
  CpConnectorRegistry,
];
