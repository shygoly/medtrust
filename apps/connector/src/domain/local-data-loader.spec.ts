import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Deidentifier } from './deidentifier';
import { FhirGateway } from './fhir-gateway';
import { LocalDataLoader } from './local-data-loader';
import { extractLocalDataPath, resolveLocalDataPath } from './local-data-path';
import { defaultConnectorDataRoot } from './local-data-path';

describe('local-data-path', () => {
  it('extracts and trims localDataPath from fhirSchema', () => {
    expect(extractLocalDataPath({ localDataPath: '\tdata/foo\t' })).toBe('data/foo');
    expect(extractLocalDataPath({ dataPath: '/data/synthea/ingested' })).toBe(
      '/data/synthea/ingested',
    );
    expect(extractLocalDataPath({})).toBeNull();
  });

  it('resolves /data/... relative to connector data root', () => {
    const root = defaultConnectorDataRoot();
    const resolved = resolveLocalDataPath('/data/synthea/ingested-clinical-text', root);
    expect(resolved).toContain('data');
    expect(resolved).toContain('ingested-clinical-text');
  });
});

describe('LocalDataLoader — generic local path ingest', () => {
  const deid = new Deidentifier();
  const loader = new LocalDataLoader(deid, new FhirGateway());
  const root = defaultConnectorDataRoot();

  it('loads clinical_text directory from declared path', () => {
    const declared = 'data/synthea/ingested-clinical-text';
    if (!fs.existsSync(resolveLocalDataPath(declared, root))) {
      return; // skip when demo data not present
    }
    const result = loader.loadFromDeclaredPath(declared, root);
    expect(result.format).toBe('clinical_text');
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records[0].subjectKey).toMatch(/^sk_/);
    expect(result.records[0].ageBand).toBeTruthy();
  });

  it('loads FHIR bundle directory (Synthea hospital split)', () => {
    const declared = 'data/synthea/hospitals/ruijin/fhir';
    if (!fs.existsSync(resolveLocalDataPath(declared, root))) {
      return;
    }
    const result = loader.loadFromDeclaredPath(declared, root);
    expect(result.format).toBe('fhir_bundle_synthea');
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records[0].medications.length).toBeGreaterThanOrEqual(0);
  });

  it('loads Synthea per-patient connector slice directory', () => {
    const declared = 'data/synthea/connectors/huashan';
    if (!fs.existsSync(resolveLocalDataPath(declared, root))) {
      return;
    }
    const result = loader.loadFromDeclaredPath(declared, root);
    expect(result.format).toBe('synthea_patient');
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records[0].subjectKey).toMatch(/^sk_/);
  });

  it('loads a single JSON file from temp dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'medtrust-local-'));
    const file = path.join(dir, 'patient-a.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        modality: 'clinical_text',
        patientId: 'p1',
        subjectKey: 'SUBJ-p1',
        demographics: { ageBand: '30-39', sex: 'male' },
        notes: [
          {
            note_id: 'n1',
            nephrology_impression: 'chronic kidney disease follow-up',
            sections: { chief_complaint: 'edema', medications: 'ACE inhibitor' },
          },
        ],
      }),
    );

    const result = loader.loadFromAbsolutePath(dir);
    expect(result.format).toBe('clinical_text');
    expect(result.records).toHaveLength(1);
    expect(result.records[0].conditions).toContain('慢性肾病');
    expect(result.records[0].medications).toContain('ACE inhibitor');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
