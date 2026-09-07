import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BaseSubject } from './signal-injection';

/**
 * Load Synthea Keep-Module diabetes cohort as injection BaseSubject[].
 * Source: scripts/generate-synthea-diabetes.sh → data/synthea/diabetes-cohort/
 * (Task 1.1: Active Condition SNOMED 44054006).
 */

const DEFAULT_COHORT = resolve(
  __dirname,
  '../../../../data/synthea/diabetes-cohort',
);

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    // Synthea CSV fields rarely embed commas in the columns we need; simple split OK.
    const cols = line.split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? '';
    });
    return row;
  });
}

export function syntheaDiabetesCohortDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.SYNTHEA_DIABETES_DIR
    ? resolve(env.SYNTHEA_DIABETES_DIR)
    : DEFAULT_COHORT;
}

/** True when Keep-Module cohort CSV is present. */
export function hasSyntheaDiabetesBase(dir = syntheaDiabetesCohortDir()): boolean {
  return existsSync(join(dir, 'csv', 'conditions.csv'));
}

/**
 * Build BaseSubject[] from T2DM patients in the Synthea cohort.
 * When n > cohort size, subjects are cycled (deterministic) so injection scale
 * can exceed the FHIR demo cohort without re-running Synthea at 10k.
 */
export function loadSyntheaDiabetesBase(
  n: number,
  sites: string[],
  dir = syntheaDiabetesCohortDir(),
): BaseSubject[] {
  const condPath = join(dir, 'csv', 'conditions.csv');
  const patPath = join(dir, 'csv', 'patients.csv');
  if (!existsSync(condPath)) {
    throw new Error(`Synthea diabetes cohort missing: ${condPath}`);
  }

  const dmIds = new Set(
    parseCsv(readFileSync(condPath, 'utf-8'))
      .filter((r) => r.CODE === '44054006')
      .map((r) => r.PATIENT),
  );
  if (dmIds.size === 0) {
    throw new Error(`No SNOMED 44054006 patients in ${condPath}`);
  }

  const demo = new Map<string, { sex?: string; birth?: string }>();
  if (existsSync(patPath)) {
    for (const r of parseCsv(readFileSync(patPath, 'utf-8'))) {
      if (!dmIds.has(r.Id)) continue;
      demo.set(r.Id, { sex: r.GENDER === 'M' ? 'male' : r.GENDER === 'F' ? 'female' : undefined, birth: r.BIRTHDATE });
    }
  }

  const ids = [...dmIds].sort();
  const out: BaseSubject[] = [];
  for (let i = 0; i < n; i++) {
    const id = ids[i % ids.length];
    const site = sites[i % sites.length];
    const d = demo.get(id);
    let ageBand: string | undefined;
    if (d?.birth) {
      const age = Math.max(0, 2026 - Number(d.birth.slice(0, 4)));
      const lo = Math.floor(age / 10) * 10;
      ageBand = `${lo}-${lo + 9}`;
    }
    out.push({
      subjectKey: `${site}-syn-${id.slice(0, 8)}-${i}`,
      site,
      ageBand,
      sex: d?.sex,
    });
  }
  return out;
}
