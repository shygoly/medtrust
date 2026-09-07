// rws-algorithm-validation (L0) — connector-side domain services.
//
// The operational definition is an IdentificationAlgorithm (D4). The grammar
// validator rejects anything outside the closed boolean grammar BEFORE the
// evaluator touches it (CTL-10). The evaluator runs in-TEE; the gold-standard
// loader + confusion-matrix builder run alongside it to produce the only
// cross-domain payload: a 2×2 confusion matrix.
export {
  validateAlgorithmGrammar,
  validateAlgorithmExpression,
  validateCodeSet,
  InvalidAlgorithmGrammar,
  IncompleteCodeSet,
} from './grammar-validator';
export { evaluateAlgorithm } from './algorithm-evaluator';
export {
  loadGoldStandard,
  loadGoldStandardAsync,
  NoGoldStandard,
  GoldStandardStore,
  AsyncGoldStandardStore,
  GoldStandardRow,
} from './gold-standard-loader';
export { computeConfusionMatrixInTee } from './confusion-matrix';
export { wilsonScoreInterval, metricsFromConfusionMatrix } from './stats';
export {
  synthesizeGoldStandard,
  goldFromInjectedTruth,
  resolveGoldStandard,
  shouldUseFlipGoldStandard,
  impliedSeSp,
  AlgorithmJudgment,
  InjectedTruthRow,
  SynthesizeOptions,
} from './synthetic-gold-standard';
