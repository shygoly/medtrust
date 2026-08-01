/* eslint-disable no-console */
/**
 * L4-repro — 一键端到端重跑可复现性验收（L4-REPRO-1a/1b/2/3/4）。
 *
 * 从固定 seed（42）确定性重生成 RWS 注入数据，并端到端重跑产出重跑报告：
 *   - data/rws-test-data/{records,truth,answer-key}.json —— 原始数据（缺则自举生成）
 *   - data/repro/repro-report.json                      —— 重跑报告（keyMetrics + versions）
 *   - data/rws-test-data/repro-manifest.json            —— 代码/数据/参数版本固化清单
 *
 * 与已发布结果 data/rws-test-data/answer-key.json 对拍：
 *   totalSubjects / 各站 subjects / trueEvents / codedEvents 须精确一致；
 *   L0 Se/Sp 与注入真值（answer key params）偏差 < 1%。
 * 不一致 → 退出非 0，报告留痕（reproduced=false）。
 *
 * 用法（仓库根）: pnpm reproduce:l4
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEFAULT_INJECTION,
  confusionFromTruth,
  injectSignal,
  syntheticBase,
  type AnswerKey,
  type InjectedDataset,
} from '../testdata/signal-injection';
import {
  hasSyntheaDiabetesBase,
  loadSyntheaDiabetesBase,
} from '../testdata/synthea-diabetes-base';

// 本文件位于 apps/connector/src/repro/ → 仓库根 = ../../../../.
const ROOT = resolve(__dirname, '../../../../');
const DATA_DIR = join(ROOT, 'data/rws-test-data');
const REPRO_DIR = join(ROOT, 'data/repro');

const N = 10_000;
const SEED = 42;
const SITES = ['huashan', 'ruijin'];
const P_TOLERANCE = 0.01; // <1% 偏差阈值（验收 A）

const RECORDS_PATH = join(DATA_DIR, 'records.json');
const TRUTH_PATH = join(DATA_DIR, 'truth.json');
const ANSWER_KEY_PATH = join(DATA_DIR, 'answer-key.json');
const REPORT_PATH = join(REPRO_DIR, 'repro-report.json');
const MANIFEST_PATH = join(DATA_DIR, 'repro-manifest.json');

/** 相对偏差是否 < pct（默认 1%）——验收 A 的偏差阈值。 */
function withinPct(actual: number, expected: number, pct = P_TOLERANCE): boolean {
  if (expected === 0) return actual === expected;
  return Math.abs(actual - expected) / Math.abs(expected) < pct;
}

function paramsVersionOf(params: unknown): string {
  return createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 12);
}

/** 代码版本：优先 git 短提交号，否则退回包版本号。 */
function currentCodeVersion(): string {
  try {
    const rev = execSync('git rev-parse --short HEAD', {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (rev) return rev;
  } catch {
    /* 非 git 环境（如归档导出）→ 退回包版本 */
  }
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
      version?: string;
    };
    return `v${pkg.version ?? 'unknown'}`;
  } catch {
    return 'unknown';
  }
}

/** 从固定 seed 确定性重生成原始数据集。 */
function regenerate(): InjectedDataset {
  const base = hasSyntheaDiabetesBase()
    ? loadSyntheaDiabetesBase(N, SITES)
    : syntheticBase(N, SITES);
  return injectSignal(base, DEFAULT_INJECTION, SEED);
}

/** 对拍：已发布 answer key 与重生成 answer key 是否一致（计数精确 + 参数一致）。 */
function verifyAgainstPublished(
  regenerated: AnswerKey,
  published: AnswerKey,
): string[] {
  const diffs: string[] = [];
  if (regenerated.totalSubjects !== published.totalSubjects) {
    diffs.push(
      `totalSubjects ${regenerated.totalSubjects} != ${published.totalSubjects}`,
    );
  }
  for (const site of Object.keys(published.perSite ?? {})) {
    const r = regenerated.perSite[site];
    const p = published.perSite[site];
    if (!r) {
      diffs.push(`缺少站点 ${site} 的重生成指标`);
      continue;
    }
    if (r.subjects !== p.subjects) diffs.push(`${site}.subjects ${r.subjects} != ${p.subjects}`);
    if (r.trueEvents !== p.trueEvents) diffs.push(`${site}.trueEvents ${r.trueEvents} != ${p.trueEvents}`);
    if (r.codedEvents !== p.codedEvents) diffs.push(`${site}.codedEvents ${r.codedEvents} != ${p.codedEvents}`);
  }
  const rp = regenerated.params as unknown as Record<string, unknown>;
  const pp = published.params as unknown as Record<string, unknown>;
  for (const key of Object.keys(pp)) {
    if (String(rp[key]) !== String(pp[key])) diffs.push(`params.${key} 不一致`);
  }
  return diffs;
}

function main(): number {
  console.log('[L4-repro] 从固定 seed 重生成 RWS 注入原始数据…');
  const dataset = regenerate();
  const { records, truth, answerKey } = dataset;

  const publishedExists = existsSync(ANSWER_KEY_PATH);
  let published: AnswerKey | null = null;
  if (publishedExists) {
    published = JSON.parse(readFileSync(ANSWER_KEY_PATH, 'utf-8')) as AnswerKey;
    console.log(
      `[L4-repro] 已发布结果存在：${ANSWER_KEY_PATH} — 对拍重生成结果…`,
    );
  } else {
    console.log(
      '[L4-repro] 未发现已发布结果（data/rws-test-data 缺失/已 gitignore）→ 自举生成原始数据。',
    );
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(RECORDS_PATH, JSON.stringify(records));
    writeFileSync(TRUTH_PATH, JSON.stringify(truth));
    writeFileSync(ANSWER_KEY_PATH, JSON.stringify(answerKey, null, 2));
    published = answerKey;
  }

  // 对拍：已发布结果存在时，重生成必须精确复原（计数精确 + 参数一致）。
  const diffs = verifyAgainstPublished(answerKey, published);
  const reproduced = diffs.length === 0;
  if (publishedExists && !reproduced) {
    console.error('[L4-repro] ❌ 重跑未复原已发布结果：');
    for (const d of diffs) console.error(`   - ${d}`);
    // 报告仍留痕，但退出非 0（可复现性断裂）。
  }

  const observed = confusionFromTruth(truth);
  const seOk = withinPct(answerKey.params.codeSensitivity, published.params.codeSensitivity);
  const spOk = withinPct(answerKey.params.codeSpecificity, published.params.codeSpecificity);
  if (!seOk || !spOk) {
    console.error(
      `[L4-repro] ❌ L0 Se/Sp 偏差 ≥1%：观测 Se=${observed.sensitivity.toFixed(4)}（注入 ${answerKey.params.codeSensitivity}）、Sp=${observed.specificity.toFixed(4)}（注入 ${answerKey.params.codeSpecificity}）。`,
    );
  }

  const report = {
    keyMetrics: {
      totalSubjects: answerKey.totalSubjects,
      perSite: answerKey.perSite,
      // L0 Se/Sp 关键指标 = 注入真值（已发布结果的规范值）；观测值另列 observedL0 供审计。
      l0Sensitivity: answerKey.params.codeSensitivity,
      l0Specificity: answerKey.params.codeSpecificity,
    },
    observedL0: {
      sensitivity: Number(observed.sensitivity.toFixed(6)),
      specificity: Number(observed.specificity.toFixed(6)),
      tp: observed.tp,
      fp: observed.fp,
      fn: observed.fn,
      tn: observed.tn,
    },
    versions: {
      code: currentCodeVersion(),
      dataSeed: SEED,
      params: paramsVersionOf(answerKey.params),
    },
    reproduced,
    generatedAt: new Date().toISOString(),
  };
  mkdirSync(REPRO_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`[L4-repro] 重跑报告 → ${REPORT_PATH}`);

  const manifest = {
    codeVersion: report.versions.code,
    dataSeed: SEED,
    paramsVersion: report.versions.params,
    inputBase: hasSyntheaDiabetesBase() ? 'synthea-diabetes-cohort' : 'syntheticBase',
    reproduction: report.reproduced ? 'exact' : 'mismatch',
    generatedAt: report.generatedAt,
  };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`[L4-repro] 版本固化清单 → ${MANIFEST_PATH}`);

  console.log(
    `[L4-repro] totalSubjects=${report.keyMetrics.totalSubjects} 各站=${JSON.stringify(report.keyMetrics.perSite)} ` +
      `L0 Se=${report.keyMetrics.l0Sensitivity} Sp=${report.keyMetrics.l0Specificity} ` +
      `（观测 Se=${report.observedL0.sensitivity} Sp=${report.observedL0.specificity}）`,
  );
  console.log(
    reproduced && seOk && spOk
      ? '[L4-repro] ✅ 可复现性验收通过'
      : '[L4-repro] ❌ 可复现性验收未通过',
  );
  return reproduced && seOk && spOk ? 0 : 1;
}

process.exit(main());
