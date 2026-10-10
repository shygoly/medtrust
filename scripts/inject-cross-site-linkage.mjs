#!/usr/bin/env node
/**
 * 给两院的合成数据集注入**跨院关联假名** `linkKey`（纯新增字段，幂等、确定性）。
 *
 * 为什么需要：`subjectKey` 是院内假名，两院互不相同（交集恒为空），跨院主体配对
 * （`rws.paired-cohort`）无从对齐。真实场景里关联假名由空间级加盐摘要从共同标识得出；
 * 这里是合成数据，直接在同年龄段、同性别的记录之间**人为指定**哪些是「同一个人」。
 *
 * 不改任何既有字段：`subjectKey` / `treated` / `eventOccurred` 等保持原样，
 * 既有 L1.5 / L2 演示与 truth.json 对拍不受影响。
 *
 *   node scripts/inject-cross-site-linkage.mjs [--dir data/demo/rws-injected] [--pairs 1600]
 *
 * 输出配对后的期望值（按节点内配对算子的口径：按 linkKey 求交，暴露/结局「任一院为真即为真」），
 * 供真跑结果对拍。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const dir = flag('--dir', 'data/demo/rws-injected');
const wanted = Number(flag('--pairs', '1600'));
const SITES = ['demohospa', 'demohospb'];
const SEED = 'medtrust-synthetic-linkage-v1';

const records = Object.fromEntries(
  SITES.map((site) => [site, JSON.parse(readFileSync(join(dir, site, 'records.json'), 'utf8'))]),
);

// 幂等：先清掉上一次注入的字段
for (const site of SITES) for (const row of records[site]) delete row.linkKey;

// 同年龄段、同性别的记录按原顺序一一配对（同一个人在两院的人口学特征必须一致）
const byStratum = (rows) => {
  const groups = new Map();
  rows.forEach((row, index) => {
    const key = `${row.ageBand}|${row.sex ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  return groups;
};
const [a, b] = SITES.map((site) => byStratum(records[site]));
const candidates = [];
for (const key of [...a.keys()].sort()) {
  const left = a.get(key);
  const right = b.get(key) ?? [];
  for (let i = 0; i < Math.min(left.length, right.length); i++) candidates.push([left[i], right[i]]);
}
// 在全部候选里等间隔抽取，避免只落在排序靠前的几个分层
const step = Math.max(1, Math.floor(candidates.length / wanted));
const pairs = candidates.filter((_, i) => i % step === 0).slice(0, wanted);

let exposed = 0;
let outcome = 0;
let both = 0;
pairs.forEach(([i, j], n) => {
  const linkKey = `xs-${createHash('sha256').update(`${SEED}:${n}`).digest('hex').slice(0, 20)}`;
  const left = records[SITES[0]][i];
  const right = records[SITES[1]][j];
  left.linkKey = linkKey;
  right.linkKey = linkKey;
  const e = left.treated === true || right.treated === true;
  const o = left.eventOccurred === true || right.eventOccurred === true;
  exposed += e ? 1 : 0;
  outcome += o ? 1 : 0;
  both += e && o ? 1 : 0;
});

for (const site of SITES)
  writeFileSync(join(dir, site, 'records.json'), JSON.stringify(records[site]));

console.log(
  JSON.stringify(
    {
      linked: pairs.length,
      perSite: Object.fromEntries(SITES.map((s) => [s, records[s].length])),
      expected: { cohortSize: pairs.length, exposed, outcome, exposedWithOutcome: both },
    },
    null,
    2,
  ),
);
