// Connector-local entities. These live ONLY on the participant's local
// connector store (hospital intranet / pharma side). Raw, de-identified rows
// never leave this store. See openspec/changes/federated-data-space-rws.
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

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

export const connectorEntities = [LocalRecord, LocalAuditLog, LocalGoldStandard];
