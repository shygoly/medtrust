import { Injectable, Optional } from '@nestjs/common';
import { LocalStore } from './local-store';
import { OutputGate } from './output-gate';
import { SoftwareTee } from './tee';
import { RwsAnalysis, AggregateResult, ValidationResult } from './types';
import {
  validateAlgorithmGrammar,
  InvalidAlgorithmGrammar,
  IncompleteCodeSet,
} from './algorithm-validation/grammar-validator';
import { evaluateAlgorithm } from './algorithm-validation/algorithm-evaluator';
import {
  loadGoldStandard,
  NoGoldStandard,
} from './algorithm-validation/gold-standard-loader';
import { computeConfusionMatrixInTee } from './algorithm-validation/confusion-matrix';
import { LocalGoldStandardStore } from './local-gold-standard-store';

export {
  InvalidAlgorithmGrammar,
  IncompleteCodeSet,
  NoGoldStandard,
};

/**
 * L0 algorithm-validation executor (rws-algorithm-validation, tasks 5.1/5.5
 * on the connector side). Runs the full closed-grammar → gold-load → in-TEE
 * evaluate → in-TEE compare → output-gate sequence.
 *
 * The executor returns an `AggregateResult` envelope (the connector task
 * runner's existing contract) carrying a `validationResult` field. No other
 * field is populated — L0 is structurally distinct from L1.5–L4 cohorts.
 */
@Injectable()
export class AlgorithmValidationExecutor {
  constructor(
    private readonly store: LocalStore,
    private readonly gate: OutputGate,
    /** Concrete class so Nest DI retains the type (interface tokens erase). */
    private readonly goldStandardStore: LocalGoldStandardStore,
    @Optional() private readonly tee: SoftwareTee = new SoftwareTee(),
  ) {}

  run(
    analysis: RwsAnalysis,
    providerId: string,
    taskId = 'local',
    minCell = 5,
    contractId?: string,
  ): AggregateResult {
    if (!analysis.algorithm) {
      throw new Error('algorithm-validation 任务缺少 algorithm 定义');
    }
    if (!analysis.variableDefinitionId) {
      throw new Error('algorithm-validation 任务缺少 variableDefinitionId');
    }
    const goldStandardSetVersion = analysis.goldStandardSetVersion ?? 'default';

    // 1. CTL-10: grammar-validate BEFORE evaluation. Rejects any injection
    //    attempt coming through the cross-domain task-spec payload.
    validateAlgorithmGrammar(analysis.algorithm);

    // 2. Load gold standard; fail explicitly if absent (NoGoldStandard).
    const goldMap = loadGoldStandard(this.goldStandardStore, analysis.variableDefinitionId);
    const nGold = goldMap.size;
    // §7.3: synthetic provenance is propagated so the UI/report layer can
    // label synthetic results as MUST NOT be used for submission.
    const goldStandardProvenance = this.goldStandardStore.provenanceFor(
      analysis.variableDefinitionId,
    );

    // 3. In-TEE evaluate + compare. LocalStore.aggregateInternal guards the
    //    raw rows; SoftwareTee provides the enclave boundary (D-RWS-4).
    const { confusionMatrix, attestationLevel } = this.store.aggregateInternal(
      { origin: 'internal', actor: `algorithm-validation:${taskId}` },
      (rows) => {
        const predictions = evaluateAlgorithm(analysis.algorithm!, rows);
        return computeConfusionMatrixInTee(predictions, goldMap, this.tee);
      },
    );

    // 4. Output gate: fail-closed on any suppressed cell (D-UC-2 / D3).
    const validationResult: ValidationResult = this.gate.passValidation(
      confusionMatrix,
      {
        algorithmId: analysis.algorithm.id,
        algorithmVersion: analysis.algorithm.version,
        providerId,
        variableDefinitionId: analysis.variableDefinitionId,
        goldStandardSetVersion,
      },
      attestationLevel,
      minCell,
      contractId ? { contractId } : undefined,
    );
    // Attach provenance AFTER the gate so the gate's fail-closed decision
    // never depends on a synthetic flag.
    validationResult.goldStandardProvenance = goldStandardProvenance;

    // 5. Return envelope. analysisType routes the orchestrator; cohortSize
    //    is the gold-standard count (the N the algorithm was scored against).
    return {
      analysisType: 'algorithm-validation',
      cohortSize: nGold,
      buckets: [],
      validationResult,
    };
  }
}
