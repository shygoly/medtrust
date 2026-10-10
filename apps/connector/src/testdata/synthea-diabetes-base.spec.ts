import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  hasSyntheaDiabetesBase,
  loadSyntheaDiabetesBase,
  syntheaDiabetesCohortDir,
} from './synthea-diabetes-base';

describe('synthea-diabetes-base — Task 1 Keep-Module cohort', () => {
  const dir = syntheaDiabetesCohortDir();
  const ready = hasSyntheaDiabetesBase(dir);

  (ready ? it : it.skip)('loads T2DM BaseSubjects from Keep-Module CSV', () => {
    const base = loadSyntheaDiabetesBase(60, ['demohospa', 'demohospb'], dir);
    expect(base).toHaveLength(60);
    expect(base.every((b) => b.subjectKey.includes('-syn-'))).toBe(true);
    expect(base.some((b) => b.site === 'demohospa')).toBe(true);
    expect(base.some((b) => b.site === 'demohospb')).toBe(true);
    // Cycles when n > cohort size
    expect(existsSync(resolve(dir, 'csv', 'conditions.csv'))).toBe(true);
  });

  it('hasSyntheaDiabetesBase is false for missing dir', () => {
    expect(hasSyntheaDiabetesBase('/tmp/medtrust-no-such-cohort')).toBe(false);
  });
});
