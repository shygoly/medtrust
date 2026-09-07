/**
 * Experiment C — metadata fail-closed + report shape (does not require parquet if skipped).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../../..');
const SCRIPT = path.join(REPO, 'scripts/amr/run_exp_c_breakpoint_sens.py');
const ISO = path.join(REPO, 'data/synthetic/amr/huashan/isolates.parquet');

describe('AMR Experiment C (breakpoint sensitivity)', () => {
  const available = fs.existsSync(ISO) && fs.existsSync(SCRIPT);

  (available ? it : it.skip)(
    'run_exp_c_breakpoint_sens.py PASS with ≥3 discordant pairs',
    () => {
      const out = path.join(REPO, 'data/synthetic/amr/reports/exp_c_jest.json');
      const run = spawnSync('python3', [SCRIPT, '--out', out], {
        cwd: REPO,
        encoding: 'utf-8',
      });
      expect(run.status).toBe(0);
      const report = JSON.parse(fs.readFileSync(out, 'utf-8')) as {
        pass: boolean;
        discordant_merged_count: number;
        min_discordant_required: number;
        merged: Array<{ delta_pp: number }>;
      };
      expect(report.pass).toBe(true);
      expect(report.discordant_merged_count).toBeGreaterThanOrEqual(
        report.min_discordant_required,
      );
      expect(report.merged.some((r) => Math.abs(r.delta_pp) > 0)).toBe(true);
    },
    120_000,
  );

  (available ? it : it.skip)('rejects missing breakpoint metadata', () => {
    const run = spawnSync(
      'python3',
      [SCRIPT, '--contract-meta', '{}', '--out', '/tmp/exp_c_should_fail.json'],
      { cwd: REPO, encoding: 'utf-8' },
    );
    expect(run.status).not.toBe(0);
  });
});
