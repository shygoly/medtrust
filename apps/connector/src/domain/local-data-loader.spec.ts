import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Deidentifier } from './deidentifier';
import { FhirGateway } from './fhir-gateway';
import { LocalDataLoader } from './local-data-loader';
import { parseDataSourceDeclaration } from '@medtrust/database';
import { resolveLocalDataPath } from './local-data-path';
import { defaultConnectorDataRoot } from './local-data-path';

describe('local-data-path', () => {
  it('legacy localDataPath / dataPath still declare a (trimmed) file source', () => {
    expect(parseDataSourceDeclaration({ localDataPath: '\tdata/foo\t' })).toEqual({
      type: 'file',
      path: 'data/foo',
    });
    expect(parseDataSourceDeclaration({ dataPath: '/data/synthea/ingested' })).toEqual({
      type: 'file',
      path: '/data/synthea/ingested',
    });
    expect(parseDataSourceDeclaration({})).toBeNull();
  });

  it('series-file declares path + opaque industry schema; malformed or mixed declarations fail closed (D-CN-8)', () => {
    expect(
      parseDataSourceDeclaration({
        dataSource: { type: 'series-file', path: 'power/meters.csv', schema: 'power.interval-meter@1' },
      }),
    ).toEqual({ type: 'series-file', path: 'power/meters.csv', schema: 'power.interval-meter@1' });
    expect(() =>
      parseDataSourceDeclaration({ dataSource: { type: 'series-file', path: 'm.csv' } }),
    ).toThrow();
    expect(() =>
      parseDataSourceDeclaration({
        dataSource: { type: 'series-file', path: 'm.csv', schema: 'Power Meter' },
      }),
    ).toThrow();
    expect(() =>
      parseDataSourceDeclaration({
        dataSource: { type: 'series-file', schema: 'power.interval-meter@1' },
      }),
    ).toThrow();
    expect(() =>
      parseDataSourceDeclaration({
        localDataPath: 'legacy',
        dataSource: { type: 'series-file', path: 'm.csv', schema: 'power.interval-meter@1' },
      }),
    ).toThrow();
    expect(() =>
      parseDataSourceDeclaration({
        dataSource: { type: 'series-file', path: 'm.csv', schema: 'power.interval-meter@1', label: 'x' },
      }),
    ).toThrow();
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
    const declared = 'data/synthea/hospitals/demohospb/fhir';
    if (!fs.existsSync(resolveLocalDataPath(declared, root))) {
      return;
    }
    const result = loader.loadFromDeclaredPath(declared, root);
    expect(result.format).toBe('fhir_bundle_synthea');
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records[0].medications.length).toBeGreaterThanOrEqual(0);
  });

  it('loads Synthea per-patient connector slice directory', () => {
    const declared = 'data/synthea/connectors/demohospa';
    if (!fs.existsSync(resolveLocalDataPath(declared, root))) {
      return;
    }
    const result = loader.loadFromDeclaredPath(declared, root);
    expect(result.format).toBe('synthea_patient');
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records[0].subjectKey).toMatch(/^sk_/);
  });

  it('loads injected InternalRecord records.json (D-DATA-1)', () => {
    const declared = 'data/rws-test-data';
    if (!fs.existsSync(resolveLocalDataPath(declared, root))) {
      return; // skip when generator output not present
    }
    const result = loader.loadFromDeclaredPath(declared, root);
    expect(result.format).toBe('internal_records');
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records[0].subjectKey).toMatch(/^(demohospa|demohospb)-/);
    // Injected AE are real pancreatitis terms — not comorbidity-derived 高血压 etc.
    const withAe = result.records.filter((r) => r.adverseEvents.length > 0);
    expect(withAe.length).toBeGreaterThan(0);
    expect(withAe.every((r) => r.adverseEvents.every((e) => e.term === 'acute pancreatitis'))).toBe(
      true,
    );
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

describe('LocalDataLoader — agent 模式下禁止本地脱敏（D-CN-9 / CTL-32）', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('CONNECTOR_DEID_MODE=agent → 需要脱敏的摄入分支抛 DEID_BYPASS_FORBIDDEN', () => {
    process.env.CONNECTOR_DEID_MODE = 'agent';
    const loader = new LocalDataLoader(new Deidentifier(), new FhirGateway());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deid-guard-'));
    const file = path.join(dir, 'patients.json');
    fs.writeFileSync(
      file,
      JSON.stringify([
        {
          patientId: 'p-1',
          name: '张三',
          phone: '13800138000',
          birthDate: '1990-01-01',
          gender: 'male',
          conditions: [],
          medications: [],
          adverseEvents: [],
          followUpDays: 1,
          eventOccurred: false,
        },
      ]),
      'utf-8',
    );
    expect(() => loader.loadFromDeclaredPath(file)).toThrow(/DEID_BYPASS_FORBIDDEN/);
  });

  it('builtin 模式照常可脱敏（缺省行为不变）', () => {
    process.env.CONNECTOR_DEID_MODE = 'builtin';
    const loader = new LocalDataLoader(new Deidentifier(), new FhirGateway());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deid-guard-'));
    const file = path.join(dir, 'records.json');
    fs.writeFileSync(
      file,
      JSON.stringify([
        { subjectKey: 'sk_1', ageBand: '30-39', sex: 'male', conditions: [], medications: [], adverseEvents: [], followUpDays: 1, eventOccurred: false },
      ]),
      'utf-8',
    );
    expect(loader.loadFromDeclaredPath(file).records).toHaveLength(1);
  });
});
