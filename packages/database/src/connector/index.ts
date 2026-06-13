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
@Entity('local_audit_log')
export class LocalAuditLog {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() action!: string; // e.g. ingest, compute, raw-read-blocked
  @Column() actor!: string; // internal | external:<id>
  @Column({ nullable: true }) taskId!: string;
  @Column({ default: true }) allowed!: boolean;
  @Column({ nullable: true }) detail!: string;
  @CreateDateColumn() at!: Date;
}

export const connectorEntities = [LocalRecord, LocalAuditLog];
