import * as fs from 'fs';
import { AdverseEvent, InternalRecord } from './types';

/**
 * Injected RWS test records (D-DATA-1): already-deidentified InternalRecord[]
 * with real adverseEvents from the TS injection layer — no FHIR/deid pass.
 */

function isAdverseEvent(v: unknown): v is AdverseEvent {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.organSystem === 'string' &&
    typeof o.term === 'string' &&
    typeof o.serious === 'boolean'
  );
}

function isInternalRecord(v: unknown): v is InternalRecord {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.subjectKey === 'string' &&
    Array.isArray(o.conditions) &&
    Array.isArray(o.medications) &&
    Array.isArray(o.adverseEvents)
  );
}

/** Detect a single InternalRecord or an array of them (e.g. records.json). */
export function detectInternalRecordsPayload(obj: unknown): boolean {
  if (Array.isArray(obj)) {
    return obj.length > 0 && obj.every(isInternalRecord);
  }
  return isInternalRecord(obj);
}

function normalizeRecord(r: InternalRecord): InternalRecord {
  return {
    ...r,
    adverseEvents: (r.adverseEvents as unknown[]).filter(isAdverseEvent),
    conditions: [...r.conditions],
    medications: [...r.medications],
  };
}

export function loadInternalRecordsFile(filePath: string): InternalRecord[] {
  const obj = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
  if (!detectInternalRecordsPayload(obj)) {
    throw new Error(`非 InternalRecord JSON: ${filePath}`);
  }
  if (Array.isArray(obj)) {
    return obj.map(normalizeRecord);
  }
  return [normalizeRecord(obj as InternalRecord)];
}
