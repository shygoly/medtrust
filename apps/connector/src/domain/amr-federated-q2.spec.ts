/**
 * AMR Q2 — gate-then-merge vs merge-then-gate unlock.
 */
import * as fs from 'fs';
import { createTestMdopExecutor } from '../test/mdop-local-executor';
import * as path from 'path';
import { AuditService } from './audit';
import { Deidentifier } from './deidentifier';
import { FhirGateway } from './fhir-gateway';
import { LocalDataLoader } from './local-data-loader';
import { LocalStore } from './local-store';
import { RwsExecutor } from './rws-executor';
import { OutputGate, DEFAULT_MIN_CELL } from './output-gate';
import { PolicyEnforcementPoint } from './policy-enforcement';
import { TaskScratch } from './task-scratch';
import { RetentionEnforcer } from './retention';
import { ConnectorTaskRunner } from './connector-task-runner';
import { RwsOrchestrator } from './rws-orchestrator';
import { ContractView } from './contract-view';
import { defaultConnectorDataRoot } from './local-data-path';

const AMR_PURPOSE = '抗菌药物耐药监测真实世界研究';
const RARE_KEY = 'rare_colistin_r_aba';
const MIN_CELL = DEFAULT_MIN_CELL;

function amrContract(id: string, providerId: string, dataProductId: string): ContractView {
  return {
    id,
    dataProductId,
    purpose: AMR_PURPOSE,
    retention: '阅后即焚',
    output: '仅聚合',
    validUntil: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    status: 'active',
    pricing: { model: 'per-record', amount: 1, currency: 'CNY' },
    providerId,
    consumerId: 'p-meddata',
    allowedLevels: ['L1', 'L1.5', 'L2', 'L3'],
    allowedArtifacts: ['condition_prevalence', 'cohort_count'],
    minCell: MIN_CELL,
  };
}

describe('AMR federated Q2 (small-cell narratives)', () => {
  const root = defaultConnectorDataRoot();
  const available =
    fs.existsSync(path.join(root, 'synthetic/amr/connectors/demohospa/records.json')) ||
    fs.existsSync(
      path.resolve(__dirname, '../../../../data/synthetic/amr/connectors/demohospa/records.json'),
    );

  function build(hospitalKey: 'demohospa' | 'demohospb', id: string, org: string) {
    const audit = new AuditService();
    const deid = new Deidentifier();
    const store = new LocalStore(audit);
    const loader = new LocalDataLoader(deid, new FhirGateway());
    const loaded = loader.loadFromDeclaredPath(
      `data/synthetic/amr/connectors/${hospitalKey}`,
      root,
    );
    store.replaceAll(loaded.records);
    const rawRare = loaded.records.filter((r) => r.conditions.includes(RARE_KEY)).length;
    const gate = new OutputGate(audit, deid);
    const scratch = new TaskScratch();
    const runner = new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      createTestMdopExecutor({ id: 'spec-amr-federated-q2', store, categoryKeys: [...new Set(store.aggregateInternal({ origin: 'internal', actor: 'spec' }, (rows) => rows.flatMap((r) => r.conditions ?? [])))].concat('无明确慢病标签') }),
      gate,
      scratch,
      new RetentionEnforcer(scratch, audit),
    );
    return { id, org, runner, n: loaded.records.length, rawRare, gate };
  }

  (available ? it : it.skip)(
    'gate-then-merge: both-under loses rare OR asymmetric keeps demohospb',
    async () => {
      const demohospa = build('demohospa', 'p-demohospa', '示范甲医院');
      const demohospb = build('demohospb', 'p-demohospb', '示范乙医院');
      const bothUnder =
        demohospa.rawRare > 0 &&
        demohospa.rawRare < MIN_CELL &&
        demohospb.rawRare > 0 &&
        demohospb.rawRare < MIN_CELL;
      const asymmetric =
        demohospa.rawRare > 0 &&
        demohospa.rawRare < MIN_CELL &&
        demohospb.rawRare >= MIN_CELL;
      expect(bothUnder || asymmetric).toBe(true);

      const contracts = new Map<string, ContractView>([
        [
          'p-demohospa',
          amrContract(
            'seed:dp-amr-ast-demohospa:p-meddata:抗菌药物耐药监测真实世界研究',
            'p-demohospa',
            'dp-amr-ast-demohospa',
          ),
        ],
        [
          'p-demohospb',
          amrContract(
            'seed:dp-amr-ast-demohospb:p-meddata:抗菌药物耐药监测真实世界研究',
            'p-demohospb',
            'dp-amr-ast-demohospb',
          ),
        ],
      ]);

      const orch = new RwsOrchestrator(new AuditService());
      const result = await orch.run(
        {
          taskId: 'rws-amr-q2-small-cell',
          purpose: AMR_PURPOSE,
          analysis: { type: 'condition-prevalence', level: 'L1' },
          initiator: 'p-meddata',
        },
        [demohospa, demohospb],
        contracts,
      );

      const hsRare = result.perNode.find((p) => p.org === '示范甲医院')!.aggregate.buckets.find(
        (b) => b.key === RARE_KEY,
      )!;
      const rjRare = result.perNode.find((p) => p.org === '示范乙医院')!.aggregate.buckets.find(
        (b) => b.key === RARE_KEY,
      )!;
      const mergedRare = result.merged.buckets.find((b) => b.key === RARE_KEY);

      expect(hsRare.count).toBe(0);
      expect(hsRare.suppressed).toBe(true);

      if (bothUnder) {
        expect(rjRare.count).toBe(0);
        expect(rjRare.suppressed).toBe(true);
        expect(mergedRare?.count ?? 0).toBe(0);
      } else {
        expect(rjRare.count).toBeGreaterThanOrEqual(MIN_CELL);
        expect(mergedRare!.count).toBe(rjRare.count);
      }
    },
    120_000,
  );

  (available ? it : it.skip)(
    'merge-then-gate unlocks when both sites raw < minCell',
    async () => {
      const demohospa = build('demohospa', 'p-demohospa', '示范甲医院');
      const demohospb = build('demohospb', 'p-demohospb', '示范乙医院');
      if (
        !(
          demohospa.rawRare > 0 &&
          demohospa.rawRare < MIN_CELL &&
          demohospb.rawRare > 0 &&
          demohospb.rawRare < MIN_CELL &&
          demohospa.rawRare + demohospb.rawRare >= MIN_CELL
        )
      ) {
        console.warn('skip unlock: rare counts not in both-under band');
        return;
      }

      const contracts = new Map<string, ContractView>([
        [
          'p-demohospa',
          amrContract(
            'seed:dp-amr-ast-demohospa:p-meddata:抗菌药物耐药监测真实世界研究',
            'p-demohospa',
            'dp-amr-ast-demohospa',
          ),
        ],
        [
          'p-demohospb',
          amrContract(
            'seed:dp-amr-ast-demohospb:p-meddata:抗菌药物耐药监测真实世界研究',
            'p-demohospb',
            'dp-amr-ast-demohospb',
          ),
        ],
      ]);

      const audit = new AuditService();
      const orch = new RwsOrchestrator(audit);
      const unlock = await orch.runMergeThenGate(
        {
          taskId: 'rws-amr-q2-unlock',
          purpose: AMR_PURPOSE,
          analysis: { type: 'condition-prevalence', level: 'L1' },
          initiator: 'p-meddata',
        },
        [demohospa, demohospb],
        contracts,
        new OutputGate(new AuditService(), new Deidentifier()),
      );

      const mergedRare = unlock.merged.buckets.find((b) => b.key === RARE_KEY)!;
      expect(mergedRare.count).toBe(demohospa.rawRare + demohospb.rawRare);
      expect(mergedRare.count).toBeGreaterThanOrEqual(MIN_CELL);
      expect(mergedRare.suppressed).toBeFalsy();
      expect(audit.all().some((e) => e.action === 'merge-then-gate')).toBe(true);
    },
    120_000,
  );
});
