import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveAdverseEvents,
  shouldDeriveAdverseEvents,
  loadSyntheaPatientFile,
} from './synthea-patient-loader';

describe('synthea-patient-loader — injected AE (D-DATA-1 Task 4)', () => {
  const injectedAe = [
    { organSystem: '消化系统', term: '急性胰腺炎', serious: true },
  ];

  it('shouldDeriveAdverseEvents is off by default; on with MEDTRUST_DERIVE_AE=1', () => {
    expect(shouldDeriveAdverseEvents({})).toBe(false);
    expect(shouldDeriveAdverseEvents({ MEDTRUST_DERIVE_AE: '1' })).toBe(true);
    expect(shouldDeriveAdverseEvents({ MEDTRUST_DERIVE_AE: 'true' })).toBe(true);
  });

  it('prefers payload adverseEvents over comorbidity derivation', () => {
    const ae = resolveAdverseEvents(
      {
        patientId: 'p1',
        conditions: ['Hypertension', 'Diabetes mellitus'],
        medications: ['metformin'],
        adverseEvents: injectedAe,
      },
      ['Hypertension', 'Diabetes mellitus'],
      {},
    );
    expect(ae).toEqual(injectedAe);
  });

  it('empty adverseEvents array is respected (no AE — not a fallthrough)', () => {
    const ae = resolveAdverseEvents(
      {
        patientId: 'p1',
        conditions: ['Hypertension'],
        medications: [],
        adverseEvents: [],
      },
      ['Hypertension'],
      {},
    );
    expect(ae).toEqual([]);
  });

  it('falls back to derive when AE field is absent', () => {
    const ae = resolveAdverseEvents(
      {
        patientId: 'p1',
        conditions: ['Essential hypertension (disorder)'],
        medications: [],
      },
      ['Essential hypertension (disorder)'],
      {},
    );
    expect(ae.some((e) => e.term === '高血压')).toBe(true);
  });

  it('MEDTRUST_DERIVE_AE=1 forces comorbidity derivation even when AE present', () => {
    const ae = resolveAdverseEvents(
      {
        patientId: 'p1',
        conditions: ['Essential hypertension (disorder)'],
        medications: [],
        adverseEvents: injectedAe,
      },
      ['Essential hypertension (disorder)'],
      { MEDTRUST_DERIVE_AE: '1' },
    );
    expect(ae.some((e) => e.term === '急性胰腺炎')).toBe(false);
    expect(ae.some((e) => e.term === '高血压')).toBe(true);
  });

  it('loadSyntheaPatientFile keeps injected AE on the raw record', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'medtrust-ae-'));
    const file = path.join(dir, 'patient.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        patientId: 'inj-1',
        name: 'Test',
        birthDate: '1970-01-01',
        conditions: ['diabetes'],
        medications: ['insulin'],
        adverseEvents: injectedAe,
      }),
    );
    const [raw] = loadSyntheaPatientFile(file);
    expect(raw.adverseEvents).toEqual(injectedAe);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
