import { AuditService } from './audit';
import { Deidentifier } from './deidentifier';
import { FhirGateway } from './fhir-gateway';
import { LocalStore } from './local-store';
import { LocalDataLoader } from './local-data-loader';
import { DataProductLocalSource } from './data-product-local-source';
import { ConnectorTaskRunner } from './connector-task-runner';
import { PolicyEnforcementPoint } from './policy-enforcement';
import { RwsExecutor } from './rws-executor';
import { OutputGate } from './output-gate';
import { TaskScratch } from './task-scratch';
import { RetentionEnforcer } from './retention';
import { ContractView } from './contract-view';
import { LocalGoldStandardStore } from './local-gold-standard-store';
import { DEMO_GOLD_VARIABLE_DEFINITION_ID } from './injected-truth-gold';
import { defaultConnectorDataRoot } from './local-data-path';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveLocalDataPath } from './local-data-path';

describe('DataProductLocalSource', () => {
  const declared = 'data/synthea/ingested-clinical-text';
  const root = defaultConnectorDataRoot();
  const dataExists = fs.existsSync(resolveLocalDataPath(declared, root));

  it('loads any product with fhirSchema.localDataPath into LocalStore', () => {
    if (!dataExists) return;

    const audit = new AuditService();
    const store = new LocalStore(audit);
    const loader = new LocalDataLoader(new Deidentifier(), new FhirGateway());
    const source = new DataProductLocalSource(store, loader, audit);

    const product = {
      id: 'test-product-uuid',
      providerId: 'p-ruijin',
      fhirSchema: { localDataPath: declared },
    };

    const result = source.loadFromProduct(product);
    expect(result.productId).toBe('test-product-uuid');
    expect(store.count()).toBe(result.records.length);
    expect(store.count()).toBeGreaterThan(0);

    // idempotent second load
    source.loadFromProduct(product);
    expect(store.count()).toBe(result.records.length);
  });

  it('wires into ConnectorTaskRunner via contract.dataProductId', async () => {
    if (!dataExists) return;

    const audit = new AuditService();
    const deid = new Deidentifier();
    const store = new LocalStore(audit);
    const loader = new LocalDataLoader(deid, new FhirGateway());
    const source = new DataProductLocalSource(store, loader, audit);
    source.registerProduct({
      id: 'cb7d2f5f-demo',
      providerId: 'p-ruijin',
      fhirSchema: { localDataPath: declared },
    });

    const scratch = new TaskScratch();
    const runner = new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      new RwsExecutor(store, deid),
      new OutputGate(audit, deid),
      scratch,
      new RetentionEnforcer(scratch, audit),
      source,
    );

    const contract: ContractView = {
      id: 'c-demo',
      dataProductId: 'cb7d2f5f-demo',
      purpose: '慢病真实世界研究',
      retention: '阅后即焚',
      output: '仅聚合',
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      status: 'active',
    };

    const agg = await runner.run(
      {
        taskId: 't-local-path',
        purpose: '慢病真实世界研究',
        analysis: { type: 'condition-prevalence' },
      },
      contract,
    );

    expect(agg.cohortSize).toBeGreaterThan(0);
    expect(agg.buckets.length).toBeGreaterThan(0);
  });

  it('ingests sibling truth.json into LocalGoldStandardStore as synthetic', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rws-product-gold-'));
    fs.writeFileSync(
      path.join(dir, 'records.json'),
      JSON.stringify([
        {
          subjectKey: 'huashan-0',
          conditions: ['diabetes'],
          medications: ['insulin'],
          adverseEvents: [],
        },
      ]),
    );
    fs.writeFileSync(
      path.join(dir, 'truth.json'),
      JSON.stringify([{ subjectKey: 'huashan-0', truePancreatitis: true, site: 'huashan' }]),
    );

    const audit = new AuditService();
    const store = new LocalStore(audit);
    const gold = new LocalGoldStandardStore();
    const loader = new LocalDataLoader(new Deidentifier(), new FhirGateway());
    const source = new DataProductLocalSource(store, loader, audit, undefined, gold);

    const result = source.loadFromProduct({
      id: 'dp-demo-injected',
      providerId: 'p-huashan',
      fhirSchema: { localDataPath: dir },
    });

    expect(result.goldIngested).toBe(1);
    expect(gold.count()).toBe(1);
    expect(gold.provenanceFor(DEMO_GOLD_VARIABLE_DEFINITION_ID)).toBe('synthetic');
    expect(gold.findByVariableDefinition(DEMO_GOLD_VARIABLE_DEFINITION_ID)[0].judgment).toBe(
      'positive',
    );

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
