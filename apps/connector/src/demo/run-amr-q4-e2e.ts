/* eslint-disable no-console */
/**
 * AMR Sentinel — Experiment D wrapper (PAPER §5.5 / Q4 recovery).
 *
 * Runs Python recovery on bli_noninferior tree; optionally merino_superior if present.
 * PAPER §8: never prints clinical efficacy claims.
 *
 * Run: pnpm --filter @medtrust/connector demo:amr-q4
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../../..');
const SCRIPT = path.join(REPO, 'scripts/amr/run_exp_d_q4_recovery.py');

function runPreset(srcRel: string, expect: string, outRel: string): boolean {
  const src = path.join(REPO, srcRel);
  const out = path.join(REPO, outRel);
  if (!fs.existsSync(path.join(src, 'manifest.json'))) {
    console.log(`skip ${expect}: missing ${srcRel}/manifest.json`);
    return false;
  }
  console.log(`\n>>> preset=${expect} src=${srcRel}`);
  const run = spawnSync(
    'python3',
    [SCRIPT, '--src', src, '--out', out, '--expect-preset', expect],
    { cwd: REPO, encoding: 'utf-8' },
  );
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) {
    throw new Error(`Experiment D failed for ${expect}`);
  }
  const report = JSON.parse(fs.readFileSync(out, 'utf-8')) as { pass: boolean };
  if (!report.pass) throw new Error(`report.pass false for ${expect}`);
  return true;
}

function main(): void {
  console.log('=== AMR Sentinel · 实验 D（Q4）connector 包装 ===');
  console.log('PAPER §8: simulation recovery only — 禁止疗效话术\n');

  const bli = runPreset(
    'data/synthetic/amr',
    'bli_noninferior',
    'data/synthetic/amr/reports/exp_d_q4_bli.json',
  );
  if (!bli) throw new Error('bli_noninferior tree required');

  const merino = runPreset(
    'data/synthetic/amr-merino',
    'merino_superior',
    'data/synthetic/amr/reports/exp_d_q4_merino.json',
  );
  if (!merino) {
    console.log(
      '\nWARN: merino_superior tree absent — bli PASS only. Generate with:\n' +
        '  python3 scripts/amr/generate_synthetic.py --n-per-hospital 5000 --seed 42 \\\n' +
        '    --q4-preset merino_superior --out data/synthetic/amr-merino',
    );
    console.log('demo:amr-q4 PARTIAL (bli only)');
    process.exit(0);
  }

  console.log('\n双预设回收 ✓ · demo:amr-q4 PASS');
}

main();
