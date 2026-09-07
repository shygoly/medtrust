import * as fs from 'fs';
import * as path from 'path';
import { AuditService } from './audit';
import { Deidentifier } from './deidentifier';
import { FhirGateway } from './fhir-gateway';
import { LocalDataLoader } from './local-data-loader';
import { defaultConnectorDataRoot, resolveLocalDataPath } from './local-data-path';
import { LocalStore } from './local-store';
import { RwsExecutor } from './rws-executor';
import { SoftwareTee } from './tee';

/**
 * AMR synthetic → connector Q1 smoke (condition-prevalence).
 * Skips when generator output is absent (data/synthetic is gitignored).
 */
describe('AMR synthetic connector Q1', () => {
  const root = defaultConnectorDataRoot();
  const declared = 'data/synthetic/amr/connectors/huashan';
  const resolved = resolveLocalDataPath(declared, root);

  const available = fs.existsSync(path.join(resolved, 'records.json'));

  (available ? it : it.skip)('loads records.json and runs condition-prevalence', async () => {
    const loader = new LocalDataLoader(new Deidentifier(), new FhirGateway());
    const loaded = loader.loadFromDeclaredPath(declared, root);
    expect(loaded.format).toBe('internal_records');
    expect(loaded.records.length).toBeGreaterThan(100);

    const withResist = loaded.records.filter((r) =>
      r.conditions.some((c) => c.startsWith('resist:')),
    );
    expect(withResist.length).toBe(loaded.records.length);

    const withAe = loaded.records.filter((r) => r.adverseEvents.length > 0);
    if (withAe.length) {
      expect(
        withAe.every((r) =>
          r.adverseEvents.every(
            (e) =>
              typeof e.organSystem === 'string' &&
              typeof e.term === 'string' &&
              typeof e.serious === 'boolean',
          ),
        ),
      ).toBe(true);
    }

    const store = new LocalStore(new AuditService());
    store.replaceAll(loaded.records);
    const exec = new RwsExecutor(store, new Deidentifier(), new SoftwareTee());
    const agg = await exec.run({ type: 'condition-prevalence' }, 'amr-q1-huashan');
    expect(agg.analysisType).toBe('condition-prevalence');
    expect(agg.cohortSize).toBe(loaded.records.length);
    expect(agg.buckets?.length).toBeGreaterThan(5);

    // Organism-conditional MEM-R among kpn (CHINET ~22%)
    const nKpn = loaded.records.filter((r) => r.conditions.includes('organism:kpn')).length;
    const nMemR = loaded.records.filter((r) => r.conditions.includes('resist:kpn:MEM:R')).length;
    expect(nKpn).toBeGreaterThan(50);
    const rate = nMemR / nKpn;
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.4);
  });
});
