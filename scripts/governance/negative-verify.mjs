#!/usr/bin/env node
// negative-verify.mjs — MedTrust 工厂校验器负向验证（VC-7 / VC-8 / FR-3）
//
// 覆盖工厂校验器在 MedTrust 上实际生效的维度：FC（格式契约先验）· AG（AGENTS 入口）。
// DOMAIN/FLOWS/DECISIONS 由 skipChecks 跳过（自有 check-meta-docs.mjs 守护），不在本套范围。
// DP（DEPLOY）待 env 治理问题（DP-4/DP-5）修复后补入。
//
// 用 only 参数隔离被测维度，避免基线中 DEPLOY 的已知红干扰判定。
// 协议：基线（仅被测维度）须绿 → 注入 → 须红且消息命中 → 回滚 → 须绿。
//
// 用法：node scripts/governance/negative-verify.mjs  （或 npm run governance:negative）

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const runAll = join(root, 'vendor/ai-factory/factory/verifiers/run-all.mjs');
const adapter = join(root, 'governance.adapter.mjs');

// only 参数让 run-all 只跑匹配标签的检查（绕过 DEPLOY 已知红）
const run = (only) => {
  const args = ['node', runAll, adapter];
  if (only) args.push(only);
  try { execFileSync(args[0], args.slice(1), { encoding: 'utf8', stdio: 'pipe' }); return { red: false, out: '' }; }
  catch (e) { return { red: true, out: (e.stdout ?? '') + (e.stderr ?? '') }; }
};

// ── FC 格式契约先验：破坏 AGENT-OPS.md 抬头块 → FC-2 红 ──────
const fcCase = {
  dim: 'FC-2 AGENT-OPS 抬头块',
  file: join(root, 'AGENT-OPS.md'),
  only: '格式契约',
  mutate: (s) => s.replace(/^# [^\n]*\n+>\s/m, '# AGENT-OPS.md\n\n非引用块。\n'),
};

// ── AG AGENTS 入口：注入数字断言 → AG-3 红 ───────────────────
const agCase = {
  dim: 'AG-3 AGENTS 数字断言',
  file: join(root, 'AGENTS.md'),
  only: 'AGENTS',
  mutate: (s) => s + '\n<!-- 负向注入 -->本系统现有 100 张表、50 个枚举。\n',
};

const cases = [fcCase, agCase];
let failed = 0;
console.log('负向验证（MedTrust）—— 每条维度：注入 → 须红且消息命中 → 回滚 → 须绿\n');

for (const { dim, file, only, mutate } of cases) {
  // 基线：仅被测维度须绿
  if (run(only).red) {
    console.error(`✗ ${dim}：基线（仅 ${only}）不绿，负向验证无法进行（FINV-8）`);
    failed++; continue;
  }
  const original = readFileSync(file, 'utf8');
  const mutated = mutate(original);
  if (mutated === original) {
    console.error(`✗ ${dim}：注入未生效（锚点已变，用例需更新）—— 不得静默跳过`);
    failed++; continue;
  }
  writeFileSync(file, mutated);
  const r = run(only);
  writeFileSync(file, original);
  const back = run(only);

  const tag = dim.split(/\s/)[0];
  if (!r.red) { console.error(`✗ ${dim}：注入违规后仍为绿 —— 假绿`); failed++; }
  else if (!r.out.includes(tag)) { console.error(`✗ ${dim}：报红但消息未命中维度 ${tag}`); failed++; }
  else if (back.red) { console.error(`✗ ${dim}：回滚后仍红 —— 注入未完全回滚`); failed++; }
  else console.log(`  ✓ ${dim}：注入 → 红（消息命中）· 回滚 → 绿`);
}

console.log('━'.repeat(60));
if (failed) { console.error(`✗ 负向验证（MedTrust）：${failed}/${cases.length} 项未通过`); process.exit(1); }
console.log(`✓ 负向验证（MedTrust）：${cases.length}/${cases.length} 条用例全部通过（VC-8 · FC/AG 两维度）`);
console.log('  注：DP（DEPLOY）维度待 env 治理问题修复后补入。');
