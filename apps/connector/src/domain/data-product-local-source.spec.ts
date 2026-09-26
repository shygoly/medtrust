import { AuditService } from './audit';
import { Deidentifier } from './deidentifier';
import { FhirGateway } from './fhir-gateway';
import { LocalStore } from './local-store';
import { LocalDataLoader } from './local-data-loader';
import { CdmAnalysisNotOpenError, DataProductLocalSource } from './data-product-local-source';
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

// omop-data-source-access task 4.1 —— 按声明的数据源类型分派，不可静默切换。
describe('DataProductLocalSource — 数据源类型分派（4.1）', () => {
  function recordsDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rws-product-dispatch-'));
    fs.writeFileSync(
      path.join(dir, 'records.json'),
      JSON.stringify([
        { subjectKey: 's-0', conditions: ['diabetes'], medications: ['metformin'], adverseEvents: [] },
      ]),
    );
    return dir;
  }

  function setup() {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    const loader = new LocalDataLoader(new Deidentifier(), new FhirGateway());
    const readSpy = jest.spyOn(loader, 'loadFromDeclaredPath');
    return { audit, store, readSpy, source: new DataProductLocalSource(store, loader, audit) };
  }

  it('CDM 产品：拒绝派发（omop-data-source-access D8），说明原因，且一个文件都不读', () => {
    const { audit, store, readSpy, source } = setup();
    const product = {
      id: 'dp-cdm',
      providerId: 'p-huashan',
      fhirSchema: { dataSource: { type: 'omop-cdm', label: 'main-cdm' } },
    };
    expect(() => source.loadFromProduct(product)).toThrow(CdmAnalysisNotOpenError);
    expect(() => source.loadFromProduct(product)).toThrow(/由 Circe 变更提供，当前未开放/);
    expect(() => source.loadFromProduct(product)).toThrow(/不会改用本地文件数据/);
    expect(readSpy).not.toHaveBeenCalled();
    expect(store.count()).toBe(0);
    const refused = audit.all().filter((e) => e.action === 'ingest' && !e.allowed);
    expect(refused[0]?.detail).toMatch(/source=omop-cdm:main-cdm/);
  });

  it('CDM 声明里残留文件路径：视为歧义直接拒绝——库不可用时不存在「改读文件」的退路', () => {
    const dir = recordsDir();
    const { store, readSpy, source } = setup();
    expect(() =>
      source.loadFromProduct({
        id: 'dp-cdm-ambiguous',
        providerId: 'p-huashan',
        fhirSchema: { dataSource: { type: 'omop-cdm', label: 'main-cdm' }, localDataPath: dir },
      }),
    ).toThrow(/数据源类型必须唯一/);
    expect(readSpy).not.toHaveBeenCalled();
    expect(store.count()).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('CDM 声明不许携带连接信息：凭据只在连接器侧配置（D-CN-6）', () => {
    const { source } = setup();
    expect(() =>
      source.loadFromProduct({
        id: 'dp-cdm-creds',
        providerId: 'p-huashan',
        fhirSchema: {
          dataSource: { type: 'omop-cdm', label: 'main-cdm', url: 'postgres://u:p@h/db' },
        },
      }),
    ).toThrow(/只允许 type 与 label/);
  });

  it('显式 file 声明与旧 localDataPath 等价', () => {
    const dir = recordsDir();
    const a = setup();
    const b = setup();
    const viaType = a.source.loadFromProduct({
      id: 'dp-file',
      providerId: 'p-huashan',
      fhirSchema: { dataSource: { type: 'file', path: dir } },
    });
    const viaLegacy = b.source.loadFromProduct({
      id: 'dp-legacy',
      providerId: 'p-huashan',
      fhirSchema: { localDataPath: dir },
    });
    expect(viaType.records).toEqual(viaLegacy.records);
    expect(a.store.count()).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('未知类型 / 没有任何声明：明确报错，不猜', () => {
    const { source } = setup();
    expect(() =>
      source.loadFromProduct({
        id: 'dp-mysql',
        providerId: 'p',
        fhirSchema: { dataSource: { type: 'mysql', label: 'x' } },
      }),
    ).toThrow(/未知的数据源类型「mysql」/);
    expect(() => source.loadFromProduct({ id: 'dp-none', providerId: 'p', fhirSchema: {} })).toThrow(
      /未声明数据源/,
    );
  });

  it('任务层：合约指向 CDM 产品 → 任务失败，执行器不被调用，不退回本地已有数据', async () => {
    const dir = recordsDir();
    const audit = new AuditService();
    const deid = new Deidentifier();
    const store = new LocalStore(audit);
    const loader = new LocalDataLoader(deid, new FhirGateway());
    const source = new DataProductLocalSource(store, loader, audit);
    // 本地已经物化过一份文件数据——恰恰是「静默改用」最容易发生的状态。
    source.loadFromProduct({ id: 'dp-file', providerId: 'p', fhirSchema: { localDataPath: dir } });
    expect(store.count()).toBe(1);
    source.registerProduct({
      id: 'dp-cdm',
      providerId: 'p',
      fhirSchema: { dataSource: { type: 'omop-cdm', label: 'main-cdm' } },
    });

    const executor = new RwsExecutor(store, deid);
    const run = jest.spyOn(executor, 'runWithExecution');
    const scratch = new TaskScratch();
    const runner = new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      executor,
      new OutputGate(audit, deid),
      scratch,
      new RetentionEnforcer(scratch, audit),
      source,
    );
    const contract: ContractView = {
      id: 'c-cdm',
      dataProductId: 'dp-cdm',
      purpose: '慢病真实世界研究',
      retention: '阅后即焚',
      output: '仅聚合',
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      status: 'active',
    };
    await expect(
      runner.run(
        { taskId: 't-cdm', purpose: '慢病真实世界研究', analysis: { type: 'condition-prevalence' } },
        contract,
      ),
    ).rejects.toThrow(CdmAnalysisNotOpenError);
    expect(run).not.toHaveBeenCalled();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
