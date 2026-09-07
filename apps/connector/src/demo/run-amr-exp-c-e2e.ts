/* eslint-disable no-console */
/**
 * AMR Sentinel — Experiment C wrapper (PAPER §5.4).
 *
 * Delegates MIC reinterpretation to Python (isolates.parquet + EUCAST/native tables).
 * Enforces PAPER §8: no claim of "breakpoints solved" unless report.pass === true.
 *
 * Run: pnpm --filter @medtrust/connector demo:amr-exp-c
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../../..');
const REPORT = path.join(REPO, 'data/synthetic/amr/reports/exp_c_breakpoint_sens.json');
const SCRIPT = path.join(REPO, 'scripts/amr/run_exp_c_breakpoint_sens.py');

type RateRow = {
  organism: string;
  drug: string;
  n: number;
  rate_eucast: number;
  rate_native: number;
  delta_pp: number;
};

type Report = {
  pass: boolean;
  discordant_merged_count: number;
  min_discordant_required: number;
  merged: RateRow[];
  eucast: { system: string; version: string };
  native: { system: string; version: string };
  disclaimer: string;
};

function main(): void {
  console.log('=== AMR Sentinel · 实验 C（折点）connector 包装 ===\n');
  const run = spawnSync('python3', [SCRIPT, '--out', REPORT], {
    cwd: REPO,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) {
    console.error('Python Experiment C failed');
    process.exit(run.status ?? 1);
  }
  if (!fs.existsSync(REPORT)) {
    throw new Error(`missing report ${REPORT}`);
  }
  const report = JSON.parse(fs.readFileSync(REPORT, 'utf-8')) as Report;
  if (!report.pass) {
    throw new Error('Experiment C report.pass is false — do not claim breakpoints solved');
  }
  if (report.discordant_merged_count < report.min_discordant_required) {
    throw new Error('insufficient discordant pairs');
  }
  const top = [...report.merged]
    .sort((a, b) => Math.abs(b.delta_pp) - Math.abs(a.delta_pp))
    .slice(0, 5);
  console.log('\n[connector gate] PAPER §8 — 可写入 §5.4 的合格句候选:');
  for (const r of top) {
    console.log(
      `  · ${r.organism}/${r.drug}: R%_EUCAST=${(r.rate_eucast * 100).toFixed(1)}% ` +
        `R%_native=${(r.rate_native * 100).toFixed(1)}% Δ=${r.delta_pp >= 0 ? '+' : ''}${r.delta_pp}pp (n=${r.n})`,
    );
  }
  console.log(`\nDisclaimer: ${report.disclaimer}`);
  console.log('demo:amr-exp-c PASS');
}

main();
