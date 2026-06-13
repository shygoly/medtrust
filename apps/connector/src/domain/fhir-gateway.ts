import { Injectable } from '@nestjs/common';
import { RawPatientRecord, AdverseEvent } from './types';

// FHIR 数据网关 (data-space-connector spec). Maps FHIR resources from the
// hospital source system into the connector's internal raw model. The mapped
// raw records stay in-process and are handed straight to the de-identifier;
// they are never sent anywhere.
@Injectable()
export class FhirGateway {
  // Accepts a (simplified) FHIR Bundle and returns raw patient records.
  fromBundle(bundle: FhirBundle): RawPatientRecord[] {
    const entries = bundle.entry ?? [];
    const patients = entries.filter((e) => e.resource?.resourceType === 'Patient');

    return patients.map((p) => {
      const res = p.resource as FhirPatient;
      const pid = res.id;
      const related = entries
        .map((e) => e.resource)
        .filter((r): r is FhirClinical => !!r && r.resourceType !== 'Patient' && r.subject?.reference === `Patient/${pid}`);

      return {
        patientId: pid,
        name: res.name?.[0]?.text ?? '',
        phone: res.telecom?.find((t) => t.system === 'phone')?.value,
        birthDate: res.birthDate ?? '',
        gender: res.gender,
        conditions: related.filter((r) => r.resourceType === 'Condition').map((r) => r.code?.text ?? ''),
        medications: related
          .filter((r) => r.resourceType === 'MedicationStatement')
          .map((r) => r.code?.text ?? ''),
        adverseEvents: related
          .filter((r) => r.resourceType === 'AdverseEvent')
          .map<AdverseEvent>((r) => ({
            organSystem: r.organSystem ?? '未分类',
            term: r.code?.text ?? '',
            serious: !!r.serious,
          })),
      };
    });
  }
}

// Minimal FHIR shapes — enough for the RWS pilot, not a full FHIR model.
export interface FhirBundle {
  resourceType: 'Bundle';
  entry?: { resource?: FhirResource }[];
}
type FhirResource = FhirPatient | FhirClinical;
interface FhirPatient {
  resourceType: 'Patient';
  id: string;
  name?: { text?: string }[];
  telecom?: { system?: string; value?: string }[];
  birthDate?: string;
  gender?: string;
}
interface FhirClinical {
  resourceType: 'Condition' | 'MedicationStatement' | 'AdverseEvent';
  subject?: { reference?: string };
  code?: { text?: string };
  organSystem?: string;
  serious?: boolean;
}
