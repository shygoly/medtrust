#!/usr/bin/env node
/**
 * check-orchestration.mjs — 编排迁移台账的机检（D-MDOP-7，openspec 能力 orchestration-kernel）。
 *
 * 台账 apps/api/src/runtime/orchestration/orchestration.migration.json 是「哪个分析/作业类型由哪条
 * 通道执行」的唯一事实源。本守护让「迁移是过程、不是两种并列能力」变成可机检的状态：
 *
 *  O1 形状：schemaVersion；key 唯一；channel 与 state 取值在闭集内；字段齐全。
 *  O2 只减不增：legacy 条目数 <= legacyBudget；有 git 基线时 budget 与条目数都不得上升。
 *  O3 证据：channel=mdop 需等价性证据，或带未过期 expires 的 verification 块；
 *           state=legacy-removed 必须有真实证据；mdop-native（无旧通道）豁免。
 *  O4 零残留：state=legacy-removed 时，legacyRefs 指到的路径/标记必须已消失（下线闸门③）。
 *  O6 保留实现不是下线目标：retained 里的实现要么被两条通道共用（shared-runtime），要么是运行中的
 *     对照基准（test-reference）。两者都 MUST NOT 作为 legacyRefs 的裸字符串出现（= 声明要删整个文件），
 *     路径必须存在；带 mustContain 的还要求该标记仍在。
 *  O5 旧通道的状态有落点：channel=legacy 时，legacyStorage=tables（缺省）须声明非空 legacyTables；
 *           legacyStorage=in-memory（如 SecretFlow LoRA 的内存态）须用 legacyRefs 指明持有该状态的代码。
 *
 * 用法：node scripts/check-orchestration.mjs [--ledger <path>] [--no-baseline] [--json]
 * 负例自检：node --test scripts/check-orchestration.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LEDGER = 'apps/api/src/runtime/orchestration/orchestration.migration.json';

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
const ledgerRel = argOf('--ledger') || DEFAULT_LEDGER;
const ledgerPath = isAbsolute(ledgerRel) ? ledgerRel : join(ROOT, ledgerRel);
const useBaseline = !argv.includes('--no-baseline');
const asJson = argv.includes('--json');

const CHANNELS = ['mdop', 'legacy'];
const STATES = ['pending', 'in-migration', 'migrated', 'verification', 'legacy-removed'];
const KINDS = ['rws-analysis', 'fl-workload', 'mdop-native'];
const MDOP_CHANNEL_STATES = ['migrated', 'verification', 'legacy-removed'];

const errors = [];
const notes = [];
const err = (m) => errors.push(m);

function load() {
  if (!existsSync(ledgerPath)) {
    err('台账文件不存在：' + ledgerRel);
    return null;
  }
  try {
    return JSON.parse(readFileSync(ledgerPath, 'utf8'));
  } catch (e) {
    err('台账不是合法 JSON：' + (e && e.message));
    return null;
  }
}

function baseline() {
  if (!useBaseline) return null;
  try {
    const raw = execFileSync('git', ['show', 'HEAD:' + ledgerRel], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(raw);
  } catch {
    notes.push('git 基线不可得（首次引入或非 git 工作区）→ 跳过 O2 的基线比较');
    return null;
  }
}

const isRefObject = (r) => r && typeof r === 'object' && typeof r.path === 'string';
const refStillPresent = (r) => {
  const rel = isRefObject(r) ? r.path : r;
  const abs = isAbsolute(rel) ? rel : join(ROOT, rel);
  if (!existsSync(abs)) return null;
  if (!isRefObject(r) || typeof r.mustNotContain !== 'string') return rel;
  const text = readFileSync(abs, 'utf8');
  return text.includes(r.mustNotContain) ? rel + ' 仍含 "' + r.mustNotContain + '"' : null;
};
const unexpired = (v) => {
  if (!v || typeof v !== 'object') return false;
  if (typeof v.expires !== 'string') return false;
  const t = Date.parse(v.expires);
  return Number.isFinite(t) && t > Date.now();
};

const ledger = load();
let summary = null;
if (ledger) {
  if (ledger.schemaVersion !== 1) err('schemaVersion 必须为 1，实为 ' + JSON.stringify(ledger.schemaVersion));
  const budget = ledger.legacyBudget;
  if (!Number.isInteger(budget) || budget < 0) err('legacyBudget 必须是非负整数，实为 ' + JSON.stringify(budget));
  const channels = ledger.channels;
  if (!Array.isArray(channels) || channels.length === 0) {
    err('channels 必须是非空数组');
  } else {
    const seen = new Set();
    const stateCount = {};
    let legacyCount = 0;
    for (const c of channels) {
      const at = c && c.key ? '[' + c.key + '] ' : '';
      if (!c || typeof c !== 'object') { err('条目必须是对象'); continue; }
      if (typeof c.key !== 'string' || !c.key) err(at + 'key 必填');
      else if (seen.has(c.key)) err(at + 'duplicate key');
      else seen.add(c.key);
      if (!KINDS.includes(c.kind)) err(at + 'kind 取值非法：' + JSON.stringify(c.kind));
      if (!CHANNELS.includes(c.channel)) err(at + 'channel 取值非法：' + JSON.stringify(c.channel));
      if (!STATES.includes(c.state)) err(at + 'state 取值非法：' + JSON.stringify(c.state));
      if (!Array.isArray(c.legacyTables)) err(at + 'legacyTables 必须是数组');
      if (!Array.isArray(c.legacyRefs)) err(at + 'legacyRefs 必须是数组');

      if (c.channel === 'mdop' && !MDOP_CHANNEL_STATES.includes(c.state)) {
        err(at + 'channel=mdop 的 state 必须是 ' + MDOP_CHANNEL_STATES.join('/'));
      }
      if (c.channel === 'legacy') {
        legacyCount += 1;
        if (c.legacyStorage === 'in-memory') {
          if (!Array.isArray(c.legacyRefs) || c.legacyRefs.length === 0) {
            err(at + 'channel=legacy 且 legacyStorage=in-memory 时必须用 legacyRefs 指明持有该状态的代码（O5）');
          }
        } else if (!Array.isArray(c.legacyTables) || c.legacyTables.length === 0) {
          err(at + 'channel=legacy 必须声明非空 legacyTables（O5）');
        }
      }
      // O3 证据
      if (c.kind !== 'mdop-native') {
        const hasEvidence = typeof c.equivalenceEvidence === 'string' && c.equivalenceEvidence.length > 0;
        if (c.state === 'legacy-removed' && !hasEvidence) {
          err(at + 'state=legacy-removed 必须附等价性证据（equivalenceEvidence）');
        }
        if (c.channel === 'mdop' && c.state !== 'legacy-removed' && !hasEvidence && !unexpired(c.verification)) {
          err(at + 'channel=mdop 需要等价性证据，或带未过期 expires 的 verification 块（O3）');
        }
        if (c.verification && !unexpired(c.verification)) {
          err(at + 'verification.expires 已过期或缺失（' + JSON.stringify(c.verification && c.verification.expires) + '）');
        }
      }
      // O4 零残留
      if (c.state === 'legacy-removed') {
        for (const r of c.legacyRefs || []) {
          const still = refStillPresent(r);
          if (still) err(at + 'legacyRefs 残留：' + still + '（下线闸门③未满足）');
        }
      }
      // O6 保留实现不得被整个删掉
      if (c.retained !== undefined) {
        if (!Array.isArray(c.retained)) err(at + 'retained 必须是数组');
        else {
          const bareRefs = (c.legacyRefs || []).filter((r) => !isRefObject(r));
          for (const r of c.retained) {
            if (!r || typeof r.path !== 'string') {
              err(at + 'retained 项必须是 { path, reason, note? }');
              continue;
            }
            if (!['shared-runtime', 'test-reference'].includes(r.reason)) {
              err(at + 'retained.reason 取值非法：' + JSON.stringify(r.reason));
            }
            const abs = isAbsolute(r.path) ? r.path : join(ROOT, r.path);
            if (!existsSync(abs)) {
              err(at + 'retained 路径不存在：' + r.path);
              continue;
            }
            if (bareRefs.includes(r.path)) {
              err(at + 'retained 与 legacyRefs 冲突：' + r.path + ' 既被声明要删整个文件、又被声明必须保留');
            }
            if (typeof r.mustContain === 'string' && !readFileSync(abs, 'utf8').includes(r.mustContain)) {
              err(at + 'retained 标记已消失：' + r.path + ' 不含 ' + JSON.stringify(r.mustContain));
            }
          }
        }
      }
      stateCount[c.state] = (stateCount[c.state] || 0) + 1;
    }
    // O2 只减不增
    if (Number.isInteger(budget) && legacyCount > budget) {
      err('legacy 条目数 ' + legacyCount + ' 超过 legacyBudget ' + budget + '（只减不增）');
    }
    const base = baseline();
    if (base) {
      const baseLegacy = Array.isArray(base.channels) ? base.channels.filter((x) => x && x.channel === 'legacy').length : null;
      if (Number.isInteger(base.legacyBudget) && Number.isInteger(budget) && budget > base.legacyBudget) {
        err('legacyBudget 上升：' + base.legacyBudget + ' -> ' + budget + '（只减不增）');
      }
      if (Number.isInteger(baseLegacy) && legacyCount > baseLegacy) {
        err('legacy 条目数上升：' + baseLegacy + ' -> ' + legacyCount + '（只减不增）');
      }
    }
    summary = { keys: channels.length, legacy: legacyCount, legacyBudget: budget, states: stateCount };
  }
}

if (asJson) {
  console.log(JSON.stringify({ ledger: ledgerRel, summary, errors, notes }, null, 2));
} else if (ledger) {
  for (const n of notes) console.log('[NOTE] ' + n);
  if (summary) {
    console.log('[orchestration] 台账 ' + ledgerRel);
    console.log('  条目 ' + summary.keys + ' · legacy ' + summary.legacy + '/' + summary.legacyBudget + ' · ' +
      Object.entries(summary.states).map(([k, v]) => k + '=' + v).join(' '));
  }
  for (const e of errors) console.log('[ERR] ' + e);
  if (errors.length === 0) console.log('check-orchestration: 0 error(s)（单一通道 · legacy 只减不增 · 下线闸门可判）');
}
if (errors.length > 0) {
  if (!asJson) console.log('check-orchestration: ' + errors.length + ' error(s)');
  process.exit(1);
}
process.exit(0);
