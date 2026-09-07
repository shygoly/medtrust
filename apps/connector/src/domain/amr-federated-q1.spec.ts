import * as fs from 'fs';
import * as path from 'path';
import { AuditService } from './audit';
import { Deidentifier } from './deidentifier';
import { FhirGateway } from './fhir-gateway';
import { LocalDataLoader } from './local-data-loader';
import { LocalStore } from './local-store';
import { RwsExecutor } from './rws-executor';
import { OutputGate } from './output-gate';
import { PolicyEnforcementPoint } from './policy-enforcement';
import { TaskScratch } from './task-scratch';
import { RetentionEnforcer } from './retention';
import { ConnectorTaskRunner } from './connector-task-runner';
import { RwsOrchestrator } from './rws-orchestrator';
import { ContractView } from './contract-view';
import { defaultConnectorDataRoot } from './local-data-path';

const AMR_PURPOSE = '抗菌药物耐药监测真实世界研究';

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
    minCell: 5,
  };
}

function resistanceRate(
  buckets: { key: string; count: number }[],
  organism: string,
  drug: string,
): number | null {
  const nOrg = buckets.find((b) => b.key === `organism:${organism}`)?.count ?? 0;
  const nR = buckets.find((b) => b.key === `resist:${organism}:${drug}:R`)?.count ?? 0;
  return nOrg > 0 ? nR / nOrg : null;
}

describe('AMR federated Q1 (connector orchestration)', () => {
  const root = defaultConnectorDataRoot();
  const available =
    fs.existsSync(path.join(root, 'synthetic/amr/connectors/huashan/records.json')) ||
    fs.existsSync(
      path.resolve(__dirname, '../../../../data/synthetic/amr/connectors/huashan/records.json'),
    );

  (available ? it : it.skip)(
    'dual-hospital condition-prevalence merges without row egress',
    async () => {
      const build = (hospitalKey: 'huashan' | 'ruijin', id: string, org: string) => {
        const audit = new AuditService();
        const deid = new Deidentifier();
        const store = new LocalStore(audit);
        const loader = new LocalDataLoader(deid, new FhirGateway());
        const loaded = loader.loadFromDeclaredPath(
          `data/synthetic/amr/connectors/${hospitalKey}`,
          root,
        );
        expect(loaded.format).toBe('internal_records');
        store.replaceAll(loaded.records);
        const scratch = new TaskScratch();
        const runner = new ConnectorTaskRunner(
          new PolicyEnforcementPoint(audit),
          new RwsExecutor(store, deid),
          new OutputGate(audit, deid),
          scratch,
          new RetentionEnforcer(scratch, audit),
        );
        return { id, org, runner, store, n: loaded.records.length };
      };

      const huashan = build('huashan', 'p-huashan', '华山医院');
      const ruijin = build('ruijin', 'p-ruijin', '瑞金医院');

      for (const h of [huashan, ruijin]) {
        expect(() => h.store.exportRaw({ origin: 'external', actor: 'p-meddata' })).toThrow();
      }

      const contracts = new Map<string, ContractView>([
        [
          'p-huashan',
          amrContract(
            'seed:dp-amr-ast-huashan:p-meddata:抗菌药物耐药监测真实世界研究',
            'p-huashan',
            'dp-amr-ast-huashan',
          ),
        ],
        [
          'p-ruijin',
          amrContract(
            'seed:dp-amr-ast-ruijin:p-meddata:抗菌药物耐药监测真实世界研究',
            'p-ruijin',
            'dp-amr-ast-ruijin',
          ),
        ],
      ]);

      const orch = new RwsOrchestrator(new AuditService());
      const result = await orch.run(
        {
          taskId: 'rws-amr-q1-prevalence',
          purpose: AMR_PURPOSE,
          analysis: { type: 'condition-prevalence', level: 'L1' },
          initiator: 'p-meddata',
        },
        [huashan, ruijin],
        contracts,
      );

      expect(result.dispatched).toHaveLength(2);
      expect(result.merged.cohortSize).toBe(huashan.n + ruijin.n);
      expect(JSON.stringify(result.merged)).not.toContain('subjectKey');

      const kpnMem = resistanceRate(result.merged.buckets, 'kpn', 'MEM');
      expect(kpnMem).not.toBeNull();
      expect(kpnMem!).toBeGreaterThan(0.1);
      expect(kpnMem!).toBeLessThan(0.4);
      expect(result.attestation.taskHash).toMatch(/^SM3:/);
    },
    120_000,
  );
});
