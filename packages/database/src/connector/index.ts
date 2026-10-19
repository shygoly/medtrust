// Connector-local entities. These live ONLY on the participant's local
// connector store (hospital intranet / pharma side). Raw, de-identified rows
// never leave this store. See openspec/changes/federated-data-space-rws.
import { Entity, PrimaryGeneratedColumn, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

// De-identified local record. Direct identifiers are stripped on ingestion
// (data-space-connector spec: 计算前本地脱敏). The raw source row is never persisted here.
@Entity('local_record')
export class LocalRecord {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column() datasetId!: string;
  // pseudonymous subject key (hashed), never the real patient id
  @Column() subjectKey!: string;
  @Column({ nullable: true }) ageBand!: string; // birthDate -> coarse band
  @Column({ nullable: true }) sex!: string;
  @Column({ type: 'simple-json' }) clinical!: Record<string, unknown>; // de-identified clinical fields
  @CreateDateColumn() ingestedAt!: Date;
}

// Local audit log. Every access — especially blocked raw-read attempts — is recorded.
// entryHash/prevHash 形成 SM3 链式哈希(P0-6),摘要上报平台后可查完整性。
@Entity('local_audit_log')
export class LocalAuditLog {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() action!: string; // e.g. ingest, compute, raw-read-blocked
  @Column() actor!: string; // internal | external:<id>
  @Column({ nullable: true }) taskId!: string;
  @Column({ default: true }) allowed!: boolean;
  @Column({ nullable: true }) detail!: string;
  @Column({ type: 'varchar', nullable: true }) entryHash!: string; // SM3 链式条目哈希
  @Column({ type: 'varchar', nullable: true }) prevHash!: string; // 前一条 entryHash
  @CreateDateColumn() at!: Date;
}

// Gold-standard annotation for algorithm validation (rws-algorithm-validation D1).
// One row = "for subject `subjectKey`, the variable definition
// `variableDefinitionId` was judged `judgment` by `source`." Lives ONLY on the
// connector-local plane (same rule as local_record: never crosses the boundary).
// The out-of-domain payload of an L0 task is just the 2×2 confusion matrix
// counts — individual annotations stay here.
export type GoldStandardJudgment = 'positive' | 'negative';
// `synthetic` = Synthea / unit-fixture generated labels (§7.3 provenance).
// Synthetic results MUST NOT be used for regulatory submission; provenance
// is carried through to the cross-domain payload + UI/report layer.
export type GoldStandardSource = 'registry' | 'specialty_db' | 'study_review' | 'synthetic';

@Entity('local_gold_standard')
export class LocalGoldStandard {
  @PrimaryGeneratedColumn('uuid') id!: string;
  // pseudonymous subject key — same key space as local_record.subjectKey
  @Index() @Column() subjectKey!: string;
  // which variable definition this judgment is about (algorithm-validation D1:
  // gold standard is a property of a variable definition, not of a record)
  @Index() @Column() variableDefinitionId!: string;
  @Column({ type: 'varchar' }) judgment!: GoldStandardJudgment;
  @Column({ type: 'varchar' }) source!: GoldStandardSource;
  // diagnostic criteria the reviewer relied on (§2.6 requires reporting this)
  @Column({ type: 'text', nullable: true }) criteriaText!: string;
  // version tag for the annotation set — algorithm results bind to this triple
  @Column({ type: 'varchar' }) goldStandardSetVersion!: string;
  @CreateDateColumn() labeledAt!: Date;
}

// omop-data-source-access —— CDM 数据源的**接入校验结果**（task 3.4）。
// 只存状态，**永不存凭据**：数据源配置是部署期的（CONNECTOR_CDM_SOURCES），口令只以
// 环境变量名引用。本表回答的是「这个数据源现在能不能用、为什么不能用、上次读到的
// CDM / 词汇表版本是什么」——后两者是 concept_id 语义的依据，必须留痕。
@Entity('local_data_source_status')
export class LocalDataSourceStatus {
  @PrimaryColumn() label!: string;
  @Column({ default: false }) passed!: boolean;
  @Column({ type: 'varchar', nullable: true }) cdmVersion!: string | null;
  @Column({ type: 'varchar', nullable: true }) vocabularyVersion!: string | null;
  // 逐项检查结果（id / 权限域 / 是否通过 / 说明），说明里只有 schema 与关系名。
  @Column({ type: 'simple-json' }) checks!: Array<{
    id: string;
    domain: string;
    passed: boolean;
    detail: string;
  }>;
  @Column() checkedAt!: Date;
}

/**
 * 本地 MDOP 合约副本（D-MDOP-4 / 规格「本地合约库」）。
 *
 * **复核只认这份本地副本**：片段要约随附的合约内容一律不采信。保存的是规范化合约全文
 * （JCS 形态的 JSON 字符串）与双方签名，改动任一字段签名即失效。
 */
export type LocalContractStatus = 'pending' | 'active' | 'rejected' | 'revoked';

@Entity('local_mdop_contract')
export class LocalMdopContract {
  /** 控制面的合约 id（`cp_digital_contract.id`）。 */
  @PrimaryColumn() contractId!: string;
  /** 规范化合约全文（JCS 形态 JSON 字符串）——被签的就是这一串。 */
  @Column({ type: 'text' }) canonical!: string;
  /** 本院（提供方连接器）签名，国标 SM2 DER hex。 */
  @Column({ type: 'text' }) holderSignature!: string;
  /** 平台节点密钥副署。 */
  @Column({ type: 'text' }) platformCountersignature!: string;
  @Index() @Column({ type: 'varchar', default: 'pending' })
  status!: LocalContractStatus;
  /** 复核方式（auto = 本地策略允许的自动确认；manual = 院内人员确认）。 */
  @Column({ type: 'varchar' }) reviewMode!: 'auto' | 'manual';
  /** 自动确认时的策略依据（`review=auto(policy)` 的如实标注）。 */
  @Column({ type: 'varchar', nullable: true }) reviewPolicy?: string | null;
  /** 复核时限（小时）——超时视同拒绝。 */
  @Column({ type: 'integer', default: 72 }) reviewDeadlineHours!: number;
  /** 合约用途编码（复核时与作业 purpose 比对）。 */
  @Column() purposeCode!: string;
  /** 接收方列表（C3 出口的目标必须在其中）。 */
  @Column({ type: 'simple-json' }) recipients!: string[];
  /** 发布条件（降密算子参数不得弱于它）。 */
  @Column({ type: 'simple-json', nullable: true })
  publication?: { minCell?: number } | null;
  /** 允许的算子摘要（本地白名单之外的第二道合约约束）。 */
  @Column({ type: 'simple-json' }) allowedOpDigests!: string[];
  @Column({ type: 'varchar' }) validFrom!: string;
  @Column({ type: 'varchar' }) validUntil!: string;
  @Column({ type: 'varchar', nullable: true }) revokedAt?: string | null;
  @Column({ type: 'varchar', nullable: true }) revokeReason?: string | null;
  /** 撤销是否已通知平台（本地撤销立即生效，通知只是让平台同步）。 */
  @Column({ default: false }) terminationSent!: boolean;
  @CreateDateColumn() receivedAt!: Date;
  @Column() updatedAt!: Date;
}

/**
 * 待院内人员确认的合约要约队列（D-MDOP-4 第 3 步）。
 * 缺省需要人工确认；只有本地策略文件显式允许的要约才自动确认。
 */
@Entity('local_mdop_contract_pending')
export class LocalMdopContractPending {
  @PrimaryColumn() offerId!: string;
  @Index() @Column() contractId!: string;
  /** 要约里的规范化合约全文（确认后原样落到 local_mdop_contract）。 */
  @Column({ type: 'text' }) canonical!: string;
  @Index() @Column({ type: 'varchar', default: 'pending' })
  status!: 'pending' | 'confirmed' | 'rejected' | 'expired';
  @Column({ type: 'varchar' }) expiresAt!: string;
  @Column({ type: 'varchar', nullable: true }) decidedBy?: string | null;
  @Column({ type: 'varchar', nullable: true }) decidedAt?: string | null;
  @Column({ type: 'varchar', nullable: true }) rejectReason?: string | null;
  @CreateDateColumn() receivedAt!: Date;
}

/**
 * 本地算子白名单（D-MDOP-5 / 规格「连接器本地白名单」）。
 *
 * **缺省为空（fail-closed）**：复核与执行都要求摘要在名单里。只能由医院在本地
 * （CLI / 院内端点）按摘要加入或移除 —— 平台 MUST NOT 有远程修改白名单的途径，
 * 所以代码里也没有任何从消息处理到本表的写入路径。
 */
@Entity('local_mdop_operator_whitelist')
export class LocalMdopOperatorWhitelist {
  /** wasm 摘要（SM3）或 system 算子的 `id@version`。 */
  @PrimaryColumn() digest!: string;
  /** `wasm` 摘要 / `system` 标识，便于列表时区分。 */
  @Column({ type: 'varchar', default: 'wasm' }) kind!: 'wasm' | 'system';
  @Column({ type: 'varchar' }) addedBy!: string;
  @Column({ type: 'varchar', nullable: true }) note?: string | null;
  @CreateDateColumn() addedAt!: Date;
}

/**
 * 已落盘的**吊销名单状态**（闸 5 / 任务 6.4）。只接受版本更高的名单；
 * 启动后本地没有有效名单之前，连接器拒绝执行任何 wasm 算子。
 */
@Entity('local_mdop_revocation_state')
export class LocalMdopRevocationState {
  /** 单行表：固定主键，便于「只接受更高版本」的比较。 */
  @PrimaryColumn({ default: 'current' }) id!: string;
  @Column({ type: 'integer' }) version!: number;
  @Column({ type: 'simple-json' }) revokedDigests!: string[];
  @Column({ type: 'varchar' }) issuedAt!: string;
  @Column({ type: 'varchar' }) receivedAt!: string;
}

/**
 * 已处理的幂等键（任务 8.1/8.4）。`StageDispatch` 带 `job:stage:attempt`；
 * 重复键 MUST 返回原结果而不重算（至少一次投递的前提）。
 */
@Entity('local_mdop_processed_key')
export class LocalMdopProcessedKey {
  @PrimaryColumn() key!: string;
  @Column() jobId!: string;
  @Column() stageId!: string;
  @Column({ type: 'integer' }) attempt!: number;
  /** 首次处理的结果（原样回放，不重算）。 */
  @Column({ type: 'simple-json' }) result!: Record<string, unknown>;
  @CreateDateColumn() at!: Date;
}

/** 本地 nonce（防重放；10 分钟内不得重复，重启后仍有效）。 */
@Entity('local_mdop_nonce')
export class LocalMdopNonce {
  @PrimaryColumn() nonce!: string;
  @Index() @Column() sender!: string;
  @Column() expiresAt!: Date;
  @CreateDateColumn() seenAt!: Date;
}

/**
 * 本地制品库（任务 8.5）。**制品载荷只在本表**，句柄登记到平台。
 * 到期自主销毁（TTL 缺省 72 小时）；销毁后按句柄读取必须失败。
 */
@Entity('local_mdop_artifact')
export class LocalMdopArtifact {
  @PrimaryColumn() handle!: string;
  @Index() @Column() jobId!: string;
  @Column() stage!: string;
  /** 流动等级 C0–C3；只有 C3 句柄可带 stats。 */
  @Column() label!: string;
  @Column() schema!: string;
  @Column() digest!: string;
  /** 载荷（阶段输出）。销毁即删除本行。 */
  @Column({ type: 'simple-json' }) payload!: Record<string, unknown>;
  @Column({ type: 'simple-json', nullable: true }) stats?: Record<string, unknown> | null;
  @Column({ type: 'varchar' }) expiresAt!: string;
  @Column({ type: 'varchar', nullable: true }) ticketId?: string | null;
  @CreateDateColumn() createdAt!: Date;
  /** 销毁时间；非空表示已销毁（行会被删除，此列用于异常路径留痕）。 */
  @Column({ type: 'varchar', nullable: true }) destroyedAt?: string | null;
}

/**
 * 本地审计回执链（任务 8.7）。每条事件一条签名回执；`prev_receipt_hash` 成链，
 * 链头定期经平台上链。平台与离线工具都按同一判据校验连续性。
 */
@Entity('local_mdop_receipt')
export class LocalMdopReceipt {
  @PrimaryColumn() receiptId!: string;
  @Index() @Column() jobId!: string;
  @Column() stage!: string;
  @Column() event!: string;
  @Column({ type: 'simple-json' }) payload!: Record<string, unknown>;
  @Column({ type: 'varchar', nullable: true }) prevReceiptHash?: string | null;
  /** 本条回执的哈希（下一条的 prev 指向它）。 */
  @Index() @Column() entryHash!: string;
  /** 是否已上报平台（链头锚定用）。 */
  @Column({ default: false }) reported!: boolean;
  @CreateDateColumn() at!: Date;
}

export const connectorEntities = [
  LocalRecord,
  LocalAuditLog,
  LocalGoldStandard,
  LocalDataSourceStatus,
  LocalMdopContract,
  LocalMdopContractPending,
  LocalMdopOperatorWhitelist,
  LocalMdopRevocationState,
  LocalMdopProcessedKey,
  LocalMdopNonce,
  LocalMdopArtifact,
  LocalMdopReceipt,
];
