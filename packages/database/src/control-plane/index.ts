// Control-plane metadata entities. The control plane holds ONLY metadata
// (catalog / identity / contract / attestation index) — never raw medical data.
// See openspec/changes/federated-data-space-rws (D7).
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// provider = 数据提供方(医院),consumer = 数据使用方(药企/研究院),
// operator = 平台运营方/监管方(卫健委,只读监督)。
export type ParticipantRole = 'provider' | 'consumer' | 'operator';

// 数字合约(digital contract) — 授权的标准载体(对齐 TC609-6-2025-15)。
// 这是 usage-control 强制执行的对象;cp_usage_policy 实体是其持久化形态,
// 本接口是控制面在内存/传输中使用的形状。
export type ContractStatus = 'draft' | 'active' | 'expired' | 'revoked';

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

@Entity('cp_participant')
export class Participant {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() org!: string;
  @Column({ type: 'varchar' }) role!: ParticipantRole;
  @Column() region!: string;
  // 主体认证 + 数据资源认证(双认证)状态 — see participant-identity spec
  @Column({ default: false }) subjectVerified!: boolean;
  @Column({ default: false }) dataVerified!: boolean;
  @CreateDateColumn() createdAt!: Date;
}

@Entity('cp_certificate')
export class Certificate {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() participantId!: string;
  @Column() connectorId!: string;
  // SM2 cert fingerprint issued by the central CA (NDI-TR-2025-03)
  @Column() sm2Fingerprint!: string;
  @Column({ type: 'datetime' }) validUntil!: Date;
  @Column({ default: false }) revoked!: boolean;
  @CreateDateColumn() issuedAt!: Date;
}

@Entity('cp_dataset_metadata')
export class DatasetMetadata {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() providerId!: string; // owning connector's participant
  @Column() title!: string;
  @Column({ type: 'simple-json', nullable: true }) fhirSchema!: Record<string, unknown> | null;
  // 分级分类 + 确权 (participant-identity spec)
  @Column({ nullable: true }) classification!: string; // e.g. 敏感/重要
  @Column({ default: false }) rightsConfirmed!: boolean;
  @Column({ default: 0 }) recordCount!: number;
  @CreateDateColumn() createdAt!: Date;
}

// Authorization artifact. NOTE: in change B this splits into DigitalContract +
// UsageControlPolicy to match TC609-6-2025-15. For now it carries both concerns.
@Entity('cp_usage_policy')
export class UsagePolicy {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() datasetId!: string;
  @Column() consumerId!: string;
  @Column() purpose!: string; // 目的限定
  @Column() retention!: string; // 留存约束 e.g. 阅后即焚
  @Column() output!: string; // 输出约束 e.g. 仅聚合
  @Column({ type: 'datetime' }) validUntil!: Date;
  @Column({ nullable: true }) hash!: string; // SM3 hash that goes on-chain
  @CreateDateColumn() createdAt!: Date;
}

// Pointer to an on-chain attestation. The chain holds hashes only (D6).
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

export const controlPlaneEntities = [
  Participant,
  Certificate,
  DatasetMetadata,
  UsagePolicy,
  AttestationRef,
];
