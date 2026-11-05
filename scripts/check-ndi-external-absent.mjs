#!/usr/bin/env node
/**
 * check-ndi-external-absent.mjs — 「外部缺失总闸」的机检（ndi-external-absent-e2e）。
 *
 * 现网尚未对接丝路数港。六个 ndi-* 变更分别触碰对外上报、标识映射、新增对外端点、
 * 发布校验与任务执行前的策略判定；任何一处把「外部存在」当成前提，都会让系统在
 * 未对接环境里悄悄退化。本脚本把六条契约固化成确定性规则（纯文本判据，零依赖）：
 *
 *  C1 迁移只加列        —— 新迁移的 `up()` 只允许 ADD COLUMN，不得 DROP/ALTER TYPE
 *  C2 启动只 warn       —— 未配置外部时禁止在 onModuleInit 抛错
 *  C3 后台用 noop       —— 未配置 endpoint 必须装配 Noop，而不是 fail-closed client
 *  C4 预算隔离          —— 上报带超时（AbortController）且定时器 unref
 *  C5 存量 grandfather  —— 新增发布校验只在 isNew/转 regional/声明 spec 时生效
 *  C6 默认安全          —— 引擎缺省 legacy、目录服务缺省 off、推送只取 regional
 *
 * 用法：`node scripts/check-ndi-external-absent.mjs`（`--quiet` 只输出结论）。
 * 退出码：有 error 则 1。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = {
  migration: 'packages/database/src/migrations/control-plane/1762400000000-AddCatalogUpstreamListing.ts',
  regionService: 'apps/api/src/runtime/region-reporting/region-reporting.service.ts',
  regionReporter: 'apps/api/src/runtime/region-reporting/region-reporter.ts',
  silkRoad: 'apps/api/src/runtime/silk-road/silk-road.service.ts',
  catalog: 'apps/api/src/runtime/catalog/catalog.service.ts',
  pep: 'apps/connector/src/domain/policy-enforcement.ts',
  catalogQuery: 'apps/connector/src/domain/catalog-query/catalog-query.service.ts',
  worker: 'apps/connector/src/domain/connector-worker.service.ts',
};

function read(root, relative) {
  const path = join(root, relative);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** C1：迁移 `up()` 只加列。 */
function checkMigration(text, errors) {
  if (!text) return errors.push(`${FILES.migration}: 找不到迁移文件（C1）`);
  const parts = text.split(/async down\s*\(/);
  const up = parts[0] ?? '';
  if (!/ADD COLUMN IF NOT EXISTS/.test(up))
    errors.push(`${FILES.migration}: up() 未见 ADD COLUMN IF NOT EXISTS（C1 只加列）`);
  if (/DROP COLUMN|ALTER COLUMN|RENAME COLUMN/i.test(up))
    errors.push(`${FILES.migration}: up() 出现 DROP/ALTER/RENAME 列（C1 只加列）`);
}

/** C2：启动只 warn，不抛。 */
function checkStartup(text, errors) {
  if (!text) return errors.push(`${FILES.regionService}: 缺失（C2）`);
  const init = text.split('onModuleInit')[1]?.split('onModuleDestroy')[0] ?? '';
  if (!/logger\.warn/.test(init))
    errors.push(`${FILES.regionService}: onModuleInit 未在未配置时 warn（C2）`);
  if (/\bthrow\b/.test(init))
    errors.push(`${FILES.regionService}: onModuleInit 出现 throw（C2 启动不得因外部缺失失败）`);
}

/** C3：未配置 → Noop；不得引 fail-closed client 做后台上报。 */
function checkNoop(text, serviceText, errors) {
  if (!text) return errors.push(`${FILES.regionReporter}: 缺失（C3）`);
  if (!/class NoopRegionStateReporter/.test(text))
    errors.push(`${FILES.regionReporter}: 缺 NoopRegionStateReporter（C3）`);
  if (!/if \(!endpoint\) return new NoopRegionStateReporter\(\)/.test(text))
    errors.push(`${FILES.regionReporter}: 未配置时未装配 Noop（C3）`);
  if (serviceText && /FailClosedSilkRoadClient/.test(serviceText))
    errors.push(`${FILES.regionService}: 后台上报不得使用 FailClosedSilkRoadClient（C3）`);
}

/** C4：超时 + unref。 */
function checkBudget(text, serviceText, errors) {
  if (!text || !/AbortController/.test(text))
    errors.push(`${FILES.regionReporter}: 上报缺 AbortController 超时（C4）`);
  if (!serviceText || !/\.unref\?\.\(\)/.test(serviceText))
    errors.push(`${FILES.regionService}: 定时器未 unref（C4 不阻止退出）`);
}

/** C5：grandfather 条件齐全。 */
function checkGrandfather(text, errors) {
  if (!text) return errors.push(`${FILES.catalog}: 缺失（C5）`);
  for (const needle of ['ctx.isNew', 'becomingRegional', 'declaringSpec'])
    if (!text.includes(needle))
      errors.push(`${FILES.catalog}: validateListing 缺 ${needle}（C5 存量 grandfather）`);
}

/** C6：默认安全。 */
function checkDefaults(files, errors) {
  if (!files.pep || !/(USAGE_CONTROL_ENGINE \?\? ['"]legacy['"])/.test(files.pep))
    errors.push(`${FILES.pep}: 引擎缺省值不是 legacy（C6）`);
  if (!files.catalogQuery || !/CONNECTOR_CATALOG_SERVICE \?\? ['"]off['"]/.test(files.catalogQuery))
    errors.push(`${FILES.catalogQuery}: 目录服务缺省值不是 off（C6）`);
  if (!files.silkRoad || !/listingScope:\s*["']regional["']/.test(files.silkRoad))
    errors.push(`${FILES.silkRoad}: 目录推送未限定 listingScope=regional（C6 默认不外发）`);
  if (!files.worker || !/心跳上报失败/.test(files.worker))
    errors.push(`${FILES.worker}: 心跳失败未降级为 warn（C6 不阻塞主链路）`);
}

export function runNdiExternalAbsentCheck(input = {}) {
  const root = input.root ?? ROOT;
  const errors = [];
  const warnings = [];
  const files = {};
  for (const [key, relative] of Object.entries(FILES)) {
    files[key] = input.files?.[relative] ?? read(root, relative);
  }

  checkMigration(files.migration, errors);
  checkStartup(files.regionService, errors);
  checkNoop(files.regionReporter, files.regionService, errors);
  checkBudget(files.regionReporter, files.regionService, errors);
  checkGrandfather(files.catalog, errors);
  checkDefaults(files, errors);

  return { errors, warnings, contracts: 6 };
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const result = runNdiExternalAbsentCheck();
  if (!quiet) {
    console.log('ndi-external-absent 总闸：外部缺失/不可达时的六条契约');
    for (const warning of result.warnings) console.warn(`[WARN] ${warning}`);
    for (const error of result.errors) console.error(`[ERROR] ${error}`);
  }
  if (result.errors.length > 0) {
    console.error(`check-ndi-external-absent: ${result.errors.length} error(s)`);
    process.exit(1);
  }
  console.log(`check-ndi-external-absent: 0 error(s)（${result.contracts} 条契约）`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
