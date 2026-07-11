import {
  FlPartyRunResult,
  FlPredictionArtifactKind,
  FlRunResult,
} from './fl-run-result';

export class FlOutputBlocked extends Error {
  constructor(public readonly unsafePath: string) {
    super(`FL prediction output contains unsafe field: ${unsafePath}`);
    this.name = 'FlOutputBlocked';
  }
}

const UNSAFE_KEY_TOKENS = [
  'raw',
  'row',
  'patient',
  'subject',
  'weight',
  'coef',
  'gradient',
  'embedding',
  'dicom',
  'vcf',
  'variant',
  'genomic',
  'pixel',
  'image',
];

/** 业务字段名含 substring 但语义安全（如 sampleCount = 聚合计数，非行级样本）。 */
const SAFE_FIELD_KEYS = new Set([
  'samplecount',
  'roundsparticipated',
  'roundscompleted',
  'totalrounds',
  'participantid',
]);

export function assertSafeFlRunResult(result: FlRunResult): FlRunResult {
  scanForUnsafeKeys(result);
  return result;
}

export function assertSafeFlPartyRunResult(result: FlPartyRunResult): FlPartyRunResult {
  scanForUnsafeKeys(result);
  return result;
}

export function serializeSafeFlRunResult(result: FlRunResult): string {
  return JSON.stringify(assertSafeFlRunResult(result));
}

export function filterFlRunResultByPolicy(
  result: FlRunResult,
  allowedArtifacts: FlPredictionArtifactKind[],
): FlRunResult {
  const allowed = new Set(allowedArtifacts);
  const filtered: FlRunResult = {
    ...result,
    aggregateMetrics: { ...result.aggregateMetrics },
  };

  if (!allowed.has('feature_importance')) {
    delete filtered.featureImportance;
  }
  if (!allowed.has('calibration_curve')) {
    delete filtered.calibrationCurve;
  }
  if (!allowed.has('attestation_report')) {
    delete filtered.attestation;
  }
  if (!allowed.has('model_hash')) {
    filtered.modelHash = '[withheld]';
  }

  const metrics = { ...filtered.aggregateMetrics };
  if (!allowed.has('auc')) {
    delete metrics.auc;
  }
  if (!allowed.has('f1')) {
    delete metrics.f1;
  }
  if (!allowed.has('precision')) {
    delete metrics.precision;
  }
  if (!allowed.has('recall')) {
    delete metrics.recall;
  }
  filtered.aggregateMetrics = metrics;

  return assertSafeFlRunResult(filtered);
}

function scanForUnsafeKeys(value: unknown, path = 'result'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForUnsafeKeys(item, `${path}[${index}]`));
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    const normalizedKey = key.toLowerCase();
    if (
      !SAFE_FIELD_KEYS.has(normalizedKey) &&
      UNSAFE_KEY_TOKENS.some((token) => normalizedKey.includes(token))
    ) {
      throw new FlOutputBlocked(nestedPath);
    }
    scanForUnsafeKeys(nested, nestedPath);
  }
}
