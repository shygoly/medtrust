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
import type { DataProductCoverage } from './data-source-coverage';
import {
  KriDefinitionEntity,
  KriObservationEntity,
  QtlBreachEntity,
} from './rbqm';
import { DeidSpecEntity } from './deid';
import { DeidDictionaryEntity } from './deid-dictionary';

export * from './rbqm';
export * from './deid';
export * from './deid-dictionary';

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

/**
 * 平台侧当事人快照（谁做的这个动作）。
 *
 * **不是缔约条款**：与 `autoOfferedAt` 同类，只用于列表/审计展示，因此
 * MUST NOT 进入 `ContractService.canonical()`——否则补记留痕会让已上链合约验哈希失败。
 * `name/email` 是**当时**的快照：人员改名/离职后，历史记录仍说明当时是谁。
 */
export interface ContractActorRef {
  /** 机构 slug（与 providerId/consumerId 同域）。 */
  participantId?: string | null;
  userId?: number | string | null;
  name?: string | null;
  email?: string | null;
}

/** 申请人快照（合约申请由谁提交；旧合约为空）。 */
export interface ContractRequester {
  userId?: number | string | null;
  name?: string | null;
  email?: string | null;
  at: string; // ISO
}

/** 审批决定快照（医院签发/驳回，或申请方撤回，由谁在何时做出）。 */
export interface ContractDecision {
  /**
   * `approved` / `rejected` = 医院的审批结论；`withdrawn` = 申请方在医院审批前撤回。
   * 三者都表示「这份申请到此为止」，区别只在谁做的。
   */
  outcome: 'approved' | 'rejected' | 'withdrawn';
  at: string; // ISO
  by: ContractActorRef;
  /** manual_review 的确认理由 / 撤回原因（可空）。 */
  note?: string | null;
}

/** 解除留痕（谁在何时因何解除已生效合约）。 */
export interface ContractRevocation {
  at: string; // ISO
  by: ContractActorRef;
  reason: string;
}

/**
 * MDOP 合约的扩展条款（D-MDOP-4 / 规格「持有方签署的数字合约」）。
 * 这些字段与 `DigitalContract` 的基础要素一起，构成**被持有方签名、平台副署**的规范化合约
 * （JCS 规范化后国标 SM2 签名）。改任何一个字节，持有方签名即失效。
 */
export interface MdopContractTerms {
  /** 接收方列表；平台以 `merger` 身份显式列入（D-MDOP-2）。 */
  recipients: Array<{ party: string; role: 'merger' | 'final'; jurisdiction: string }>;
  /** 用途编码（与作业 purpose 必须一致，否则复核报 E_PURPOSE_MISMATCH）。 */
  purposeCode: string;
  /** 允许的算子摘要（合约固定算法，沿用 pinnedModules 的口径）。 */
  allowedOpDigests: string[];
  /** 复核方式与时限（缺省 72 小时；超时视同拒绝）。 */
  review: { mode: 'auto' | 'manual'; deadlineHours: number };
  /** 伦理批件要求。 */
  ethics: { required: boolean; ref?: string | null; validUntil?: string | null };
  /** 提供方连接器公钥指纹（kid = 公钥 SM3 全长）。 */
  providerPublicKeyKid: string;
  /** 平台节点公钥指纹。 */
  platformPublicKeyKid: string;
  /** 预审快照哈希（D-CMP-2）。 */
  preReviewSnapshot?: string | null;
  /** 发布条件（降密算子参数不得弱于它）。 */
  publication: { minCell?: number };
  /** 数据产品 id（进入签名范围，复核时与本地副本比对）。 */
  dataProductId: string;
  /**
   * 证明策略（C2 作业必需，缺省即无 C2 资格）。
   *
   * 形状与 `packages/mdop` 的 `AttestationPolicy` 一致：允许的链型、按链的最低可信基、
   * 可进一步收窄的度量清单。**它进入合约规范化与哈希**——改了就是要约条款变了，须重新签署。
   */
  attestationPolicy?: {
    tee: string[];
    minTcb?: string | Record<string, string>;
    allowedMeasurements?: string[];
  };
  /**
   * 服务计算协议标准（服务计算作业必需）。
   * 包含管道拓扑、算子白名单、参数空间与累积预算。进入合约规范化与哈希。
   */
  serviceProtocol?: {
    protocol_version: string;
    target_corpus_ids: string[];
    topology: {
      stages: Array<{
        stage_id: string;
        required_op: string;
        depends_on: string[];
        intermediate_label: 'C0_internal';
      }>;
      final_stage_id: string;
    };
    operator_whitelist: Array<{
      op: string;
      version: string;
      kind: 'wasm';
      sm3_digest: string;
    }>;
    parameter_space: {
      allowed_filter_columns: string[];
      max_time_window_days?: number;
      allowed_grouping_columns: string[];
      prohibited_predicates?: string[];
    };
    budget_policy: {
      total_epsilon: number;
      delta?: number;
      max_queries: number;
      min_cell_size: number;
      rate_limit_per_hour?: number;
      circuit_breaker_enabled?: boolean;
    };
  };
}

/**
 * MDOP 合约在控制面的生命期。`unsigned` = 无持有方签名（旧合约），只能服务旧管线；
 * 用于 MDOP 作业时编译期报 `E_CONTRACT_UNSIGNED`。
 */
export type MdopContractStatus =
  | 'unsigned'
  | 'offered'
  | 'agreed'
  | 'active'
  | 'terminated'
  | 'rejected';

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
  /**
   * algorithm-sandbox /  third-party-module-admission「固定算法模块」条款。
   * 旧口径:分析类型 → 模块 SM3;新口径:分析类型 → {sm3, tier, review}
   * (第三方模块必须带准入层级 + 平台审查背书)。两者都计入合约哈希。
   */
  pinnedModules?: Record<string, string | PinnedModuleClause>;
  /** 合规预审裁决快照(D-CMP-2);跨库按值保存,计入合约哈希。无 = 未预审(旧合约,不能建新任务)。 */
  preReview?: ContractPreReview | null;
  /** 需审批(manual_review)时医院签发的显式确认;计入合约哈希。 */
  preReviewAck?: ContractPreReviewAck | null;
  /**
   * **预授权自动推进**（Phase 3 / D-MDOP-9）：本条合约是被平台按提供方的产品级预授权
   * （`cp_data_access_grant`）自动推进到"已发出要约"的，记下那份授权的 id。
   * **不等于平台代签**：签名仍只由提供方连接器按**院内本地策略**给出（D-MDOP-4 不变）。
   */
  autoOfferGrantId?: string | null;
  /** 自动推进的时间（ISO）；与 `autoOfferGrantId` 成对出现，供审计对账。 */
  autoOfferedAt?: string | null;
  /**
   * 申请人快照（谁提交的申请）。**平台侧留痕，不计入 canonical/合约哈希**；
   * 旧合约（本字段上线前创建）为空 → 界面显示「未记录（旧合约）」。
   */
  requestedBy?: ContractRequester | null;
  /** 审批决定快照（签发/驳回由谁在何时做出）。同样不计入哈希。 */
  decision?: ContractDecision | null;
  /** 解除留痕（谁在何时因何解除）。同样不计入哈希。 */
  revocation?: ContractRevocation | null;
}

// 数据产品目录项 — 只登记元数据,绝不汇聚原始数据(data-product spec)。
/**
 * 域内活动表共享的空间维度列（P4 / D-SPD-12）。
 *
 * 只有「发生在某个空间内」的活动实体才继承本基类；**身份与主体表 MUST NOT 继承**
 * （机构身份保持全局，跨空间关系由成员关系表达）。
 *
 * 列名固定为 \`space_id\`，与基座 \`scopeToSpace\` 的缺省过滤列一致（D-SPD-2）。
 */
export abstract class SpaceScoped {
  @Index()
  // 必须显式声明 type：属性类型是 `string | null` 联合，TypeORM 从 design:type 只能推出
  // `Object`，better-sqlite3 会在启动时以 DataTypeNotSupportedError 拒绝（线上实测，
  // 见 apps/api/src/runtime/space-context/entity-metadata.spec.ts 这个守护）。
  @Column({ name: 'space_id', type: 'varchar', nullable: true })
  spaceId?: string | null;
}

/** 已继承 SpaceScoped 的表名清单；应用启动时据此登记进基座过滤表并回填默认空间。 */
export const SPACE_SCOPED_TABLES: readonly string[] = [
  'cp_data_access_grant',
  'cp_notification',
  'cp_digital_contract',
  'cp_mdop_operator',
  'cp_mdop_outbox',
  'cp_mdop_job',
  'cp_mdop_fragment',
  'cp_mdop_stage',
  'cp_mdop_aggregate_contribution',
  'cp_mdop_ticket',
  'cp_mdop_signature_record',
  'cp_mdop_handle',
  'cp_mdop_attestation',
  'cp_mdop_delivery',
  'cp_mdop_receipt',
  'cp_mdop_nonce',
  'cp_settlement_record',
  'cp_settlement_line',
  'cp_attestation_ref',
  'cp_connector_audit_digest',
  'cp_connector_registry',
  'cp_module_admission',
  'cp_module_revocation',
  'cp_rws_task',
  'cp_rws_assignment',
  'cp_fl_prediction_task',
  'cp_fl_prediction_assignment',
  'cp_exchange_attempt',
];

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
  /** draft：已登记但未确权，不进入在架目录。 */
  @Column({ type: 'varchar', default: 'active' })
  status!: 'active' | 'archived' | 'draft';
  @Column({ default: false }) rightsConfirmed!: boolean;
  @Column({ type: 'integer', default: 0 }) recordCount!: number;
  @Column({ type: 'simple-json', nullable: true }) fhirSchema!: Record<string, unknown> | null;
  /** 场景角色标签（如 sponsor-trial / hospital-controls），不从标题推断。 */
  @Column({ type: 'simple-json', nullable: true }) productRoles?: string[] | null;
  /**
   * omop-data-source-access：CDM 数据产品的覆盖元数据，由连接器从库内统计上报（只有版本与
   * 统计量）。数据源声明在 fhirSchema.dataSource，凭据永不入此库（D-CN-6）。
   */
  @Column({ type: 'simple-json', nullable: true }) coverage?: DataProductCoverage | null;
  /**
   * ndi-catalog-upstream-listing：是否对外上报区域节点。
   * 缺省 `internal`——存量产品**不自动**转 `regional`（默认不外发）。
   */
  @Column({ type: 'varchar', default: 'internal' })
  listingScope!: ListingScope;
  /** 公开授权留痕：转 `regional` 前必填（授权主体/时间/依据/签名）。 */
  @Column({ type: 'simple-json', nullable: true })
  listingConsent?: ListingConsent | null;
  /** 数据服务规格（仅 productType='service'）：口径、最小样本、出域闸门参数。 */
  @Column({ type: 'simple-json', nullable: true })
  serviceSpec?: ServiceSpec | null;
  /** 服务容量/历史任务数；服务类不用 recordCount 表达规模。 */
  @Column({ type: 'integer', nullable: true })
  serviceCapacity?: number | null;
  /** 参与方披露：默认只给数量区间，机构名需各方书面同意。 */
  @Column({ type: 'simple-json', nullable: true })
  provenance?: ProductProvenance | null;
  @CreateDateColumn() createdAt!: Date;
  @Column({ type: 'timestamp', nullable: true }) updatedAt?: Date | null;
}

export type ListingScope = 'internal' | 'regional';

export interface ListingConsent {
  grantedBy: string;
  grantedAt: string;
  basis: string;
  signature?: string;
}

export interface ServiceSpec {
  statistic: string;
  minSample: number;
  inputSchema?: unknown;
  outputSchema?: unknown;
  gate?: { minCell?: number; minCellRare?: number };
  allowedPurposes?: string[];
}

export interface ProductProvenance {
  participantCountBand?: string;
  namedParties?: string[];
}

/**
 * 站内信（D-NOTIF-1）：需要某个**参与方**知道/处理的事件（如"有人申请了你的数据合约"）。
 *
 * 为什么是"参与方"而不是"用户"：本仓的授权主体是参与方（role 绑在参与方上，JWT 带 participantId），
 * 待办也是机构的待办——谁看到都可以处理。因此 `recipientParticipantId` 是收件人，
 * 已读状态**按参与方**记（机构内任一成员标记已读即视为机构已知悉）。
 *
 * 通道边界（诚实登记）：当前只有**站内信**（表 + 端点 + 工作台面板）。
 * 邮件/短信没有可用的生产通道（`auth/mail.service.ts` 是重置验证码的开发桩），
 * 要做必须另立决定并接入真实通道——不在本表里假装已发送。
 */
@Entity('cp_notification')
export class NotificationEntity extends SpaceScoped {
  @PrimaryColumn() id!: string;
  /** 收件参与方（机构的待办）。 */
  @Index() @Column({ type: 'varchar' }) recipientParticipantId!: string;
  /** 可选：只给某个角色的成员看（当前一律落参与方，留字段以便后续细分）。 */
  @Column({ type: 'varchar', nullable: true }) recipientRole?: string | null;
  /** 事件类型：contract.request / contract.approved / contract.rejected / contract.auto-offered … */
  @Index() @Column({ type: 'varchar' }) type!: string;
  @Column({ type: 'varchar' }) title!: string;
  @Column({ type: 'text', nullable: true }) body?: string | null;
  /** 关联资源（点开跳到哪）；与 resourceId 成对使用。 */
  @Column({ type: 'varchar', nullable: true }) resourceType?: string | null;
  @Column({ type: 'varchar', nullable: true }) resourceId?: string | null;
  /** 触发者（谁的动作引出这条通知），便于问责与对账。 */
  @Column({ type: 'varchar', nullable: true }) actorParticipantId?: string | null;
  @Column({ type: 'varchar', default: 'unread' }) status!: NotificationStatus;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @Column({ type: 'timestamp', nullable: true }) readAt?: Date | null;
  /** 事件细节（不含用户原始输入；用于审计对账与卡片渲染）。 */
  @Column({ type: 'simple-json', nullable: true }) details?: Record<string, unknown> | null;
}

export type NotificationStatus = 'unread' | 'read';

/**
 * 数据产品访问授权（**产品级 ACL**，D-ACL-1）。
 *
 * 与数字合约的分工（两层，缺一不可）：
 * - **本表 = 访问控制层**：产品提供方（或合规/运营）显式授予某个参与方"能碰这个产品"；
 *   它回答"你能不能对这个数据产品发起作业"，**不携带条款**，不构成执行授权。
 * - **数字合约 = 执行授权层**：目的/留存/输出/有效期 + 提供方签名，作业提交与编译时强制
 *   （`assertUsableForJob`）。本表 MUST NOT 被当作合约的替代，也 MUST NOT 放宽出域闸门
 *   （闸门参数仍只由合约 `outputPolicy` 决定，见 D-DC-2）。
 *
 * 语义是 **fail-closed**：没有 active 且未过期的授权行 = 拒绝（产品提供方本人访问自己的产品除外）。
 * 回收是**追加式**的：置 `revoked` + 记原因/时间/操作者，不删行——授权历史是可审计记录。
 */
@Entity('cp_data_access_grant')
export class DataProductAccessGrantEntity extends SpaceScoped {
  @PrimaryColumn() id!: string;
  @Index() @Column({ type: 'varchar' }) dataProductId!: string;
  /** 产品的提供方（授权方；授予时校验调用者属于该参与方，合规/运营可代授）。 */
  @Column({ type: 'varchar' }) providerId!: string;
  /** 被授权参与方（使用方）。 */
  @Index() @Column({ type: 'varchar' }) granteeParticipantId!: string;
  /** 权限集合：catalog=可见于目录；compute=可对该产品发起作业。 */
  @Column({ type: 'simple-json' }) permissions!: AccessPermission[];
  /** 目的限定（可选）：填了则只对同用途的作业有效；空 = 不限用途。 */
  @Column({ type: 'varchar', nullable: true }) purpose?: string | null;
  @Column({ type: 'varchar', default: 'active' }) status!: AccessGrantStatus;
  @Column({ type: 'varchar', nullable: true }) grantedByUserId?: string | null;
  @Column({ type: 'varchar', nullable: true }) grantedByParticipantId?: string | null;
  @Index() @Column() grantedAt!: Date;
  /** ISO 到期时间；空 = 不自动过期（权限回收仍可手动做）。 */
  @Column({ type: 'varchar', nullable: true }) expiresAt?: string | null;
  @Column({ type: 'varchar', nullable: true }) revokedByUserId?: string | null;
  @Column({ type: 'timestamp', nullable: true }) revokedAt?: Date | null;
  /** 回收原因（必填，留痕）。 */
  @Column({ type: 'varchar', nullable: true }) revokeReason?: string | null;
  @Column({ type: 'varchar', nullable: true }) note?: string | null;
}

/** 访问授权的权限位。`compute` 是主干：能不能对这个数据产品发起作业。 */
export type AccessPermission = 'catalog' | 'compute';

export type AccessGrantStatus = 'active' | 'revoked';

// 数字合约的持久化形态(usage-control / digital-contract spec)。
@Entity('cp_digital_contract')
export class DigitalContractEntity extends SpaceScoped {
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
  pinnedModules?: Record<string, string | PinnedModuleClause> | null;
  // 合规预审裁决快照 + 需审批确认(D-CMP-2);两者均计入合约哈希(canonical)。
  @Column({ type: 'simple-json', nullable: true })
  preReview?: ContractPreReview | null;
  @Column({ type: 'simple-json', nullable: true })
  preReviewAck?: ContractPreReviewAck | null;
  /**
   * 预授权自动推进的留痕（Phase 3 / D-MDOP-9）：平台按提供方的产品级预授权
   * （`cp_data_access_grant`）自动把本条合约推进到"已发出要约"时，记下授权 id 与时间。
   * **不是平台代签**：签名仍只由提供方连接器按院内本地策略给出（D-MDOP-4 不变）。
   * 不进 canonical 条款（不是缔约双方的约定内容，是平台侧的动作留痕）。
   */
  @Column({ type: 'varchar', nullable: true }) autoOfferGrantId?: string | null;
  @Column({ type: 'varchar', nullable: true }) autoOfferedAt?: string | null;
  /**
   * 申请 / 审批 / 解除的当事人留痕（contract-review）。**不计入 canonical**：
   * 它们是平台侧演示数据，不是缔约双方约定的内容；补记历史留痕不得让已存证合约失效。
   */
  @Column({ type: 'simple-json', nullable: true })
  requestedBy?: ContractRequester | null;
  @Column({ type: 'simple-json', nullable: true })
  decision?: ContractDecision | null;
  @Column({ type: 'simple-json', nullable: true })
  revocation?: ContractRevocation | null;
  /**
   * MDOP 扩展条款（D-MDOP-4）。为 null = 本合约未走 MDOP 签署流程（旧合约）：
   * 仍可服务旧管线，但不能授权 MDOP 作业。
   */
  @Column({ type: 'simple-json', nullable: true })
  mdopTerms?: MdopContractTerms | null;
  /** 持有方（提供方连接器）对规范化合约的国标 SM2 签名（DER hex）。 */
  @Column({ type: 'text', nullable: true })
  holderSignature?: string | null;
  /** 平台节点密钥的副署（DER hex）。 */
  @Column({ type: 'text', nullable: true })
  platformCountersignature?: string | null;
  /** MDOP 合约生命期；缺省 `unsigned`。 */
  @Column({ type: 'varchar', default: 'unsigned' })
  mdopStatus!: MdopContractStatus;
  @Column({ type: 'varchar', nullable: true }) mdopOfferedAt?: string | null;
  @Column({ type: 'varchar', nullable: true }) mdopAgreedAt?: string | null;
  @Column({ type: 'varchar', nullable: true }) mdopTerminatedAt?: string | null;
  @Column({ type: 'varchar', nullable: true }) mdopTerminateReason?: string | null;
  @CreateDateColumn() createdAt!: Date;
}

/**
 * MDOP 算子清单（D-MDOP-5 / 规格「算子清单」）。清单由**注册中心密钥**签名后分发；
 * 连接器本地白名单是按摘要的**独立**授权（平台改不了它）。
 *
 * `kind`：`wasm`（digest = 模块 SM3，必须来自源码复现构建）/ `oci`（本期不启用）/
 * `system`（连接器或平台自带机制，`id@version` + 组件构建版本）。
 */
@Entity('cp_mdop_operator')
export class MdopOperatorEntity extends SpaceScoped {
  /** `id@version` —— 同一 id 的不同版本是不同算子。 */
  @PrimaryColumn() ref!: string;
  @Index() @Column() opId!: string;
  @Column() version!: string;
  @Column({ type: 'varchar' }) kind!: 'wasm' | 'oci' | 'system';
  @Index() @Column() category!: string;
  /** wasm = 模块 SM3；oci = 镜像 digest；system = 组件标识。 */
  @Index() @Column() digest!: string;
  /** 完整清单（含输入输出等级规则、参数 schema、可运行环境、security.network）。 */
  @Column({ type: 'simple-json' }) manifest!: Record<string, unknown>;
  /** 注册中心密钥对**清单对象**的国标 SM2 签名（JCS + SM3，DER hex）。 */
  @Column({ type: 'simple-json' })
  signature!: { alg: string; kid: string; value: string };
  @CreateDateColumn() registeredAt!: Date;
  /** 登记人（平台侧审计用；连接器不据此判断任何事）。 */
  @Column({ type: 'varchar', nullable: true }) registeredBy?: string | null;
}

/**
 * MDOP 控制面发件箱（D-MDOP-1 D3 / 协议 §7）。平台 → 连接器的消息（合约要约、片段要约、
 * 凭证、调度、销毁指令、吊销名单）先落这张表，随长轮询下发；`delivered_at` 为空即待发，
 * 按原 `idempotency_key` 重发，连接器按 `msg_id` 去重。
 */
@Entity('cp_mdop_outbox')
export class MdopOutboxEntity extends SpaceScoped {
  @PrimaryColumn() id!: string;
  @Index() @Column() msg_id!: string;
  @Column() msg_type!: string;
  @Index() @Column({ type: 'varchar', nullable: true }) job_id?: string | null;
  /** 目标节点（`urn:tds:<space>:participant:<id>`）。 */
  @Index() @Column() receiver!: string;
  @Column() sender!: string;
  @Column() idempotency_key!: string;
  /** 信封 body（不含制品内容）。 */
  @Column({ type: 'simple-json' }) body!: Record<string, unknown>;
  @CreateDateColumn() createdAt!: Date;
  @Column({ type: 'timestamp', nullable: true }) deliveredAt?: Date | null;
  /** 已发出的 envelope（含签名），重发时保持同一 msg_id 与 nonce。 */
  @Column({ type: 'simple-json', nullable: true })
  envelope?: Record<string, unknown> | null;
}

// 价值结算台账(value-settlement spec)。append-only:更正用新条目表达。
@Entity('cp_settlement_record')
export class SettlementRecord extends SpaceScoped {
  /**
   * P3.2：产出 contribution 的计量引擎标注（id / version / digest / mode）。
   * mode = proxy 表示走开放兜底口径；MUST NOT 静默冒充算法口径（D-SPD-7）。
   */
  @Column({ name: 'metering_engine', type: 'simple-json', nullable: true })
  meteringEngine?: Record<string, unknown> | null;

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
export class SettlementLine extends SpaceScoped {
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
/**
 * P7.1 / D-SPD-15：空间主题（**只允许白名单令牌**，MUST NOT 接受任意 CSS）。
 * 不可覆盖项：状态语义色映射、功能层、能力层。
 */
export interface SpaceBranding {
  logoKey?: string;
  faviconKey?: string;
  title?: string;
  shortName?: string;
  primary?: string;
  accent?: string;
}

@Entity('cp_space')
export class SpaceEntity {
  /** P7.1：空间主题覆盖（白名单令牌）。 */
  @Column({ name: 'branding', type: 'simple-json', nullable: true })
  branding?: SpaceBranding | null;

  /**
   * P1.3 / D-SPD-10：本空间**运行期启用**的能力包。
   * 与"部署白名单"是两个独立开关——白名单决定本部署被授权跑哪些包。
   */
  @Column({ name: 'enabled_packs', type: 'simple-json', nullable: true })
  enabledPacks?: string[] | null;

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
  /**
   * CA 根钥的私钥。**用途互斥**：CA 根钥只签/吊销证书（D-MDOP-3 / 规格「平台密钥按用途分离」）。
   *
   * 落库形态是 SM4 密文（`enc:v1:<iv>:<cipher>`），密钥加密密钥来自 `PLATFORM_KEK`；
   * 本列**不允许**再出现可直接使用的明文私钥 —— 历史明文由 CaService 启动时原地迁移。
   */
  @Column('text') privateKey!: string;
  /** 平台节点密钥公钥：签 MDOP 信封、执行凭证、吊销名单，并以合约一方身份副署合约。 */
  @Column({ type: 'text', nullable: true }) platformNodePublicKey?: string | null;
  /** 平台节点密钥私钥（SM4 密文）。 */
  @Column({ type: 'text', nullable: true }) platformNodePrivateKey?: string | null;
  /** 注册中心密钥公钥：签算子清单与算法模块（P-CTL-6 的「专用算法签名密钥」）。 */
  @Column({ type: 'text', nullable: true }) registryPublicKey?: string | null;
  /** 注册中心密钥私钥（SM4 密文）。 */
  @Column({ type: 'text', nullable: true }) registryPrivateKey?: string | null;
  @CreateDateColumn() createdAt!: Date;
}

// 参与方注册表 + 主体/数据双认证状态(participant-identity spec)。
/**
 * P6.5 / D-SPD-13：机构商业属性（资质 / 配额 / 订阅 / 财务）。
 * 原 `tenants` 表的位置——机构身份以 cp_participant 为唯一权威，商业属性降级为它的扩展。
 */
export interface ParticipantCommercial {
  license?: {
    businessLicense?: string;
    medicalLicense?: string;
    legalPersonId?: string;
  };
  quota?: {
    compute?: number;
    storage?: number;
    dataRetentionDays?: number;
  };
  subscription?: {
    plan?: string;
    status?: string;
    customerId?: string;
    subscriptionId?: string;
  };
  finance?: {
    totalEarnings?: number;
    totalSpending?: number;
  };
}

@Entity('cp_participant')
export class ParticipantIdentity {
  /**
   * P6.5：商业属性（原 Tenant 的资质 / 配额 / 订阅 / 财务）。
   * 机构身份唯一化后不再有第二套机构实体（D-SPD-13）。
   */
  @Column({ name: 'commercial', type: 'simple-json', nullable: true })
  commercial?: ParticipantCommercial | null;

  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index({ unique: true }) @Column() org!: string;
  /**
   * 平台内参与方 slug（与合约/任务里的 `providerId`/`consumerId` 同值）。
   * 为空 = 未与平台 slug 对齐的旧行；准入流程新建行时由部署侧补齐。
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  participantId?: string | null;
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
  @Column() validUntil!: Date;
  @Column({ default: false }) revoked!: boolean;
  @CreateDateColumn() issuedAt!: Date;
  // on-chain-provider-endorsement(task 4.2):CA 对本证书的 SM2 签名。
  // 第三方要独立验「该院背书」必须先验证书链,故签名须随证书一起对外发布。
  // 旧行为 null —— 目录接口按存储字段重新签发补齐(载荷完全由这些字段决定)。
  @Column({ type: 'text', nullable: true }) caSignature?: string | null;
}

/**
 * 存证指针的证据类别。`policy / task / output` 是任务链路上的三类证据；
 * `receipt-chain`（MDOP 审计回执链头）、`node-attestation`（可信空间节点证明摘要）、
 * `evidence`（RBQM 越限等监查证据）是同一条存证通道上的其它上链对象。
 */
export type AttestationRefKind =
  | 'policy'
  | 'task'
  | 'output'
  | 'receipt-chain'
  | 'node-attestation'
  | 'evidence';

/** 存证指针归属对象的类型（配合 `taskId` 定位归属记录，并据此判定谁有权查看）。 */
export type AttestationSubjectType =
  | 'rws-task'
  | 'fl-task'
  | 'contract'
  | 'mdop-job'
  | 'qtl-breach';

// 链上存证指针(存证索引)。链上只存哈希(D6)；本表记录「哪个对象的哪个哈希在哪笔交易 / 哪个区块」，
// 由 AttestationService 在每次**真实上链成功**后写入——降级的本地回执(0xLOCAL)不入表。
// 用途：① 存证账本页与审计证据包的数据源；② 链上合约拒收重复哈希时，按哈希找回既有记录。
// 一条链上记录可被多个对象引用(确定性计算会得出相同结果哈希)：按 (hash, subjectType, taskId) 去重。
@Entity('cp_attestation_ref')
export class AttestationRef extends SpaceScoped {
  @PrimaryGeneratedColumn('uuid') id!: string;
  /** 被锚定的摘要，规范形 "SM3:<小写 hex>"。链上合约对同一哈希只收一条。 */
  @Index() @Column({ type: 'varchar' }) hash!: string;
  @Column({ type: 'varchar' }) kind!: AttestationRefKind;
  /** 归属对象类型；未知为 null（此时仅运营 / 合规可见，fail-closed）。 */
  @Column({ type: 'varchar', nullable: true }) subjectType?: AttestationSubjectType | null;
  /** 归属对象 id（RWS / FL 任务、MDOP 作业、数字合约…）。 */
  @Column({ type: 'varchar', nullable: true }) taskId?: string | null;
  @Column({ type: 'varchar', default: 'software' }) attestationLevel!: AttestationLevel;
  @Column() txHash!: string;
  @Column({ type: 'varchar', nullable: true }) inputFingerprint?: string | null;
  @Column({ type: 'varchar', nullable: true }) outputHash?: string | null;
  @Column({ type: 'bigint' }) block!: string;
  /** 上链时间(ISO)。历史回填取来源记录的时间；与行创建时间 `at` 区分。 */
  @Column({ type: 'varchar', nullable: true }) anchoredAt?: string | null;
  @CreateDateColumn() at!: Date;
}

// 连接器审计摘要(TC609 P0-6):连接器周期/事件触发把本地审计链摘要上报平台,
// 平台据此查验连接器日志完整性(链式 prevHash 连续 = chainOk)。
@Entity('cp_connector_audit_digest')
export class ConnectorAuditDigest extends SpaceScoped {
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
export class CpConnectorRegistry extends SpaceScoped {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column() participantId!: string;
  @Column({ type: 'varchar', nullable: true }) certificateHash?: string;
  @Column({ type: 'simple-json', nullable: true }) capabilities?: string[];
  @Column({ type: 'varchar', default: 'unknown' }) healthStatus!: string;
  @Column({ type: 'timestamp', nullable: true }) lastSeen?: Date;
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
export class RwsTaskEntity extends SpaceScoped {
  @PrimaryColumn() taskId!: string;
  @Column() title!: string;
  @Column() purpose!: string;
  @Column({ type: 'simple-json' }) analysis!: Record<string, unknown>;
  @Column() consumerId!: string;
  @Column({ type: 'simple-json' }) contractIds!: string[];
  @Column({ type: 'varchar', default: 'pending' }) status!: RwsOrchestrationStatus;
  @Column({ type: 'varchar', default: 'software' }) attestationLevel!: AttestationLevel;
  @Column({ type: 'simple-json', nullable: true }) merged?: Record<string, unknown> | null;
  @Column({ type: 'timestamp', nullable: true }) completedAt?: Date | null;
  // rws-study-protocol-spec (§1 方案先行). protocolVersion defaults to 1 on
  // existing rows via the column default (SQLite synchronize backfill).
  // frozenAt is wired now but only written in Phase 3; landing the column
  // early means Phase 3 is a behavior-only change.
  @Column({ type: 'integer', default: 1 }) protocolVersion!: number;
  @Column({ type: 'text', nullable: true }) revisionReason?: string | null;
  @Column({ type: 'timestamp', nullable: true }) revisedAt?: Date | null;
  @Column({ type: 'timestamp', nullable: true }) frozenAt?: Date | null;
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
export class RwsAssignmentEntity extends SpaceScoped {
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
  @Column({ type: 'timestamp', nullable: true }) startedAt?: Date | null;
  @Column({ type: 'timestamp', nullable: true }) completedAt?: Date | null;
  // algorithm-sandbox:该院这次实际用的执行隔离与模块指纹(控制面按派发记录入库)。
  @Column({ type: 'varchar', default: 'none' })
  executionIsolation!: ExecutionIsolation;
  @Column({ type: 'varchar', nullable: true }) moduleSm3?: string | null;
  // on-chain-provider-endorsement:该院对其聚合结果的结果级 SM2 背书。
  // resultSm3 = 回传聚合结果的稳定摘要(= aggregateHash);签名随存证上链,
  // 使链上记录可脱离平台、凭平台 CA 证书链独立归因到该院(D1/D2)。
  @Column({ type: 'varchar', nullable: true }) resultSm3?: string | null;
  @Column({ type: 'text', nullable: true }) connectorResultSig?: string | null;
  @Column({ type: 'varchar', nullable: true })
  connectorCertFingerprint?: string | null;
  @ManyToOne(() => RwsTaskEntity, (t) => t.assignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'taskId' })
  task!: RwsTaskEntity;
}

export type FlOrchestrationStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed';
export type FlAssignmentStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Federated L4 prediction orchestration task (control-plane metadata only). */
@Entity('cp_fl_prediction_task')
export class FlPredictionTaskEntity extends SpaceScoped {
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
  @Column({ type: 'timestamp', nullable: true }) completedAt?: Date | null;
  @CreateDateColumn() createdAt!: Date;
  @OneToMany(() => FlPredictionAssignmentEntity, (a) => a.task, { cascade: true })
  assignments!: FlPredictionAssignmentEntity[];
}

/** Per-provider connector dispatch for an FL prediction task. */
@Entity('cp_fl_prediction_assignment')
export class FlPredictionAssignmentEntity extends SpaceScoped {
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
  @Column({ type: 'timestamp', nullable: true }) startedAt?: Date | null;
  @Column({ type: 'timestamp', nullable: true }) completedAt?: Date | null;
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
  @Column({ type: 'timestamp', nullable: true }) reviewedAt?: Date | null;

  @CreateDateColumn() createdAt!: Date;
  @Column({ type: 'timestamp', nullable: true }) updatedAt?: Date | null;
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
  @Column({ type: 'timestamp', nullable: true }) revokedAt?: Date | null;
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
  @Column({ type: 'timestamp', nullable: true }) updatedAt?: Date | null;
}

export * from './output-policy';
export * from './data-source-declaration';
export * from './data-source-coverage';

// ─────────────────────────────────────────────────────────────────────────────
// third-party-module-admission（D-CN-5 / P-CTL-7）—— 算法模块准入与吊销。
//
// 源码**不入库**：保密审查通道（design D6）下平台只保留源码引用与摘要，
// 对医院公开的是「模块 SM3 + 平台审查背书」。源码本身留在平台审查环境里。

export type ModuleAdmissionTier = 'A' | 'B';

/** 平台审查背书（对医院公开的那一半；源码永不在此）。 */
export interface ModuleReviewAttestation {
  reviewer: string;
  reviewedAt: string;
  reproducibleBuildRef: string;
  confidential: boolean;
  signature?: string;
}

/** 合约「固定算法模块」条款的完整形态（缺层级或背书视为无效）。 */
export interface PinnedModuleClause {
  sm3: string;
  tier: ModuleAdmissionTier;
  review: ModuleReviewAttestation;
}

export type ModuleSourceLanguage = 'rust' | 'assemblyscript';
export type ModuleAdmissionStatus =
  | 'submitted'
  | 'built'
  | 'tested'
  | 'shadow'
  | 'canary'
  | 'active'
  | 'rejected'
  | 'revoked';

/** 一次模块准入（一条源码提交走完五道闸的全过程）。 */
@Entity('cp_module_admission')
export class ModuleAdmissionEntity extends SpaceScoped {
  @PrimaryColumn() admissionId!: string;
  @Index() @Column() analysisType!: string;
  /** 准入层级：A = 平台自研源码；B = 第三方交源码、平台复现构建 + 审查。 */
  @Column({ type: 'varchar' }) tier!: ModuleAdmissionTier;
  @Column({ type: 'varchar' }) language!: ModuleSourceLanguage;
  /** 提交方（Tier B = 第三方机构标识；Tier A = 平台）。 */
  @Column() submittedBy!: string;
  /** 源码位置引用（保密通道下只留引用，源码不入库、不外发）。 */
  @Column({ type: 'text' }) sourceRef!: string;
  /** NDA 保密提交：对医院只公开 SM3 + 背书。 */
  @Column({ default: false }) confidential!: boolean;
  /** 复现构建产出的模块 SM3（两构建器一致才写；写不出即无法入册）。 */
  @Index() @Column({ type: 'varchar', nullable: true }) sm3?: string | null;
  @Column({ type: 'integer', nullable: true }) sizeBytes?: number | null;
  /** 锁定工具链与构建参数（配方一变 SM3 就变，须重走准入）。 */
  @Column({ type: 'simple-json', nullable: true })
  toolchain?: Record<string, unknown> | null;
  /** 复现构建证明引用（双构建器 + 同一 SM3 的凭据）。 */
  @Column({ type: 'text', nullable: true }) reproducibleBuildRef?: string | null;
  /** 闸 1 静态校验报告（逐条检查项留痕）。 */
  @Column({ type: 'simple-json', nullable: true })
  staticGate?: Record<string, unknown> | null;
  /** 闸 3 动态测试报告（一致性 / 确定性 / 资源 / 防外泄 / 模糊）。 */
  @Column({ type: 'simple-json', nullable: true })
  dynamicGate?: Record<string, unknown> | null;
  /** 闸 4 影子发布记录（首院、比对结果、DPO 查验）。 */
  @Column({ type: 'simple-json', nullable: true })
  shadow?: Record<string, unknown> | null;
  /** 平台审查背书（reviewer / reviewedAt / reproducibleBuildRef / confidential / signature）。 */
  @Column({ type: 'simple-json', nullable: true })
  review?: Record<string, unknown> | null;
  @Column({ type: 'varchar', default: 'submitted' })
  status!: ModuleAdmissionStatus;
  /** 拒绝/吊销原因（fail-closed 的每一步都要能追）。 */
  @Column({ type: 'text', nullable: true }) rejectionReason?: string | null;
  @CreateDateColumn() createdAt!: Date;
  @Column({ type: 'timestamp', nullable: true }) updatedAt?: Date | null;
}

/** 模块吊销名单（闸 5）。随长轮询批次下发给连接器，PEP 执行前检查。 */
@Entity('cp_module_revocation')
export class ModuleRevocationEntity extends SpaceScoped {
  @PrimaryColumn({ type: 'varchar' }) sm3!: string;
  @Column({ type: 'varchar' }) reason!: string;
  @Column() revokedAt!: Date;
  @Column() revokedBy!: string;
  @Column({ type: 'text', nullable: true }) detail?: string | null;
  /** 名单版本（单调递增；连接器只接受版本更高的名单，防回放旧名单撤销吊销）。 */
  @Column({ type: 'integer', default: 1 }) listVersion!: number;
}

/**
 * MDOP 作业（协议 §8.1）。状态迁移由 `packages/mdop` 的显式迁移表约束：
 * `SUBMITTED → COMPILED → NEGOTIATING → TICKETED → RUNNING → RELEASING → SUCCEEDED | FAILED | ABORTED → PURGED`；
 * 编译失败、否决或复核超时 → `REJECTED`（终态）。
 */
@Entity('cp_mdop_job')
export class MdopJobEntity extends SpaceScoped {
  @PrimaryColumn() id!: string;
  /** 用途编码（与合约 purposeCode 必须一致）。 */
  @Index() @Column() purpose!: string;
  @Column({ type: 'simple-json' }) applicant!: { org: string; project: string };
  @Column({ type: 'simple-json' }) contracts!: string[];
  @Index() @Column({ type: 'varchar', nullable: true }) contractBundleId?: string | null;
  @Column({ type: 'varchar', nullable: true }) contractBundleVersion?: string | null;
  /** 组合策略快照（有效期交集、minCell 最大值、接收方交集等）。 */
  @Column({ type: 'simple-json', nullable: true }) contractBundle?: Record<string, unknown> | null;
  /** 每个数据源/阶段对应的成员合约；节点复核必须逐项使用。 */
  @Column({ type: 'simple-json', nullable: true }) contractBindings?: Array<{
    contractId: string;
    participantId: string;
    dataProductId: string;
    role: string;
    stages: string[];
  }> | null;
  @Column({ type: 'varchar', nullable: true }) ethicsRef?: string | null;
  @Column({ type: 'real', nullable: true }) dpBudget?: number | null;
  @Column({ type: 'varchar', nullable: true }) deadline?: string | null;
  /** 逻辑计划原文（提交时的形状，便于追溯）。 */
  @Column({ type: 'simple-json' }) logicalPlan!: Record<string, unknown>;
  /** 作业头（进 plan_hash 的那一份）。 */
  @Column({ type: 'simple-json', nullable: true }) jobHeader?: Record<string, unknown> | null;
  @Index() @Column({ type: 'varchar', default: 'SUBMITTED' }) status!: string;
  @Column({ type: 'varchar', nullable: true }) planHash?: string | null;
  @Column({ type: 'varchar', nullable: true }) rejectReason?: string | null;
  @CreateDateColumn() createdAt!: Date;
  @Column({ type: 'timestamp', nullable: true }) updatedAt?: Date | null;
}

/** 作业的片段（每个节点一份；节点只看得到自己的）。 */
@Entity('cp_mdop_fragment')
export class MdopFragmentEntity extends SpaceScoped {
  /** `jobId#node` */
  @PrimaryColumn() id!: string;
  @Index() @Column() jobId!: string;
  @Index() @Column() node!: string;
  /** 片段全文（物理阶段 + 全部边界边）。 */
  @Column({ type: 'simple-json' }) fragment!: Record<string, unknown>;
  @Column() fragmentHash!: string;
  @CreateDateColumn() createdAt!: Date;
}

/**
 * MDOP 阶段（协议 §8.2）。幂等键 `job:stage:attempt` 落在调度时下发的 `StageDispatch` 上，
 * 这里记录平台的权威状态与重试计数。
 */
@Entity('cp_mdop_stage')
export class MdopStageEntity extends SpaceScoped {
  /** `jobId#stageId` */
  @PrimaryColumn() id!: string;
  @Index() @Column() jobId!: string;
  @Column() stageId!: string;
  @Index() @Column() node!: string;
  @Column() opRef!: string;
  @Column() opDigest!: string;
  @Column({ type: 'simple-json' }) params!: Record<string, unknown>;
  @Column({ type: 'simple-json' }) inputs!: Array<{ from: string }>;
  @Column({ type: 'varchar' }) outputLabel!: string;
  @Column() outputSchema!: string;
  @Column({ type: 'integer', nullable: true }) ttlHours?: number | null;
  @Column({ type: 'varchar', default: 'PENDING' }) status!: string;
  @Column({ type: 'integer', default: 0 }) attempt!: number;
  @Column({ type: 'varchar', nullable: true }) lastError?: string | null;
  @Column({ type: 'timestamp', nullable: true }) updatedAt?: Date | null;
}

/**
 * 聚合阶段的密文贡献（协议 v0.3 §7.6）。
 * 只存密文 blob 与句柄，不存明文更新。到期由调度器按 72 小时 TTL 删除。
 */
@Entity('cp_mdop_aggregate_contribution')
export class MdopAggregateContributionEntity extends SpaceScoped {
  @PrimaryColumn() id!: string;
  @Index() @Column() contributionRef!: string;
  @Index() @Column() jobId!: string;
  @Index() @Column() stageId!: string;
  @Column() contributorId!: string;
  @Column() digest!: string;
  @Column({ type: 'text' }) partialSignature!: string;
  /** 不透明密文字节（base64）。平台不得把它当明文解析。 */
  @Column({ type: 'text' }) ciphertext!: string;
  @Column() expiresAt!: Date;
  @CreateDateColumn() createdAt!: Date;
}

/** 执行凭证（核心 + 各持有方签名 + 平台签名）。 */
@Entity('cp_mdop_ticket')
export class MdopTicketEntity extends SpaceScoped {
  @PrimaryColumn() ticketId!: string;
  @Index() @Column() jobId!: string;
  /** 凭证核心 `{ticket_id, job_id, plan_hash, fragments, not_before, not_after}`。 */
  @Column({ type: 'simple-json' }) core!: Record<string, unknown>;
  @Column({ type: 'simple-json' }) signatures!: Array<Record<string, unknown>>;
  @Column({ type: 'varchar', default: 'OFFERED' }) status!: 'OFFERED' | 'ISSUED' | 'REJECTED';
  @CreateDateColumn() createdAt!: Date;
  @Column({ type: 'timestamp', nullable: true }) issuedAt?: Date | null;
}

/** 签名记录（谁在什么时候签了什么：接受/拒绝/凭证/副署，审计与对账用）。 */
@Entity('cp_mdop_signature_record')
export class MdopSignatureRecordEntity extends SpaceScoped {
  @PrimaryColumn() id!: string;
  @Index() @Column() jobId!: string;
  @Column({ type: 'varchar', nullable: true }) ticketId?: string | null;
  @Index() @Column() signer!: string;
  @Column() role!: string;
  @Column({ type: 'varchar', nullable: true }) snapshot?: string | null;
  /** 命中的格式：`SM2-SM3`。 */
  @Column({ type: 'varchar', default: 'SM2-SM3' }) alg!: string;
  @Column({ type: 'text' }) value!: string;
  /** 接受 / 拒绝 / 凭证 / 副署。 */
  @Column() kind!: string;
  @Column({ type: 'varchar', nullable: true }) reason?: string | null;
  @CreateDateColumn() at!: Date;
}

/** 制品句柄（平台只登记句柄，不含数据；只有 C3 可带 stats）。 */
@Entity('cp_mdop_handle')
export class MdopHandleEntity extends SpaceScoped {
  @PrimaryColumn() handle!: string;
  @Index() @Column() jobId!: string;
  @Index() @Column() node!: string;
  @Column() stage!: string;
  @Column() label!: string;
  @Column() schema!: string;
  @Column() digest!: string;
  @Column({ type: 'simple-json' }) producer!: Record<string, unknown>;
  @Column({ type: 'varchar', nullable: true }) ticketId?: string | null;
  @Column({ type: 'varchar' }) expiresAt!: string;
  @Column({ type: 'simple-json', nullable: true }) stats?: Record<string, unknown> | null;
  @CreateDateColumn() createdAt!: Date;
}

/**
 * 可信空间节点的证明登记（协议 §4.3 / §9.4、决策 D-TEE-1）。
 *
 * **历史保留**：一次会话一条（`id = <node>#<quote_digest>`），不覆盖写——证明是短有效期的，
 * 覆盖写会让「当时到底是什么度量、谁验的」无法追查。编译期取该节点**最新且未过期**的一条。
 *
 * 平台**不自己验 quote**（没有 DCAP/厂商证明服务）：登记时的校验方是 KMS/证明服务，
 * `verified_by` 必须落在部署配置的白名单里，`warrant_digest` 是 KMS 释放凭据的摘要（D13）。
 */
@Entity('cp_mdop_attestation')
export class MdopAttestationEntity extends SpaceScoped {
  @PrimaryColumn() id!: string;
  @Index() @Column() node!: string;
  /**
   * 会话见证所属的作业 / 凭证 / 合约 / 密钥（任务 7.4）。
   *
   * 为什么必须存：`cp_mdop_attestation` 原先只按 `node#warrantDigest` 登记，
   * **无法回答「这个作业的会话证明是哪几条、持有方核验了没有」**——控制台就看不到。
   * 摘要级旧口径（没有会话上下文）保持可空。
   */
  @Index() @Column({ type: 'varchar', nullable: true }) jobId?: string | null;
  @Column({ type: 'varchar', nullable: true }) credentialId?: string | null;
  @Column({ type: 'varchar', nullable: true }) contractId?: string | null;
  @Column({ type: 'varchar', nullable: true }) keyId?: string | null;
  /** 证明链型：`csv` / `tdx` / `sev-snp`。 */
  @Column() kind!: string;
  @Column() measurement!: string;
  @Column({ type: 'varchar', nullable: true }) tcb?: string | null;
  @Column() quoteDigest!: string;
  /** 校验通过时间（ISO）。 */
  @Column({ type: 'varchar' }) verifiedAt!: string;
  /** 证明有效期（ISO）；过期即不得用于放置 C2 阶段。 */
  @Column({ type: 'varchar' }) expiresAt!: string;
  /** 校验方标识（KMS / 证明服务），必须来自部署配置白名单。 */
  @Column({ type: 'varchar' }) verifiedBy!: string;
  /** KMS 释放凭据摘要（供持有方与审计独立复核）。 */
  @Column({ type: 'varchar', nullable: true }) warrantDigest?: string | null;
  /**
   * **会话见证的本体**：本次证明报告（含一次性公钥与身份绑定）与 KMS 释放凭据全文。
   *
   * 为什么必须存本体（任务 6.7）：只存摘要时，持有方拿不到可验签的对象，
   * 「用 KMS 释放凭据独立校验证明」（D13）就退化成「信平台的结论」。存本体后，
   * 平台把见证转发给持有方即可，平台自己仍无法伪造（签名用的是 KMS 私钥）。
   *
   * 关于凭据里的 `wrapped_key`：它是用**证明报告里的一次性公钥**封的数据密钥，
   * 只有该节点实例持有的私钥能解开；平台既无该私钥也不得请求它（见 `platform-no-key-access.spec.ts`），
   * 因此存/转发整份凭据不构成「平台持有数据密钥」。整份凭据也**必须**完整保留——
   * KMS 签名覆盖它，删字段会让持有方验不过。
   */
  @Column({ type: 'simple-json', nullable: true }) report?: Record<string, unknown> | null;
  @Column({ type: 'simple-json', nullable: true }) warrant?: Record<string, unknown> | null;
  /** 证明摘要的链上锚定（链不可达时留空，不伪造交易号）。 */
  @Column({ type: 'varchar', nullable: true }) chainTx?: string | null;
  @Column({ type: 'integer', nullable: true }) chainBlock?: number | null;
  @CreateDateColumn() createdAt!: Date;
}

/** 数据面投递（只收 C3）。`accepted=false` 的投递同样留痕（审计）。 */
@Entity('cp_mdop_delivery')
export class MdopDeliveryEntity extends SpaceScoped {
  @PrimaryColumn() id!: string;
  @Index() @Column() jobId!: string;
  @Index() @Column() node!: string;
  @Column() handle!: string;
  @Column() label!: string;
  @Column() digest!: string;
  @Column() accepted!: boolean;
  @Column({ type: 'varchar', nullable: true }) reason?: string | null;
  /**
   * C3 交付物载荷（只有合约接收方才有权拿到的那份）。平台是合约明示的 C3 接收方
   * （D-MDOP-2），所以这里能存；C0/C1/C2 的载荷永远不会走到这一列。
   */
  @Column({ type: 'simple-json', nullable: true }) payload?: Record<string, unknown> | null;
  @CreateDateColumn() receivedAt!: Date;
}

/** 回执（销毁回执 / 审计回执），按节点链式校验连续性。 */
@Entity('cp_mdop_receipt')
export class MdopReceiptEntity extends SpaceScoped {
  @PrimaryColumn() id!: string;
  @Index() @Column() jobId!: string;
  @Index() @Column() node!: string;
  /** `purge` | `audit` */
  @Column() kind!: string;
  @Column({ type: 'simple-json' }) payload!: Record<string, unknown>;
  /** 审计回执链：本条的上一条哈希（连续性校验用）。 */
  @Column({ type: 'varchar', nullable: true }) prevHash?: string | null;
  @CreateDateColumn() receivedAt!: Date;
}

/** nonce 落地（防重放；重启后仍有效，MUST NOT 只放内存）。 */
@Entity('cp_mdop_nonce')
export class MdopNonceEntity extends SpaceScoped {
  @PrimaryColumn() nonce!: string;
  @Index() @Column() receiver!: string;
  @Column({ type: 'varchar', nullable: true }) sender?: string | null;
  @CreateDateColumn() seenAt!: Date;
  @Column() expiresAt!: Date;
}

// ── P6：空间成员与邀请（D-SPD-11 / D-SPD-14）────────────────────────────────
// 成员两层：subjectType = org（权威，机构入域）| user（由机构派生，或个人直接受邀）。
// 域内角色落在成员关系上，MUST NOT 由全局用户记录单值承载（D-SPD-11）。

export type SpaceSubjectType = 'org' | 'user';
export type SpaceMemberStatus =
  | 'invited'
  | 'pending'
  | 'active'
  | 'suspended'
  | 'rejected';

@Entity('cp_space_member')
export class SpaceMemberEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column({ name: 'space_id' }) spaceId!: string;
  @Column({ type: 'varchar' }) subjectType!: SpaceSubjectType;
  @Index() @Column() subjectId!: string;
  @Column() role!: string;
  @Column({ type: 'varchar', default: 'active' }) status!: SpaceMemberStatus;
  @Column({ nullable: true }) invitedBy?: string;
  @CreateDateColumn() createdAt!: Date;
  @Column({ type: 'timestamp', nullable: true }) joinedAt?: Date | null;
}

@Entity('cp_space_invitation')
export class SpaceInvitationEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column({ name: 'space_id' }) spaceId!: string;
  /** token 只存 SM3 哈希；明文只在签发时返回一次（不可枚举、不入库）。 */
  @Index({ unique: true })
  @Column({ name: 'token_hash', length: 64 })
  tokenHash!: string;
  @Column({ type: 'varchar' }) subjectType!: SpaceSubjectType;
  @Column() invitee!: string;
  @Column() role!: string;
  @Column({ type: 'varchar', default: 'pending' })
  status!: 'pending' | 'accepted' | 'revoked' | 'expired';
  @Column() expiresAt!: Date;
  @Column({ type: 'timestamp', nullable: true }) consumedAt?: Date | null;
  @Column({ nullable: true }) invitedBy?: string;
  @CreateDateColumn() createdAt!: Date;
}

/**
 * P8 / D-SPD-3：空间内的「协作」（业务场景）。
 *
 * 协作聚合合约 / 数据产品 / 成员，并提供**可见性作用域**——同一空间内的竞争方
 * 互不可见。协作 MUST NOT 拥有独立 CA / 密钥 / 策略集；授权仍由合约 + PEP 承担。
 */
@Entity('cp_collaboration')
export class CollaborationEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column({ name: 'space_id' }) spaceId!: string;
  @Column() name!: string;
  @Column({ nullable: true }) description?: string;
  /** 参与方（机构或用户 subjectId）；MUST 是空间成员的子集。 */
  @Column({ type: 'simple-json', default: '[]' }) participants!: string[];
  /** 本协作挂接的数据产品 id。读取时丢掉不属于本空间的 id。 */
  @Column({ type: 'simple-json', default: '[]' }) dataProductIds!: string[];
  @Column({ type: 'varchar', default: 'active' })
  status!: 'active' | 'archived';
  @CreateDateColumn() createdAt!: Date;
}

/**
 * 一次计算尝试的控制面记录。只留合约、合并点、输出哈希和拒绝原因，
 * 不存放曲线、凭证或明细。
 */
@Entity('cp_exchange_attempt')
export class ExchangeAttemptEntity extends SpaceScoped {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', nullable: true }) contractId!: string | null;
  @Column({ type: 'varchar', nullable: true }) mergePoint!: string | null;
  @Column({ type: 'varchar', nullable: true }) outputHash!: string | null;
  @Column({ type: 'varchar', nullable: true }) rejection!: string | null;
  @CreateDateColumn() createdAt!: Date;
}

export const controlPlaneEntities = [
  DataProduct,
  DataProductAccessGrantEntity,
  NotificationEntity,
  DigitalContractEntity,
  SettlementRecord,
  SettlementLine,
  FederationTrust,
  SpaceEntity,
  SpaceMemberEntity,
  SpaceInvitationEntity,
  CollaborationEntity,
  ExchangeAttemptEntity,
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
  ModuleAdmissionEntity,
  ModuleRevocationEntity,
  MdopOutboxEntity,
  MdopOperatorEntity,
  MdopJobEntity,
  MdopFragmentEntity,
  MdopStageEntity,
  MdopAggregateContributionEntity,
  MdopTicketEntity,
  MdopSignatureRecordEntity,
  MdopHandleEntity,
  MdopDeliveryEntity,
  MdopAttestationEntity,
  MdopReceiptEntity,
  MdopNonceEntity,
  DeidSpecEntity,
  DeidDictionaryEntity,
];
