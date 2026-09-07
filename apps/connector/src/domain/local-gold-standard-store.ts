import { Injectable } from '@nestjs/common';
import { GoldStandardRow, GoldStandardStore } from './algorithm-validation/gold-standard-loader';
import { GoldStandardJudgment, GoldStandardSource } from '@medtrust/database';

// In-memory gold-standard store for the connector dev path (parallels
// LocalStore's in-memory rows). The demo / Synthea path ingests annotations
// here; production reads `local_gold_standard` via ConnectorDataSource.
//
// rws-algorithm-validation: annotations live ONLY on the connector-local
// plane. This store is the in-process equivalent — it is never serialized
// over the wire and never leaves the connector process.
@Injectable()
export class LocalGoldStandardStore implements GoldStandardStore {
  private rows: GoldStandardRow[] = [];

  ingest(row: GoldStandardRow): void {
    this.rows.push(row);
  }

  ingestBatch(rows: GoldStandardRow[]): void {
    this.rows.push(...rows);
  }

  /** Synthea/demo helper: synthesize labels for a known subject list. */
  ingestLabels(
    variableDefinitionId: string,
    goldStandardSetVersion: string,
    labels: Array<[string, GoldStandardJudgment]>,
    source: GoldStandardSource = 'study_review',
  ): void {
    for (const [subjectKey, judgment] of labels) {
      this.rows.push({ subjectKey, variableDefinitionId, judgment, source, goldStandardSetVersion });
    }
  }

  replaceAll(rows: GoldStandardRow[]): void {
    this.rows = [...rows];
  }

  clear(): void {
    this.rows = [];
  }

  count(): number {
    return this.rows.length;
  }

  findByVariableDefinition(variableDefinitionId: string): GoldStandardRow[] {
    return this.rows.filter((r) => r.variableDefinitionId === variableDefinitionId);
  }

  provenanceFor(variableDefinitionId: string): 'real' | 'synthetic' {
    const rows = this.rows.filter((r) => r.variableDefinitionId === variableDefinitionId);
    if (rows.length === 0) return 'real';
    // A single synthetic row taints the whole set (§7.3: synthetic results
    // MUST NOT be used for submission; partial mixing would muddy the flag).
    return rows.some((r) => r.source === 'synthetic') ? 'synthetic' : 'real';
  }
}
