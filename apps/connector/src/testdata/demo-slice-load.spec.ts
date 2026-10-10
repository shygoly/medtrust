// Smoke: tracked demo slices load as internal_records + synthetic gold.
import * as fs from 'fs';
import * as path from 'path';
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { FhirGateway } from '../domain/fhir-gateway';
import { LocalStore } from '../domain/local-store';
import { LocalDataLoader } from '../domain/local-data-loader';
import { DataProductLocalSource } from '../domain/data-product-local-source';
import { LocalGoldStandardStore } from '../domain/local-gold-standard-store';
import { DEMO_GOLD_VARIABLE_DEFINITION_ID } from '../domain/injected-truth-gold';
import { defaultConnectorDataRoot } from '../domain/local-data-path';

const DEMOHOSPA = path.join(
  defaultConnectorDataRoot(),
  'data/demo/rws-injected/demohospa',
);

const hasDemoSlice = fs.existsSync(path.join(DEMOHOSPA, 'records.json'));

(hasDemoSlice ? describe : describe.skip)('demo rws-injected slices', () => {
  it('loads demohospa records + synthetic gold from truth.json', () => {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    const gold = new LocalGoldStandardStore();
    const source = new DataProductLocalSource(
      store,
      new LocalDataLoader(new Deidentifier(), new FhirGateway()),
      audit,
      undefined,
      gold,
    );

    const result = source.loadFromProduct({
      id: 'dp-insulin-panc-demohospa',
      providerId: 'p-demohospa',
      fhirSchema: { localDataPath: 'data/demo/rws-injected/demohospa' },
    });

    expect(result.format).toBe('internal_records');
    expect(result.records.length).toBe(5000);
    expect(result.goldIngested).toBe(5000);
    expect(gold.provenanceFor(DEMO_GOLD_VARIABLE_DEFINITION_ID)).toBe('synthetic');
    expect(store.count()).toBe(5000);
  });
});
