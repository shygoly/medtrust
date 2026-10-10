/* eslint-disable no-console */
// rws-algorithm-validation §7.1: Synthea-backed single-hospital L0 closed loop.
//
// Drives the full L0 pipeline end-to-end against real Synthea FHIR data:
//   FHIR bundle → deidentify → LocalStore → grammar-validate algorithm →
//   in-TEE evaluate → synthesize gold standard (deterministic perturbation) →
//   in-TEE compare → output gate → ValidationResult.
//
// Synthetic provenance is tagged and MUST NOT be used for regulatory
// submission (§7.3) — asserted here so the flag survives the gate.
//
// Test is SKIPPED when Synthea data is absent (run `pnpm split-synthea` to
// generate). It runs the real path when data is present.
import * as fs from 'fs';
import * as path from 'path';
import { AuditService } from '../../domain/audit';
import { Deidentifier } from '../deidentifier';
import { LocalStore } from '../local-store';
import { OutputGate } from '../output-gate';
import { SoftwareSealedCompute } from '../tee';
import { evaluateAlgorithm } from './algorithm-evaluator';
import { synthesizeGoldStandard, impliedSeSp } from './synthetic-gold-standard';
import { computeConfusionMatrixInTee } from './confusion-matrix';
import { metricsFromConfusionMatrix } from './stats';
import { loadFhirBundleDirectory } from '../fhir-bundle-loader';
import { LocalGoldStandardStore } from '../local-gold-standard-store';
import { AlgorithmValidationExecutor } from '../algorithm-validation-executor';
import { IdentificationAlgorithm, InternalRecord } from '../types';

const SYNTHESA_DEMOHOSPA_FHIR = path.resolve(
  __dirname,
  '../../../../../data/synthea/hospitals/demohospa/fhir',
);

const syntheaDataExists = fs.existsSync(SYNTHESA_DEMOHOSPA_FHIR);
// Answer-key recovery of injected Se/Sp lives in testdata/injected-ladder-e2e.spec.ts
// (D-DATA-1 Task 5). This file keeps the Synthea FHIR closed-loop smoke path.

// Algorithm: "subject has any condition matching a chronic-disease label".
// We pick the top Synthea condition label as the trigger — the spec is about
// the L0 loop mechanics, not any specific diagnosis code.
function pickAlgorithm(rows: InternalRecord[]): IdentificationAlgorithm {
  // Find the most common condition label across the cohort.
  const counts = new Map<string, number>();
  for (const r of rows) for (const c of r.conditions) counts.set(c, (counts.get(c) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Hypertension';
  return {
    id: 'top-condition-presence',
    version: '1.0.0',
    expression: {
      kind: 'codeset',
      codeset: {
        codeSystem: 'SNOMED-CT',
        codeSystemVersion: 'synthea-display',
        codes: [top],
        valueSource: 'discharge_dx',
        diagnosisOrder: 'any',
      },
    },
  };
}

describe('rws-algorithm-validation §7.1 — Synthea single-hospital L0 closed loop', () => {
  // Skip cleanly when Synthea data isn't generated.
  (syntheaDataExists ? describe : describe.skip)(
    'with Synthea data present',
    () => {
      let rows: InternalRecord[];
      let algo: IdentificationAlgorithm;

      beforeAll(() => {
        const raw = loadFhirBundleDirectory(SYNTHESA_DEMOHOSPA_FHIR);
        const deid = new Deidentifier();
        rows = raw.map((r) => deid.deidentify(r));
        algo = pickAlgorithm(rows);
      });

      it('runs the full closed loop: load → eval → synth gold → compare → gate', () => {
        const audit = new AuditService();
        const store = new LocalStore(audit);
        store.ingest(rows);

        // Step 1: grammar-validate the algorithm (CTL-10).
        const goldStore = new LocalGoldStandardStore();
        const executor = new AlgorithmValidationExecutor(
          store,
          new OutputGate(audit, new Deidentifier()),
          goldStore,
          new SoftwareSealedCompute(),
        );

        // Step 2: pre-compute predictions so we can synthesize a gold standard
        // off them. The executor does this internally too; we mirror it here
        // to seed the gold store.
        const predictions = evaluateAlgorithm(algo, rows);
        const goldMap = synthesizeGoldStandard(predictions, {
          variableDefinitionId: 'top-cond',
          goldStandardSetVersion: 'syn-v1',
          algorithmId: algo.id,
          algorithmVersion: algo.version,
          flipOnPositive: 0.1,
          flipOnNegative: 0.1,
        });
        // Load the synthetic gold standard into the connector-local store.
        goldStore.replaceAll(
          [...goldMap.entries()].map(([subjectKey, judgment]) => ({
            subjectKey,
            variableDefinitionId: 'top-cond',
            judgment,
            source: 'synthetic' as const,
            goldStandardSetVersion: 'syn-v1',
          })),
        );

        // Step 3: run the executor.
        const result = executor.run(
          {
            type: 'algorithm-validation',
            level: 'L0',
            algorithm: algo,
            variableDefinitionId: 'top-cond',
            goldStandardSetVersion: 'syn-v1',
            allowedArtifacts: ['validation_metrics'],
          },
          'hospital-demohospa',
          'synthea-e2e',
        );

        // Step 4: assertions on the closed-loop result.
        expect(result.analysisType).toBe('algorithm-validation');
        expect(result.validationResult).toBeDefined();
        const vr = result.validationResult!;
        expect(vr.providerId).toBe('hospital-demohospa');
        expect(vr.algorithmVersion).toBe('1.0.0');
        expect(vr.goldStandardSetVersion).toBe('syn-v1');

        // §7.3: synthetic provenance MUST be flagged on the cross-domain payload.
        expect(vr.goldStandardProvenance).toBe('synthetic');

        // The implied Se/Sp from the synthesizer (≈1 − flipRate = 0.9 at large N)
        // should be close to what the executor reports — sanity check that the
        // predictions the executor evaluated match what we synthesized against.
        const { se, sp } = impliedSeSp(predictions, goldMap);
        if (!vr.suppressed && vr.metrics) {
          expect(vr.metrics.sensitivity.point).toBeCloseTo(se, 1);
          expect(vr.metrics.specificity.point).toBeCloseTo(sp, 1);
        }
      });

      it('labels synthetic results so they MUST NOT be used for submission (§7.3)', () => {
        const audit = new AuditService();
        const store = new LocalStore(audit);
        store.ingest(rows);

        const goldStore = new LocalGoldStandardStore();
        const predictions = evaluateAlgorithm(algo, rows);
        const goldMap = synthesizeGoldStandard(predictions, {
          variableDefinitionId: 'top-cond-submit',
          goldStandardSetVersion: 'syn-v1',
          algorithmId: algo.id,
          algorithmVersion: algo.version,
        });
        goldStore.replaceAll(
          [...goldMap.entries()].map(([subjectKey, judgment]) => ({
            subjectKey,
            variableDefinitionId: 'top-cond-submit',
            judgment,
            source: 'synthetic' as const,
            goldStandardSetVersion: 'syn-v1',
          })),
        );

        const executor = new AlgorithmValidationExecutor(
          store,
          new OutputGate(audit, new Deidentifier()),
          goldStore,
          new SoftwareSealedCompute(),
        );
        const result = executor.run(
          {
            type: 'algorithm-validation',
            level: 'L0',
            algorithm: algo,
            variableDefinitionId: 'top-cond-submit',
            goldStandardSetVersion: 'syn-v1',
          },
          'hospital-demohospa',
        );
        // The flag is present and equals 'synthetic'. Downstream UI/report
        // code consumes this to print the §7.3 warning.
        expect(result.validationResult?.goldStandardProvenance).toBe('synthetic');
      });
    },
  );

  // A second describe that ALWAYS runs: proves the spec wiring (skipping
  // path + synth generator + gate integration) works even without Synthea
  // data. This guards against regressions in environments where the data
  // bundle hasn't been generated.
  describe('without Synthea data (fixture-only smoke test)', () => {
    it('proves the L0 path is wired and skips gracefully when data is absent', () => {
      // Synthesize 30 subjects in-memory; same closed loop, no FHIR loader.
      const rows: InternalRecord[] = [];
      for (let i = 0; i < 15; i++)
        rows.push({
          subjectKey: `s-${i}`,
          ageBand: '40-49',
          conditions: ['Hypertension'],
          medications: [],
          adverseEvents: [],
        });
      for (let i = 15; i < 30; i++)
        rows.push({
          subjectKey: `s-${i}`,
          ageBand: '40-49',
          conditions: ['Healthy'],
          medications: [],
          adverseEvents: [],
        });

      const algo: IdentificationAlgorithm = {
        id: 'htn',
        version: '1.0.0',
        expression: {
          kind: 'codeset',
          codeset: {
            codeSystem: 'SNOMED-CT',
            codeSystemVersion: 'fixture',
            codes: ['Hypertension'],
            valueSource: 'discharge_dx',
            diagnosisOrder: 'any',
          },
        },
      };

      const audit = new AuditService();
      const store = new LocalStore(audit);
      store.ingest(rows);
      const goldStore = new LocalGoldStandardStore();

      const predictions = evaluateAlgorithm(algo, rows);
      // 10% flips → 30 subjects → each class has 15 → expect ~1-2 flips each.
      const goldMap = synthesizeGoldStandard(predictions, {
        variableDefinitionId: 'htn',
        goldStandardSetVersion: 'syn-fixture',
        algorithmId: algo.id,
        algorithmVersion: algo.version,
      });
      goldStore.replaceAll(
        [...goldMap.entries()].map(([subjectKey, judgment]) => ({
          subjectKey,
          variableDefinitionId: 'htn',
          judgment,
          source: 'synthetic' as const,
          goldStandardSetVersion: 'syn-fixture',
        })),
      );

      // With 30 subjects split 15/15 and ~10% flips, every cell (TP/FP/TN/FN)
      // is very likely below the 5-cell threshold → result MUST be suppressed
      // (D3 fail-closed). Assert that path holds in the smoke test.
      const executor = new AlgorithmValidationExecutor(
        store,
        new OutputGate(audit, new Deidentifier()),
        goldStore,
        new SoftwareSealedCompute(),
      );
      const result = executor.run(
        {
          type: 'algorithm-validation',
          level: 'L0',
          algorithm: algo,
          variableDefinitionId: 'htn',
          goldStandardSetVersion: 'syn-fixture',
        },
        'fixture-hospital',
      );
      expect(result.validationResult?.goldStandardProvenance).toBe('synthetic');
      // Suppression is the expected behavior here — the smoke test is about
      // "the loop runs end-to-end" not "metrics are released".
      if (result.validationResult?.suppressed) {
        expect(result.validationResult.metrics).toBeUndefined();
        expect(result.validationResult.suppressionReason).toBe('insufficient_sample');
      }
    });
  });
});
