import { FhirBundle } from '../domain/fhir-gateway';

// Mock hospital FHIR bundle — stands in for a real HIS/FHIR endpoint. Contains
// direct identifiers (name/phone/id) precisely so the demo can prove they get
// stripped and never leave the connector.
const ORGANS = ['肝胆系统', '血液系统', '胃肠系统', '神经系统'];

export function mockHospitalBundle(seed = 1, patients = 40): FhirBundle {
  const entry: NonNullable<FhirBundle['entry']> = [];
  let r = seed;
  const rand = () => (r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  for (let i = 0; i < patients; i++) {
    const pid = `P${1000 + i}`;
    const onDrug = rand() < 0.7; // 70% on the study drug
    entry.push({
      resource: {
        resourceType: 'Patient',
        id: pid,
        name: [{ text: `患者${i}` }],
        telecom: [{ system: 'phone', value: `138${String(10000000 + i).slice(-8)}` }],
        birthDate: `${1950 + Math.floor(rand() * 55)}-0${1 + (i % 9)}-15`,
        gender: rand() < 0.5 ? 'male' : 'female',
      },
    });
    if (onDrug) {
      entry.push({
        resource: {
          resourceType: 'MedicationStatement',
          subject: { reference: `Patient/${pid}` },
          code: { text: '注射用紫杉醇' },
        },
      });
      // some on-drug patients have adverse events
      if (rand() < 0.55) {
        entry.push({
          resource: {
            resourceType: 'AdverseEvent',
            subject: { reference: `Patient/${pid}` },
            code: { text: '不良反应' },
            organSystem: ORGANS[Math.floor(rand() * ORGANS.length)],
            serious: rand() < 0.3,
          },
        });
      }
    }
  }
  return { resourceType: 'Bundle', entry };
}
