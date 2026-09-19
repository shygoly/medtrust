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
import type { OutputPolicy } from './output-policy';
import {
  KriDefinitionEntity,
  KriObservationEntity,
  QtlBreachEntity,
} from './rbqm';

export * from './rbqm';

// provider = 数据提供方(医院),consumer = 数据使用方(药企/研究院),
// operator = 平台运营方/监管方(卫健委,业务运营),
// compliance = 合规方,admin = 平台管理员(系统/密钥/开放平台,与 operator 职责分离)。
export type ParticipantRole = 'provider' | 'consumer' | 'operator' | 'compliance' | 'admin';

// 数字合约状态。
export type ContractStatus = 'draft' | 'active' | 'expired' | 'revoked';

// TEE 信任级别(D9/D-RWS-4):硬件远程证明(海光 CSV)落地前恒为 software,禁止虚标。
export type AttestationLevel = 'software' | 'hardware';

// 执行隔离标注(algorithm-sandbox / D-CN-2)。与 attestationLevel **正交**:
// 它描述"被执行的算法代码能力是否受限"(wasm-sandbox = 零能力导入 + 资源上限),
// 不表示进程隔离、更不表示硬件远程证明。缺省 none(内置实现,无隔离)。
export type ExecutionIsolation = 'none' | 'wasm-sandbox';
export const EXECUTION_ISOLATIONS: readonly ExecutionIsolation[] = ['none', 'wasm-sandbox'];
export function isExecutionIsolation(value: unknown): value is ExecutionIsolation {
  return typeof value === 'string' && (EXECUTION_ISOLATIONS as readonly string[]).includes(value);
}

/** 任务级执行隔离取"最弱":任何一家医院无隔离,任务级即为无隔离。 */
export function weakestExecutionIsolation(
  values: readonly (ExecutionIsolation | null | undefined)[],
): ExecutionIsolation | undefined {
  const known = values.filter((v): v is ExecutionIsolation => isExecutionIsolation(v));
  if (!known.length) return undefined;
  return known.includes('none') ? 'none' : 'wasm-sandbox';
}

// 数据产品类型(TC609-6-2025-16 P0-2):data=数据产品,service=数据服务。
// 服务目录复用发布/申请/合约全链路,仅在目录层按类型区分。
export type ProductType = 'data' | 'service';

// 计价条款(value-settlement 10.1/D12)。与连接器侧 Pricing 同形,跨语言/跨平面共享语义。
// 无计价条款 = 不结算(见 value-settlement spec「无认可不计费」)。
export type PricingModel = 'per-record' | 'per-task' | 'subscription';

export interface Pricing {
  model: PricingModel;
  amount: number; // per-record 单价 / per-task 固定费 / subscription 为 0
  currency: string; // 如 CNY,或积分单位
}

// 合规预审裁决快照(D-CMP-2)。跨库按值保存(预审在主库、合约在控制面),计入合约哈希 → 事后不可篡改。
// 结构与 apps/api engine.types.PreReviewSnapshot 对齐;此处 required/dimensions 用宽松 json 形状。
export interface ContractPreReview {
  compositionId: string;
  evaluationId: string;
  verdict: 'auto_approve' | 'manual_review' | 'block';
  overallRisk: 'low' | 'medium' | 'high';
  required: Record<string, unknown>;
  dimensions: Record<string, unknown>;
  dimensionSources: Record<string, string>;
  dimensionConflicts: string[];
  rulesDigest: string;
  evaluatedAt: string;
}
// 需审批(manual_review)时医院签发的显式确认(D-CMP-2)。
export interface ContractPreReviewAck {
  by: string; // 签发医院 participantId
  reason: string;
  at: string; // ISO
}

// 数字合约(digital contract) — 授权的标准载体(对齐 TC609-6-2025-15)。
// 这是控制面在内存/传输中使用的 DTO 形状;持久化形态是 DigitalContractEntity。
export interface DigitalContract {
  id: string;
  dataProductId: string;
  providerId: string;
  consumerId: string;
  purpose: string; // 目的限定
  retention: string; // 留存约束,如 阅后即焚
  output: string; // 输出约束展示标签,如 仅聚合统计
  /** Structured egress gate; authoritative for PEP / OutputGate. */
  outputPolicy?: OutputPolicy;
  validUntil: string; // ISO
  status: ContractStatus;
  pricing?: Pricing; // 计价条款;无则不结算(10.1)
  hash?: string; // SM3 哈希,上链存证
  consumerAcknowledgedAt?: string; // ISO;消费方规则知悉时间(TC609 P0-7)
  acknowledgedHash?: string; // SM3(canonical + consumerId),知悉证据
  attestationTxHash?: string; // 备案自动锚定回执(P1-2)
  attestationBlock?: number; // 备案自动锚定区块(P1-2)
  attestedAt?: string; // ISO;备案锚定时间(P1-2)
  revokeReason?: string; // 合约解除原因(P1-3)
  /** algorithm-sandbox「固定算法模块」条款:分析类型 → 模块 SM3(计入合约哈希)。 */
  pinnedModules?: Record<string, string>;
  /** 合规预审裁决快照(D-CMP-2);跨库按值保存,计入合约哈希。无 = 未预审(旧合约,不能建新任务)。 */
  preReview?: ContractPreReview | null;
  /** 需审批(manual_review)时医院签发的显式确认;计入合约哈希。 */
  preReviewAck?: ContractPreReviewAck | null;
}

// 数据产品目录项 — 只登记元数据,绝不汇聚原始数据(data-product spec)。
@Entity('cp_data_product')
export class DataProduct {
  @PrimaryColumn() id!: string;
  @Index({ unique: true }) @Column() urn!: string;
  @Column() homeSpace!: string;
  @Column() providerId!: string;
  @Column() title!: string;
  @Column({ type: 'varchar', default: 'data' }) productType!: ProductType;
  @Column({ nullable: true }) classification?: string;
  /** NDI-TR-2025-06 结构化分级标签(级别+类别编码+标签版本)。 */
  @Column({ type: 'simple-json', nullable: true }) classificationTag?: {
    level: string; // 1|2|3|4
    categoryCode: string;
    version?: string;
  } | null;
  @Column({ type: 'varchar', default: 'active' }) status!: 'active' | 'archived';
  @Column({ default: false }) rightsConfirmed!: boolean;
  @Column({ type: 'integer', default: 0 }) recordCount!: number;
  @Column({ type: 'simple-json', nullable: true }) fhirSchema!: Record<string, unknown> | null;
  @CreateDateColumn() createdAt!: Date;
  @Column({ type: 'datetime', nullable: true }) updatedAt?: Date | null;
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
  @Column({ type: 'simple-json', nullable: true }) outputPolicy?: OutputPolicy | null;
  @Column() validUntil!: string; // ISO string (matches DTO)
  @Column({ type: 'varchar', default: 'active' }) status!: ContractStatus;
  @Column({ type: 'simple-json', nullable: true }) pricing?: Pricing | null;
  @Column({ type: 'varchar', nullable: true }) hash?: string;
  @Column({ type: 'varchar', nullable: true }) consumerAcknowledgedAt?: string;
  @Column({ type: 'varchar', nullable: true }) acknowledgedHash?: string;
  @Column({ type: 'varchar', nullable: true }) attestationTxHash?: string;
  @Column({ type: 'integer', nullable: true }) attestationBlock?: number;
  @Column({ type: 'varchar', nullable: true }) attestedAt?: string;
  @Column({ type: 'varchar', nullable: true }) revokeReason?: string;
  @Column({ type: 'simple-json', nullable: true })
  pinnedModules?: Record<string, string> | null;
  // 合规预审裁决快照 + 需审批确认(D-CMP-2);两者均计入合约哈希(canonical)。
  @Column({ type: 'simple-json', nullable: true })
  preReview?: ContractPreReview | null;
  @Column({ type: 'simple-json', nullable: true })
  preReviewAck?: ContractPreReviewAck | null;
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

// 空间基础管理(space-management spec, TC609-6-2025-16 P0-1):可信数据空间本身。
// 服务平台最小功能之一;目录/合约通过 homeSpace/spaceId 引用真实空间 id。
@Entity('cp_space')
export class SpaceEntity {
  @PrimaryColumn() id!: string;
  @Column() name!: string;
  @Column({ nullable: true }) description?: string;
  @Column({ type: 'varchar', default: 'active' }) status!: 'active' | 'archived';
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
  @Column('text') subjectPublicKey!: string; // 连接器自有 SM2 公钥(P1-4 验签)
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
  @Column({ type: 'varchar', default: 'software' }) attestationLevel!: AttestationLevel;
  @Column() txHash!: string;
  @Column() inputFingerprint!: string;
  @Column() outputHash!: string;
  @Column({ type: 'bigint' }) block!: string;
  @CreateDateColumn() at!: Date;
}

// 连接器审计摘要(TC609 P0-6):连接器周期/事件触发把本地审计链摘要上报平台,
// 平台据此查验连接器日志完整性(链式 prevHash 连续 = chainOk)。
@Entity('cp_connector_audit_digest')
export class ConnectorAuditDigest {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column() participantId!: string;
  @Column({ type: 'integer', default: 0 }) count!: number;
  @Column({ type: 'varchar', nullable: true }) firstPrevHash!: string;
  @Column({ type: 'varchar', nullable: true }) lastEntryHash!: string;
  @Column({ type: 'varchar', default: 'ok' }) chainOk!: string; // ok | break
  @Column({ type: 'simple-json', default: '[]' }) blockedEvents!: Array<{
    action: string;
    actor: string;
    detail?: string;
    entryHash: string;
    prevHash: string;
    at: string;
  }>;
  @CreateDateColumn() receivedAt!: Date;
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
  /** P1-9:最近一次心跳载荷(版本/任务状态/资源水位)。 */
  @Column({ type: 'simple-json', nullable: true }) lastHeartbeat?: {
    connectorId?: string;
    version?: string;
    taskStatus?: Record<string, unknown>;
    resources?: Record<string, unknown>;
  } | null;
  @Column({ type: 'varchar', nullable: true }) wsSessionId?: string;
  @CreateDateColumn() registeredAt!: Date;
}

export type RwsOrchestrationStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed';
export type RwsAssignmentStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Federated RWS orchestration task (control-plane metadata only). */
@Entity('cp_rws_task')
export class RwsTaskEntity {
  @PrimaryColumn() taskId!: string;
  @Column() title!: string;
  @Column() purpose!: string;
  @Column({ type: 'simple-json' }) analysis!: Record<string, unknown>;
  @Column() consumerId!: string;
  @Column({ type: 'simple-json' }) contractIds!: string[];
  @Column({ type: 'varchar', default: 'pending' }) status!: RwsOrchestrationStatus;
  @Column({ type: 'varchar', default: 'software' }) attestationLevel!: AttestationLevel;
  @Column({ type: 'simple-json', nullable: true }) merged?: Record<string, unknown> | null;
  @Column({ type: 'datetime', nullable: true }) completedAt?: Date | null;
  // rws-study-protocol-spec (§1 方案先行). protocolVersion defaults to 1 on
  // existing rows via the column default (SQLite synchronize backfill).
  // frozenAt is wired now but only written in Phase 3; landing the column
  // early means Phase 3 is a behavior-only change.
  @Column({ type: 'integer', default: 1 }) protocolVersion!: number;
  @Column({ type: 'text', nullable: true }) revisionReason?: string | null;
  @Column({ type: 'datetime', nullable: true }) revisedAt?: Date | null;
  @Column({ type: 'datetime', nullable: true }) frozenAt?: Date | null;
  // rws-study-protocol-spec §1.6 / §4.1: admission-time warnings surfaced to
  // the report/UI. Carries things like "结局-暴露独立性未校验（自由文本）" and
  // "要素不完备：未声明 designType" while Phase 1 keeps fields optional.
  @Column({ type: 'simple-json', default: '[]' }) protocolWarnings!: string[];
  @CreateDateColumn() createdAt!: Date;
  @OneToMany(() => RwsAssignmentEntity, (a) => a.task, { cascade: true })
  assignments!: RwsAssignmentEntity[];
}

/** Per-provider connector dispatch for an RWS task. */
@Entity('cp_rws_assignment')
export class RwsAssignmentEntity {
  @PrimaryColumn() assignmentId!: string;
  @Index() @Column() taskId!: string;
  @Index() @Column() providerId!: string;
  @Column() purpose!: string;
  @Column({ type: 'simple-json' }) analysis!: Record<string, unknown>;
  @Column({ type: 'simple-json' }) contract!: Record<string, unknown>;
  @Column({ type: 'varchar', default: 'pending' }) status!: RwsAssignmentStatus;
  @Column({ type: 'simple-json', default: '[]' }) progress!: Record<string, unknown>[];
  @Column({ type: 'simple-json', nullable: true }) aggregate?: Record<string, unknown> | null;
  @Column({ type: 'text', nullable: true }) error?: string | null;
  @Column({ type: 'datetime', nullable: true }) startedAt?: Date | null;
  @Column({ type: 'datetime', nullable: true }) completedAt?: Date | null;
  // algorithm-sandbox:该院这次实际用的执行隔离与模块指纹(控制面按派发记录入库)。
  @Column({ type: 'varchar', default: 'none' })
  executionIsolation!: ExecutionIsolation;
  @Column({ type: 'varchar', nullable: true }) moduleSm3?: string | null;
  @ManyToOne(() => RwsTaskEntity, (t) => t.assignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'taskId' })
  task!: RwsTaskEntity;
}

export type FlOrchestrationStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed';
export type FlAssignmentStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Federated L4 prediction orchestration task (control-plane metadata only). */
@Entity('cp_fl_prediction_task')
export class FlPredictionTaskEntity {
  @PrimaryColumn() taskId!: string;
  @Column() title!: string;
  @Column() purpose!: string;
  @Column({ type: 'simple-json' }) flPredictionSpec!: Record<string, unknown>;
  @Column() consumerId!: string;
  @Column({ type: 'simple-json' }) contractIds!: string[];
  @Column({ type: 'integer', nullable: true }) computeTaskId?: number | null;
  @Column({ type: 'varchar', default: 'pending' }) status!: FlOrchestrationStatus;
  @Column({ type: 'varchar', default: 'software' }) attestationLevel!: AttestationLevel;
  @Column({ type: 'simple-json', nullable: true }) merged?: Record<string, unknown> | null;
  @Column({ type: 'simple-json', nullable: true }) resultSummary?: Record<string, unknown> | null;
  @Column({ type: 'datetime', nullable: true }) completedAt?: Date | null;
  @CreateDateColumn() createdAt!: Date;
  @OneToMany(() => FlPredictionAssignmentEntity, (a) => a.task, { cascade: true })
  assignments!: FlPredictionAssignmentEntity[];
}

/** Per-provider connector dispatch for an FL prediction task. */
@Entity('cp_fl_prediction_assignment')
export class FlPredictionAssignmentEntity {
  @PrimaryColumn() assignmentId!: string;
  @Index() @Column() taskId!: string;
  @Index() @Column() providerId!: string;
  @Column() purpose!: string;
  @Column({ type: 'simple-json' }) flPredictionSpec!: Record<string, unknown>;
  @Column({ type: 'simple-json' }) contract!: Record<string, unknown>;
  @Column({ type: 'varchar', default: 'pending' }) status!: FlAssignmentStatus;
  @Column({ type: 'simple-json', default: '[]' }) progress!: Record<string, unknown>[];
  @Column({ type: 'simple-json', nullable: true }) partyResult?: Record<string, unknown> | null;
  @Column({ type: 'text', nullable: true }) error?: string | null;
  @Column({ type: 'datetime', nullable: true }) startedAt?: Date | null;
  @Column({ type: 'datetime', nullable: true }) completedAt?: Date | null;
  @ManyToOne(() => FlPredictionTaskEntity, (t) => t.assignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'taskId' })
  task!: FlPredictionTaskEntity;
}

// 机构认证申请(P1-3):用户中心「账号与身份」三步流程的持久化形态。
// 与 User 以 userId 松散关联(跨库,无 FK)。申请/审核状态机:
// draft → submitted → approved / rejected;rejected 后可修改重提。
export type OrgCertificationStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected';

@Entity('cp_org_certification_application')
export class OrgCertificationApplication {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column()
  userId!: number;

  @Column({ type: 'varchar', default: 'draft' })
  status!: OrgCertificationStatus;

  // 步骤 1 机构基本信息
  @Column({ nullable: true }) orgType?: string;
  @Column({ type: 'simple-json', nullable: true }) licenseImages?: string[]; // 对象存储 key 列表
  @Column({ nullable: true }) orgName?: string;
  @Column({ nullable: true }) uscc?: string; // 统一社会信用代码(18 位)
  @Column({ nullable: true }) validPeriod?: 'long-term' | 'custom';
  @Column({ nullable: true }) validUntil?: string; // 自定义营业期限截止日(ISO date)
  @Column({ nullable: true }) region?: string;
  @Column({ nullable: true }) address?: string;
  @Column({ type: 'text', nullable: true }) businessScope?: string;
  @Column({ type: 'text', nullable: true }) orgIntro?: string;

  // 步骤 1 附加信息
  @Column({ nullable: true }) industry?: string;
  @Column({ type: 'numeric', nullable: true }) capitalWanYuan?: number | null; // 注册金额(万元)
  @Column({ nullable: true }) regDate?: string;
  @Column({ nullable: true }) logoKey?: string; // 机构 LOGO 对象存储 key

  // CA 身份凭证(用户本地生成 SM2 密钥对,平台只存公钥与证书指纹)
  @Column({ nullable: true }) caIdentityName?: string;
  @Column({ type: 'text', nullable: true }) caPublicKey?: string;
  @Column({ nullable: true }) caCertFingerprint?: string;

  // P2-2:机构信息带入来源(manual=手工上传 / silk-road=丝路数港主体带入)。
  @Column({ type: 'varchar', default: 'manual' }) source?: 'manual' | 'silk-road';
  @Column({ nullable: true }) interopSubjectId?: string;

  // 审核信息
  @Column({ type: 'integer', nullable: true }) reviewerId?: number | null;
  @Column({ type: 'text', nullable: true }) reviewNote?: string | null;
  @Column({ type: 'datetime', nullable: true }) reviewedAt?: Date | null;

  @CreateDateColumn() createdAt!: Date;
  @Column({ type: 'datetime', nullable: true }) updatedAt?: Date | null;
}

// P2-6:开放平台应用(如西安节点 XIAN_APP_KEY 的 DB 配置化形态)。
// 只存 appKey 的 SHA-256 哈希;密钥仅在创建时明文返回一次。
@Entity('cp_open_platform_app')
export class OpenPlatformApp {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index({ unique: true }) @Column() appId!: string;
  @Column() name!: string;
  @Column({ name: 'app_key_hash', length: 64 }) appKeyHash!: string;
  @Column({ type: 'simple-json', nullable: true }) scopes?: string[] | null;
  @Column({ type: 'varchar', default: 'active' }) status!: 'active' | 'revoked';
  @CreateDateColumn() createdAt!: Date;
  @Column({ type: 'datetime', nullable: true }) revokedAt?: Date | null;
}

// P2-2:丝路数港区域节点互认——从节点同步的「注册主体」缓存。
// 与 cp_participant 的映射:participantId 指向本空间参与方(若已建)。
@Entity('cp_interop_subject')
export class InteropSubject {
  @PrimaryColumn() subjectId!: string;
  @Index() @Column() nodeId!: string; // 如 silk-road
  @Column({ nullable: true }) orgName?: string;
  @Column({ nullable: true }) uscc?: string;
  @Column({ nullable: true }) region?: string;
  @Column({ nullable: true }) legalPerson?: string;
  @Column({ type: 'simple-json', nullable: true }) rawPayload?: Record<string, unknown> | null;
  @Column({ nullable: true }) participantId?: string; // 映射到 cp_participant.id
  @Column({ type: 'varchar', default: 'synced' }) status!: 'synced' | 'mapped' | 'ignored';
  @CreateDateColumn() importedAt!: Date;
  @Column({ type: 'datetime', nullable: true }) updatedAt?: Date | null;
}

export * from './output-policy';

export const controlPlaneEntities = [
  DataProduct,
  DigitalContractEntity,
  SettlementRecord,
  SettlementLine,
  FederationTrust,
  SpaceEntity,
  RemoteCatalogEntry,
  CaKeypair,
  ParticipantIdentity,
  Certificate,
  AttestationRef,
  CpConnectorRegistry,
  ConnectorAuditDigest,
  RwsTaskEntity,
  RwsAssignmentEntity,
  FlPredictionTaskEntity,
  FlPredictionAssignmentEntity,
  OrgCertificationApplication,
  InteropSubject,
  OpenPlatformApp,
  KriDefinitionEntity,
  KriObservationEntity,
  QtlBreachEntity,
];
