import { SecretFlowRunResult } from './secretflow-run-result';

export class SecretFlowOutputBlocked extends Error {
  constructor(public readonly unsafePath: string) {
    super(`SecretFlow output contains unsafe field: ${unsafePath}`);
    this.name = 'SecretFlowOutputBlocked';
  }
}

const UNSAFE_KEY_TOKENS = [
  'raw',
  'row',
  'patient',
  'subject',
  'dicom',
  'vcf',
  'variant',
  'gradient',
  'embedding',
  'image',
  'pixel',
  'genomic',
];

export function assertSafeSecretFlowRunResult(result: SecretFlowRunResult): SecretFlowRunResult {
  scanForUnsafeKeys(result);
  return result;
}

export function serializeSafeSecretFlowRunResult(result: SecretFlowRunResult): string {
  return JSON.stringify(assertSafeSecretFlowRunResult(result));
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
    if (UNSAFE_KEY_TOKENS.some((token) => normalizedKey.includes(token))) {
      throw new SecretFlowOutputBlocked(nestedPath);
    }
    scanForUnsafeKeys(nested, nestedPath);
  }
}
