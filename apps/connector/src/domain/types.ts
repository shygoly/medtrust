// A raw patient record as it exists INSIDE the hospital source system.
// Contains direct identifiers. This shape never leaves the connector and is
// never persisted — it is de-identified immediately on ingestion.
export interface RawPatientRecord {
  patientId: string; // real hospital MRN / id-card — sensitive
  name: string;
  phone?: string;
  birthDate: string; // YYYY-MM-DD
  gender?: string;
  conditions: string[];
  medications: string[];
  adverseEvents: AdverseEvent[];
}

export interface AdverseEvent {
  organSystem: string; // e.g. 肝胆系统
  term: string; // e.g. ALT 升高
  serious: boolean;
}

// De-identified internal record. No direct identifiers. This is the ONLY shape
// persisted in the connector-local store and the ONLY shape compute runs over.
export interface InternalRecord {
  subjectKey: string; // pseudonymous (hashed), not the real id
  ageBand: string; // coarse band, not exact birthDate
  sex?: string;
  conditions: string[];
  medications: string[];
  adverseEvents: AdverseEvent[];
}

// An RWS analysis definition submitted by the consumer (pharma). It describes
// WHAT to compute; it is executed locally and may only emit aggregates.
export interface RwsAnalysis {
  type: 'adverse-event-signal' | 'cohort-count';
  drug?: string; // medication of interest for the cohort
}

// Aggregate result — the ONLY thing allowed to leave the connector.
export interface AggregateResult {
  analysisType: string;
  cohortSize: number;
  buckets: { key: string; count: number; rate: number; suppressed?: boolean }[];
}

export type AccessOrigin = 'internal' | 'external';

export interface AccessContext {
  origin: AccessOrigin;
  actor: string;
}
