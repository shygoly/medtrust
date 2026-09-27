import { GoldStandardJudgment } from '@medtrust/database';
import { SoftwareTee, TeeEnclave } from '../tee';
import { ConfusionMatrix } from '../types';

// Build a 2×2 confusion matrix by comparing the algorithm's predictions to
// the gold standard, IN-TEE. The rows + labels are sealed into the enclave;
// only the four counts come out. This mirrors the rws-executor pattern: the
// connector's `aggregateInternal` guard wraps the call and the TEE provides
// the enclave boundary.
//
// D-RWS-4: attestationLevel is captured from the TEE result. Until a hardware
// enclave (海光 CSV) is wired, every attestation level is 'software'.

export interface ConfusionMatrixWithAttestation {
  confusionMatrix: ConfusionMatrix;
  attestationLevel: 'software' | 'hardware';
}

interface CompareInput {
  /** subjectKey → algorithm judgment (true = positive) */
  predictions: Array<[string, boolean]>;
  /** subjectKey → gold-standard judgment */
  gold: Array<[string, GoldStandardJudgment]>;
}

function compareInEnclave(input: CompareInput): ConfusionMatrix {
  const gold = new Map(input.gold);
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const [subjectKey, predicted] of input.predictions) {
    const actual = gold.get(subjectKey);
    if (actual === undefined) {
      // Subject has no gold-standard annotation. Skip — we cannot score it.
      // (The output gate's suppression threshold will catch a too-small N.)
      continue;
    }
    const actualPositive = actual === 'positive';
    if (predicted && actualPositive) tp++;
    else if (predicted && !actualPositive) fp++;
    else if (!predicted && actualPositive) fn++;
    else tn++;
  }
  return { tp, fp, tn, fn };
}

/**
 * Seal predictions + gold labels into the TEE and return only the counts.
 * Caller responsibility: predictions + gold are subject-level; this function
 * is the LAST place subject-level data exists — only the 4 integers leave.
 */
export function computeConfusionMatrixInTee(
  predictions: Map<string, boolean>,
  gold: Map<string, GoldStandardJudgment>,
  tee: TeeEnclave = new SoftwareTee(), // 默认走 SoftwareTee 构造守卫：生产判据下抛错，不可能静默生效。
): ConfusionMatrixWithAttestation {
  const sealed = tee.seal({
    predictions: [...predictions.entries()],
    gold: [...gold.entries()],
  });
  const result = tee.run(sealed, (data: CompareInput) => compareInEnclave(data));
  return {
    confusionMatrix: result.output,
    attestationLevel: result.attestation.level,
  };
}
