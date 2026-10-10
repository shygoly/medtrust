#!/usr/bin/env node
// check-kernel-purity — 基座纯度与依赖方向守护（D-SPD-18，用户决策 6「同意」）。
//
// 判据：
//   1) 基座目录内不得出现行业词（denylist）。匹配按 **词元 / camelCase 边界**，
//      禁裸子串——否则 'meter' 会误伤 'parameter'、'grid' 会误伤布局代码。
//   2) 依赖方向单向：包 → SPI → 基座。基座 MUST NOT 引用包；包之间 MUST NOT 互相 import。
//
// 用法：
//   node scripts/check-kernel-purity.mjs             # 目标布局（space-kernel / industries）
//   node scripts/check-kernel-purity.mjs --baseline  # P0 基线：以候选目录先报红
//   node scripts/check-kernel-purity.mjs --warn      # 只告警，恒退出 0
//   node scripts/check-kernel-purity.mjs --json
//   node scripts/check-kernel-purity.mjs --exclude-specs
//
// 注意：本脚本目前 **未** 接入 pnpm test（接入是 tasks.md P0/P11 的任务）。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DENYLIST = [
  'patient', 'cohort', 'hospital', 'drug', 'adverse', 'rws', 'omop', 'cdm',
  'kri', 'rbqm', 'vaccine', 'icd', 'snomed', 'loinc', 'ehr',
  'power', 'grid', 'ev', 'v2g', 'meter', 'cim', '61850',
];

// 目标布局（DOC2 §6）——落地后应存在。两种模式都检查（存在即扫，缺失仅提示）。
export const TARGET_KERNEL_DIRS = [
  'packages/space-kernel',
  'packages/space-kernel-spi',
  'packages/mdop',
  'apps/api/src/mdop',
  'apps/api/src/runtime/participant-identity',
  'apps/api/src/runtime/digital-contract',
  'apps/api/src/runtime/catalog',
  'apps/api/src/runtime/federation',
  'apps/api/src/runtime/space',
  'apps/api/src/runtime/organization',
  'apps/api/src/runtime/connector-tasks',
  'apps/api/src/runtime/connector-modules',
  'apps/api/src/runtime/endorsement-verification',
  'apps/api/src/runtime/silk-road',
  'apps/api/src/runtime/xian-integration',
  'apps/api/src/runtime/portal',
  'apps/api/src/runtime/settlement',
  'apps/connector/src/tee-node',
  'apps/connector/src/mdop',
];

// P0 基线：当前布局尚无 space-kernel / industries，用候选目录先把越界清单跑出来。
export const CANDIDATE_KERNEL_DIRS = [
  'packages/mdop/src',
  'apps/api/src/mdop',
  'apps/api/src/runtime/catalog',
  'apps/api/src/runtime/digital-contract',
  'apps/api/src/runtime/federation',
  'apps/api/src/runtime/space',
  'apps/api/src/runtime/organization',
  'apps/api/src/runtime/participant-identity',
  'apps/api/src/runtime/settlement',
  'apps/connector/src/mdop',
  'apps/connector/src/tee-node',
];

export const PACK_DIRS = [
  { id: 'med', fragments: ['industries/med', 'domain/med', '@medtrust/domain-med'] },
  { id: 'power', fragments: ['industries/power', 'domain/power', '@medtrust/domain-power'] },
];

const CODE_EXT = /\.(ts|tsx|js|mjs|cjs)$/;
const SKIP_DIR = /(^|\/)(node_modules|dist|build|\.git|coverage)(\/|$)/;
const SPEC_FILE = /\.(spec|test)\.(ts|tsx|js|mjs|cjs)$/;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

/** 按词元 + camelCase 边界切分，得到小写词元集合。 */
export function tokenize(text) {
  const out = [];
  for (const chunk of String(text).split(/[^A-Za-z0-9]+/)) {
    if (!chunk) continue;
    for (const part of chunk.split(/(?<=[a-z0-9])(?=[A-Z])/)) {
      if (part) out.push(part.toLowerCase());
    }
  }
  return out;
}

export function makeDenySet(denylist) {
  return new Set(denylist.map((d) => String(d).toLowerCase()));
}

/** 扫描单个文件里的行业词；includeComments=false 时跳过纯注释行。 */
export function scanFile(absPath, denySet, includeComments) {
  const hits = [];
  const lines = readFileSync(absPath, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!includeComments && COMMENT_LINE.test(line)) continue;
    const toks = new Set(tokenize(line));
    for (const tok of toks) {
      if (denySet.has(tok)) {
        hits.push({ line: i + 1, token: tok, text: line.trim().slice(0, 160) });
      }
    }
  }
  return hits;
}

/** 抽取 import / 动态 import 的模块说明符。 */
export function scanImports(absPath) {
  const src = readFileSync(absPath, 'utf8');
  const specs = [];
  const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) specs.push(m[1]);
  return specs;
}

function walk(absDir, out, excludeSpecs) {
  let entries;
  try {
    entries = readdirSync(absDir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const abs = join(absDir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIR.test(abs)) continue;
      walk(abs, out, excludeSpecs);
    } else if (CODE_EXT.test(name)) {
      if (excludeSpecs && SPEC_FILE.test(name)) continue;
      out.push(abs);
    }
  }
  return out;
}

/**
 * 基座纯度与依赖方向扫描。
 * @returns {{kernelDirs: string[], missingDirs: string[], scannedFiles: number,
 *            violations: object[], importViolations: object[], packDirsMissing: string[]}}
 */
export function scanKernelPurity(opts) {
  const root = resolve(opts.root || process.cwd());
  const kernelDirs = opts.kernelDirs || TARGET_KERNEL_DIRS;
  const packDirs = opts.packDirs || PACK_DIRS;
  const denySet = makeDenySet(opts.denylist || DENYLIST);
  const includeComments = !!opts.includeComments;
  const excludeSpecs = opts.excludeSpecs !== false;

  const present = [];
  const missingDirs = [];
  for (const rel of kernelDirs) {
    const abs = join(root, rel);
    if (existsSync(abs) && statSync(abs).isDirectory()) present.push(rel);
    else missingDirs.push(rel);
  }

  const files = [];
  for (const rel of present) walk(join(root, rel), files, excludeSpecs);

  const violations = [];
  const importViolations = [];
  for (const abs of files) {
    const rel = relative(root, abs);
    for (const hit of scanFile(abs, denySet, includeComments)) {
      violations.push({ file: rel, ...hit });
    }
    for (const spec of scanImports(abs)) {
      for (const pack of packDirs) {
        if (pack.fragments.some((f) => spec.includes(f))) {
          importViolations.push({ file: rel, spec, reason: 'kernel-imports-pack:' + pack.id });
        }
      }
    }
  }

  const packDirsMissing = [];
  for (const pack of packDirs) {
    for (const frag of pack.fragments) {
      const abs = join(root, frag);
      if (!existsSync(abs)) packDirsMissing.push(frag);
    }
  }

  return {
    kernelDirs: present,
    missingDirs,
    scannedFiles: files.length,
    violations,
    importViolations,
    packDirsMissing,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const warn = argv.includes('--warn');
  const baseline = argv.includes('--baseline');
  const excludeSpecs = !argv.includes('--include-specs');

  const result = scanKernelPurity({
    root: process.cwd(),
    kernelDirs: baseline ? CANDIDATE_KERNEL_DIRS : TARGET_KERNEL_DIRS,
    excludeSpecs,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const mode = baseline ? 'P0 基线（候选目录）' : '目标布局';
    console.log('[check-kernel-purity] 模式: ' + mode);
    console.log('[check-kernel-purity] 已扫基座目录: ' + result.kernelDirs.length +
      ' / 文件: ' + result.scannedFiles);
    if (result.missingDirs.length) {
      console.log('[check-kernel-purity] 尚不存在的目标目录: ' + result.missingDirs.length + ' 个');
    }
    if (result.violations.length) {
      const byFile = new Map();
      for (const v of result.violations) byFile.set(v.file, (byFile.get(v.file) || 0) + 1);
      console.log('[check-kernel-purity] 越界（行业词）: ' + result.violations.length +
        ' 处 / ' + byFile.size + ' 文件');
      for (const v of result.violations.slice(0, 40)) {
        console.log('  - ' + v.file + ':' + v.line + '  [' + v.token + ']  ' + v.text);
      }
      if (result.violations.length > 40) {
        console.log('  ... 其余 ' + (result.violations.length - 40) + ' 处省略（--json 取全量）');
      }
    }
    if (result.importViolations.length) {
      console.log('[check-kernel-purity] 越界（依赖方向）: ' + result.importViolations.length + ' 处');
      for (const v of result.importViolations.slice(0, 40)) {
        console.log('  - ' + v.file + '  -> ' + v.spec + '  (' + v.reason + ')');
      }
    }
    if (!result.violations.length && !result.importViolations.length) {
      console.log('[check-kernel-purity] 通过：基座目录内无行业词，依赖方向单向。');
    }
  }

  const bad = result.violations.length + result.importViolations.length;
  process.exit(warn || bad === 0 ? 0 : 1);
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
