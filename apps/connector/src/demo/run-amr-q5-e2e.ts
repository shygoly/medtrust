/* eslint-disable no-console */
/**
 * AMR Sentinel — Q5 / L0 algorithm external validation (PAPER P2, thin).
 *
 * Dual-hospital validation of a closed-grammar rule for CRE phenotype
 * (condition contains "cre"), scored against synthetic gold derived from
 * the same labels (provenance=synthetic — NOT for regulatory submission).
 *
 * Emphasizes: per-site ValidationResult columns (D6, never merge metrics),
 * OutputGate on confusion-matrix cells, synthetic provenance flag.
 *
 * Run: pnpm --filter @medtrust/connector demo:amr-q5
 */
import * as fs from 'fs';
import * as path from 'path';
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { FhirGateway } from '../domain/fhir-gateway';
import { LocalDataLoader } from '../domain/local-data-loader';
import { LocalStore } from '../domain/local-store';
import { OutputGate } from '../domain/output-gate';
import { LocalGoldStandardStore } from '../domain/local-gold-standard-store';
import { AlgorithmValidationExecutor } from '../domain/algorithm-validation-executor';
import { SoftwareSealedCompute } from '../domain/tee';
import { defaultConnectorDataRoot } from '../domain/local-data-path';
import { IdentificationAlgorithm, InternalRecord, ValidationResult } from '../domain/types';

const REPO = path.resolve(__dirname, '../../../..');
const VAR = 'cre-phenotype';
const GOLD_VER = 'amr-syn-cre-v1';

const algo: IdentificationAlgorithm = {
  id: 'amr-cre-rule',
  version: '1.0.0',
  expression: {
    kind: 'codeset',
    codeset: {
      codeSystem: 'AMR-CONDITION',
      codeSystemVersion: 'demo-v1',
      codes: ['cre'],
      valueSource: 'discharge_dx',
      diagnosisOrder: 'any',
    },
  },
};

function loadHospital(key: 'demohospa' | 'demohospb'): InternalRecord[] {
  const loader = new LocalDataLoader(new Deidentifier(), new FhirGateway());
  const loaded = loader.loadFromDeclaredPath(
    `data/synthetic/amr/connectors/${key}`,
    defaultConnectorDataRoot(),
  );
  if (loaded.format !== 'internal_records') throw new Error(key);
  return loaded.records;
}

function goldFromCreLabels(rows: InternalRecord[]) {
  return rows.map((r) => ({
    subjectKey: r.subjectKey,
    variableDefinitionId: VAR,
    judgment: (r.conditions.includes('cre') ? 'positive' : 'negative') as 'positive' | 'negative',
    source: 'synthetic' as const,
    goldStandardSetVersion: GOLD_VER,
  }));
}

function runSite(
  providerId: string,
  rows: InternalRecord[],
): ValidationResult {
  const audit = new AuditService();
  const store = new LocalStore(audit);
  store.replaceAll(rows);
  const goldStore = new LocalGoldStandardStore();
  goldStore.replaceAll(goldFromCreLabels(rows));
  const executor = new AlgorithmValidationExecutor(
    store,
    new OutputGate(audit, new Deidentifier()),
    goldStore,
    new SoftwareSealedCompute(),
  );
  const out = executor.run(
    {
      type: 'algorithm-validation',
      level: 'L0',
      algorithm: algo,
      variableDefinitionId: VAR,
      goldStandardSetVersion: GOLD_VER,
      allowedArtifacts: ['validation_metrics'],
    },
    providerId,
    `amr-q5-${providerId}`,
  );
  if (!out.validationResult) throw new Error('missing validationResult');
  return out.validationResult;
}

function main(): void {
  const manifest = path.join(REPO, 'data/synthetic/amr/connectors/manifest.json');
  if (!fs.existsSync(manifest)) {
    console.error('Missing connectors — build_amr_connectors.py');
    process.exit(1);
  }

  console.log('=== AMR Sentinel · Q5（算法外验证 L0，分列）===\n');
  console.log('算法: codeset cre · 金标准: synthetic from same labels');
  console.log('PAPER: provenance=synthetic → 不得作监管申报');
  console.log('注: CRE 稀有时混淆矩阵小格可能触发 OutputGate 抑制（仍为合法外验证行为）\n');

  const sites: Array<{ id: string; key: 'demohospa' | 'demohospb' }> = [
    { id: 'p-demohospa', key: 'demohospa' },
    { id: 'p-demohospb', key: 'demohospb' },
  ];

  for (const s of sites) {
    const rows = loadHospital(s.key);
    const vr = runSite(s.id, rows);
    console.log(`--- ${s.id} ---`);
    console.log(`  nGold≈ cohort  provenance=${vr.goldStandardProvenance} suppressed=${vr.suppressed}`);
    if (vr.suppressed) {
      console.log(`  suppressionReason=${vr.suppressionReason}`);
    } else if (vr.metrics) {
      console.log(
        `  Se=${vr.metrics.sensitivity.point.toFixed(3)} Sp=${vr.metrics.specificity.point.toFixed(3)} ` +
          `PPV=${vr.metrics.ppv.point.toFixed(3)} NPV=${vr.metrics.npv.point.toFixed(3)}`,
      );
    }
    if (vr.goldStandardProvenance !== 'synthetic') {
      throw new Error('expected synthetic provenance');
    }
    // Self-labeled rule is near-perfect when cells clear minCell; rare CRE may suppress.
    if (!vr.suppressed && vr.metrics) {
      if (vr.metrics.sensitivity.point < 0.99 || vr.metrics.specificity.point < 0.99) {
        throw new Error('self-labeled CRE rule should be near-perfect on synthetic gold');
      }
    } else if (vr.suppressed) {
      console.log('  (小格抑制 — 外验证闸门行为，非失败)');
    }
  }

  console.log('\n分列验证 ✓ · 禁止合并指标 ✓ · demo:amr-q5 PASS');
}

main();
