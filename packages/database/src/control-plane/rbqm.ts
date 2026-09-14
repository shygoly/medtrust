/**
 * RBQM 中心化监查实体（control-plane 平面 · rbqm-central-monitoring）。
 * 三张表均是聚合/元数据，与 settlement 台账同性质：永不落个体行级数据（D1/D7）。
 * - KriDefinition：KRI 定义 + QTL 分层阈值（分类分层 = riskTier × thresholds）
 * - KriObservation：站点级聚合观测（连接器过闸后仅回传的三元组）
 * - QtlBreach：越限记录 + 上链存证引用
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 指标方向：值越高越差 / 越低越差。决定阈值比较方向。 */
export type KriDirection = 'higher_worse' | 'lower_worse';
/** 风险分层（CSDR 分类分层实施路径）。 */
export type KriRiskTier = 'routine' | 'elevated' | 'intensive';
/** 越限层级。 */
export type QtlLevel = 'warning' | 'critical';
/** 越限记录状态。 */
export type QtlBreachStatus = 'open' | 'acknowledged' | 'resolved';

/** 单条分层阈值。op 为比较方向下的"达到即越限"判据。 */
export interface QtlThreshold {
  level: QtlLevel;
  /** 比较算子：higher_worse 用 'gte'，lower_worse 用 'lte'。 */
  op: 'gte' | 'lte';
  value: number;
}

@Entity('cp_kri_definition')
export class KriDefinitionEntity {
  @PrimaryColumn() id!: string; // seed:kri-... 或 UUID
  @Column({ unique: true }) code!: string; // 稳定业务键，如 'AE_REPORT_DELAY'
  @Column() name!: string;
  @Column({ default: '' }) unit!: string; // 如 '%' / 'days'
  @Column({ default: '' }) category!: string; // data-quality | safety | enrollment ...
  @Column({ default: 'routine' }) riskTier!: KriRiskTier;
  @Column({ default: 'higher_worse' }) direction!: KriDirection;
  @Column({ default: 'cumulative' }) windowKind!: string; // cumulative | rolling-30d ...
  @Column({ type: 'simple-json', nullable: true }) thresholds!: QtlThreshold[] | null;
  @Column({ default: '' }) description!: string;
  @Column({ default: 'active' }) status!: string;
  @CreateDateColumn() createdAt!: Date;
}

@Entity('cp_kri_observation')
export class KriObservationEntity {
  @PrimaryColumn() id!: string;
  @Column() kriCode!: string;
  @Column() siteId!: string;
  @Column({ default: '' }) siteName!: string;
  @Column({ default: '' }) studyId!: string;
  @Column({ default: '' }) periodStart!: string;
  @Column({ default: '' }) periodEnd!: string;
  // 站点级聚合三元组。suppressed=true 时 numerator/denominator 已置 0（不可反推）。
  @Column({ type: 'integer', default: 0 }) numerator!: number;
  @Column({ type: 'integer', default: 0 }) denominator!: number;
  @Column({ type: 'real', default: 0 }) value!: number;
  @Column({ type: 'integer', default: 0 }) cohortSize!: number;
  @Column({ default: false }) suppressed!: boolean;
  @Column({ default: '' }) sourceDigest!: string; // 连接器聚合结果的 SM3 摘要
  @Column({ default: '' }) submittedAt!: string;
  @CreateDateColumn() createdAt!: Date;
}

@Entity('cp_qtl_breach')
export class QtlBreachEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() kriCode!: string;
  @Column() siteId!: string;
  @Column({ default: '' }) studyId!: string;
  @Column({ type: 'real', default: 0 }) observedValue!: number;
  @Column({ default: 'warning' }) thresholdLevel!: QtlLevel;
  @Column({ type: 'real', default: 0 }) thresholdValue!: number;
  @Column({ default: 'warning' }) severity!: QtlLevel;
  @Column({ default: 'open' }) status!: QtlBreachStatus;
  @Column({ default: '' }) detectedAt!: string;
  @Column({ default: '' }) attestationTxHash!: string;
  @Column({ type: 'integer', default: 0 }) attestationBlock!: number;
  @CreateDateColumn() createdAt!: Date;
}
