import * as fs from 'fs';
import * as path from 'path';

/** Monorepo / connector data root. Override with CONNECTOR_DATA_ROOT. */
export function defaultConnectorDataRoot(): string {
  if (process.env.CONNECTOR_DATA_ROOT) {
    return path.resolve(process.env.CONNECTOR_DATA_ROOT);
  }
  // apps/connector/src/domain (or dist/domain) → repo root
  return path.resolve(__dirname, '../../../..');
}

/**
 * Whether a catalog path uses the `/data/...` (or `data/...`) convention.
 * On Windows `path.isAbsolute('/data/foo')` is true, which would wrongly resolve
 * to `\data\foo` at the drive root — catalog paths MUST stay under dataRoot.
 */
function isCatalogDataPath(normalizedPosix: string): boolean {
  return (
    normalizedPosix === 'data' ||
    normalizedPosix === '/data' ||
    normalizedPosix.startsWith('data/') ||
    normalizedPosix.startsWith('/data/')
  );
}

/**
 * Resolve a catalog-declared path to an absolute filesystem path.
 * Supports:
 *   - `/data/foo` → `<dataRoot>/data/foo`（含 Windows；勿当 OS 绝对路径）
 *   - `data/foo`  → `<dataRoot>/data/foo`
 *   - `./relative` relative to dataRoot
 *   - 真实 OS 绝对路径（如 `C:\...`、Unix `/var/...`）原样使用
 */
export function resolveLocalDataPath(
  rawPath: string,
  dataRoot = defaultConnectorDataRoot(),
): string {
  const trimmed = rawPath.trim();
  const normalized = trimmed.replace(/\\/g, '/');

  if (isCatalogDataPath(normalized)) {
    const withoutLeading = normalized.replace(/^\/+/, '');
    const candidate = path.resolve(dataRoot, withoutLeading);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const cwdCandidate = path.resolve(process.cwd(), withoutLeading);
    if (fs.existsSync(cwdCandidate)) {
      return cwdCandidate;
    }
    return candidate;
  }

  // 真实绝对路径（Windows 盘符或非 /data 的 Unix 根路径）
  if (path.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }

  const candidate = path.resolve(dataRoot, normalized);
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  const cwdCandidate = path.resolve(process.cwd(), normalized);
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
