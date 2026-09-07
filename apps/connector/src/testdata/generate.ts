// 生成 RWS 阶梯测试数据(注入已知真值信号,D-DATA-1)。
// 用法(从 apps/connector): npx ts-node src/testdata/generate.ts [队列规模=10000] [seed=42]
// 产出到仓库根 data/rws-test-data/: records.json + truth.json + answer-key.json,并自检合格。
// 合格后自动按院导出可烘焙切片 → data/demo/rws-injected/{huashan,ruijin}/
// 基座优先用 Synthea Keep-Module 糖尿病队列(Task 1);不足或缺失时回退 syntheticBase。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  injectSignal,
  syntheticBase,
  DEFAULT_INJECTION,
  cellsFromRecords,
  confusionFromTruth,
} from './signal-injection';
import {
  hasSyntheaDiabetesBase,
  loadSyntheaDiabetesBase,
} from './synthea-diabetes-base';
import { exportDemoSlices } from './export-demo-slices';

const N = Number(process.argv[2] ?? 10000);
const SEED = Number(process.argv[3] ?? 42);
const SITES = ['huashan', 'ruijin'];
const OUT = resolve(__dirname, '../../../../data/rws-test-data');

const base = hasSyntheaDiabetesBase()
  ? (console.log('基座: Synthea diabetes Keep-Module cohort'), loadSyntheaDiabetesBase(N, SITES))
  : (console.log('基座: syntheticBase (无 data/synthea/diabetes-cohort — 先跑 scripts/generate-synthea-diabetes.sh)'),
    syntheticBase(N, SITES));
const { records, truth, answerKey } = injectSignal(base, DEFAULT_INJECTION, SEED);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'records.json'), JSON.stringify(records));
writeFileSync(join(OUT, 'truth.json'), JSON.stringify(truth));
writeFileSync(join(OUT, 'answer-key.json'), JSON.stringify(answerKey, null, 2));

console.log(`生成 ${records.length} 条(seed ${SEED}) → ${OUT}`);
let ok = true;
for (const site of SITES) {
  const s = answerKey.perSite[site];
  const siteRecords = records.filter((r) => r.subjectKey.startsWith(site));
  const c = cellsFromRecords(siteRecords, DEFAULT_INJECTION);
  const minCell = Math.min(c.a, c.b, c.c, c.d);
  const pass = s.trueEvents >= 300 && minCell >= 5;
  ok = ok && pass;
  console.log(
    `  [${site}] 患者 ${s.subjects} 真事件 ${s.trueEvents} 编码事件 ${s.codedEvents}  ` +
      `四格 a=${c.a} b=${c.b} c=${c.c} d=${c.d}  ${pass ? '✅合格' : '❌不合格'}`,
  );
}
const m = confusionFromTruth(truth);
console.log(
  `  L0 混淆 TP=${m.tp} FP=${m.fp} FN=${m.fn} TN=${m.tn} → Se=${(100 * m.sensitivity).toFixed(1)}% Sp=${(100 * m.specificity).toFixed(1)}%`,
);
if (!ok) {
  console.log('\n❌ 数据不合格,增大队列或调发病率');
  process.exit(1);
}
console.log('\n✅ 数据合格(事件数达标 + 过闸) — 导出按院演示切片…');
process.exit(exportDemoSlices() ? 0 : 1);
