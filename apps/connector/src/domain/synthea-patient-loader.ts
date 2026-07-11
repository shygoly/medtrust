import * as fs from 'fs';
import { RawPatientRecord } from './types';

/** Synthea connector slice: one JSON file per patient (not a FHIR Bundle). */
export function detectSyntheaPatientPayload(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.patientId === 'string' &&
    Array.isArray(o.conditions) &&
    Array.isArray(o.medications)
  );
}

function syntheaPatientToRaw(obj: Record<string, unknown>): RawPatientRecord {
  return {
    patientId: String(obj.patientId),
    name: typeof obj.name === 'string' ? obj.name : `SUBJ-${obj.patientId}`,
    birthDate: typeof obj.birthDate === 'string' ? obj.birthDate : '1970-01-01',
    gender: typeof obj.gender === 'string' ? obj.gender : undefined,
    conditions: (obj.conditions as string[]) ?? [],
    medications: (obj.medications as string[]) ?? [],
    adverseEvents: [],
  };
}

export function loadSyntheaPatientFile(filePath: string): RawPatientRecord[] {
  const obj = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  if (!detectSyntheaPatientPayload(obj)) {
    throw new Error(`非 Synthea patient JSON: ${filePath}`);
  }
  return [syntheaPatientToRaw(obj)];
}
