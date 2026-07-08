import * as fs from 'fs';
import * as path from 'path';

/** Catalog metadata extension: connector-local dataset location (not row data). */
export function extractLocalDataPath(
  fhirSchema?: Record<string, unknown> | null,
): string | null {
  if (!fhirSchema) return null;
  const raw = fhirSchema.localDataPath;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

/** Monorepo / connector data root. Override with CONNECTOR_DATA_ROOT. */
export function defaultConnectorDataRoot(): string {
  if (process.env.CONNECTOR_DATA_ROOT) {
    return path.resolve(process.env.CONNECTOR_DATA_ROOT);
  }
  // apps/connector/src/domain (or dist/domain) → repo root
  return path.resolve(__dirname, '../../../..');
}

/**
 * Resolve a catalog-declared path to an absolute filesystem path.
 * Supports:
 *   - absolute paths (as-is)
 *   - `/data/foo` → `<dataRoot>/data/foo`
 *   - `data/foo`  → `<dataRoot>/data/foo`
 *   - `./relative` relative to dataRoot
 */
export function resolveLocalDataPath(
  rawPath: string,
  dataRoot = defaultConnectorDataRoot(),
): string {
  const normalized = rawPath.trim().replace(/\\/g, '/');
  if (path.isAbsolute(normalized)) {
    return path.normalize(normalized);
  }

  const withoutLeading = normalized.replace(/^\/+/, '');
  const candidate = path.resolve(dataRoot, withoutLeading);
  if (fs.existsSync(candidate)) {
    return candidate;
  }

  // Fallback: path may already be relative to cwd (e.g. dev scripts)
  const cwdCandidate = path.resolve(process.cwd(), withoutLeading);
  if (fs.existsSync(cwdCandidate)) {
    return cwdCandidate;
  }

  return candidate;
}

export function assertReadablePath(absolutePath: string): void {
  if (!fs.existsSync(absolutePath)) {
    throw new LocalDataPathError(`本地数据路径不存在: ${absolutePath}`);
  }
}

export class LocalDataPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalDataPathError';
  }
}
