// 将注入全集按院切分为可烘焙、可 git 跟踪的演示切片。
// 用法(从 apps/connector):
//   npx ts-node src/testdata/export-demo-slices.ts
//   # 或随 generate.ts 合格后自动调用 exportDemoSlices()
//
// 产出: data/demo/rws-injected/{huashan,ruijin}/{records.json,truth.json}
//       + data/demo/rws-injected/answer-key.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEFAULT_INJECTION,
  cellsFromRecords,
  type AnswerKey,
  type SubjectTruth,
} from './signal-injection';
import type { InternalRecord } from '../domain/types';

const SITES = ['huashan', 'ruijin'] as const;
const SRC = resolve(__dirname, '../../../../data/rws-test-data');
const OUT = resolve(__dirname, '../../../../data/demo/rws-injected');

/** Split data/rws-test-data → data/demo/rws-injected/{site}/. Returns true if gate passes. */
export function exportDemoSlices(
  srcDir: string = SRC,
  outDir: string = OUT,
): boolean {
  const recordsPath = join(srcDir, 'records.json');
  const truthPath = join(srcDir, 'truth.json');
  const answerKeyPath = join(srcDir, 'answer-key.json');
  if (!existsSync(recordsPath) || !existsSync(truthPath) || !existsSync(answerKeyPath)) {
    console.error(
      `缺少 ${srcDir} 下的 records/truth/answer-key — 先跑: npx ts-node src/testdata/generate.ts`,
    );
    return false;
  }

  const records = JSON.parse(readFileSync(recordsPath, 'utf-8')) as InternalRecord[];
  const truth = JSON.parse(readFileSync(truthPath, 'utf-8')) as SubjectTruth[];
  const answerKey = JSON.parse(readFileSync(answerKeyPath, 'utf-8')) as AnswerKey;

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'answer-key.json'), JSON.stringify(answerKey, null, 2));

  let ok = true;
  for (const site of SITES) {
    const siteRecords = records.filter((r) => r.subjectKey.startsWith(`${site}-`));
    const siteTruth = truth.filter(
      (t) => t.site === site || t.subjectKey.startsWith(`${site}-`),
    );
    const dir = join(outDir, site);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'records.json'), JSON.stringify(siteRecords));
    writeFileSync(join(dir, 'truth.json'), JSON.stringify(siteTruth));

    const s = answerKey.perSite[site];
    const c = cellsFromRecords(siteRecords, DEFAULT_INJECTION);
    const minCell = Math.min(c.a, c.b, c.c, c.d);
    const pass =
      !!s &&
      s.trueEvents >= 300 &&
      minCell >= 5 &&
      siteRecords.length === siteTruth.length &&
      siteRecords.length > 0;
    ok = ok && pass;
    console.log(
      `  [${site}] n=${siteRecords.length} 真事件=${s?.trueEvents ?? '?'} ` +
        `四格 a=${c.a} b=${c.b} c=${c.c} d=${c.d}  ${pass ? '✅' : '❌'} → ${dir}`,
    );
  }

  console.log(ok ? `\n✅ 演示切片已写出 → ${outDir}` : `\n❌ 切片不合格`);
  return ok;
}

if (require.main === module) {
  process.exit(exportDemoSlices() ? 0 : 1);
}
