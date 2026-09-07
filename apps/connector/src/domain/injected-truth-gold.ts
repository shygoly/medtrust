// Load sibling truth.json next to injected records and materialize synthetic
// gold-standard rows for L0 (CTL-12 / §7.3 provenance = synthetic).
import * as fs from 'fs';
import * as path from 'path';
import { GoldStandardRow } from './algorithm-validation/gold-standard-loader';
import type { InjectedTruthRow } from './algorithm-validation/synthetic-gold-standard';

/** Form / demo default — matches apps/web RWS L0 pancreatitis screening task. */
export const DEMO_GOLD_VARIABLE_DEFINITION_ID = 'acute-pancreatitis';
export const DEMO_GOLD_SET_VERSION = 'injected-v1';

export function demoGoldVariableDefinitionId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env.MEDTRUST_DEMO_VARIABLE_DEFINITION_ID?.trim();
  return fromEnv || DEMO_GOLD_VARIABLE_DEFINITION_ID;
}

export function demoGoldSetVersion(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.MEDTRUST_DEMO_GOLD_SET_VERSION?.trim();
  return fromEnv || DEMO_GOLD_SET_VERSION;
}

/** Resolve truth.json beside a loaded records path (file or directory). */
export function resolveSiblingTruthPath(resolvedPath: string): string | null {
  const dir = fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()
    ? resolvedPath
    : path.dirname(resolvedPath);
  const candidate = path.join(dir, 'truth.json');
  return fs.existsSync(candidate) ? candidate : null;
}

export function readInjectedTruthFile(truthPath: string): InjectedTruthRow[] {
  const raw = JSON.parse(fs.readFileSync(truthPath, 'utf-8')) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error(`truth.json 须为数组: ${truthPath}`);
  }
  const out: InjectedTruthRow[] = [];
  for (const row of raw) {
    if (
      row &&
      typeof row === 'object' &&
      typeof (row as InjectedTruthRow).subjectKey === 'string' &&
      typeof (row as InjectedTruthRow).truePancreatitis === 'boolean'
    ) {
      out.push({
        subjectKey: (row as InjectedTruthRow).subjectKey,
        truePancreatitis: (row as InjectedTruthRow).truePancreatitis,
      });
    }
  }
  return out;
}

/** Map injected true disease state → synthetic GoldStandardRow[]. */
export function goldRowsFromInjectedTruth(
  truth: readonly InjectedTruthRow[],
  opts?: {
    variableDefinitionId?: string;
    goldStandardSetVersion?: string;
  },
): GoldStandardRow[] {
  const variableDefinitionId =
    opts?.variableDefinitionId ?? demoGoldVariableDefinitionId();
  const goldStandardSetVersion =
    opts?.goldStandardSetVersion ?? demoGoldSetVersion();
  return truth.map((t) => ({
    subjectKey: t.subjectKey,
    variableDefinitionId,
    judgment: t.truePancreatitis ? ('positive' as const) : ('negative' as const),
    source: 'synthetic' as const,
    goldStandardSetVersion,
  }));
}

/**
 * If `resolvedPath` has a sibling truth.json, return synthetic gold rows.
 * Returns null when no sidecar (non-injected datasets).
 */
export function loadSyntheticGoldBeside(
  resolvedPath: string,
  opts?: {
    variableDefinitionId?: string;
    goldStandardSetVersion?: string;
  },
): GoldStandardRow[] | null {
  const truthPath = resolveSiblingTruthPath(resolvedPath);
  if (!truthPath) return null;
  const truth = readInjectedTruthFile(truthPath);
  if (truth.length === 0) return null;
  return goldRowsFromInjectedTruth(truth, opts);
}
