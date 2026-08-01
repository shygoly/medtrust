import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { InternalRecord, TteSpec } from './types';
import { matchesCondition, matchesMedication } from './clinical-matching';

/**
 * L1.5-cohort-def — 协议队列纳入/排除的「可执行判定」模块。
 *
 * Gap 修复: 队列纳入/排除标准此前仅存在于文本协议 (`tte.inclusion` /
 * `tte.exclusion` 为 string[]), `causal-materializer.matchesRule` 对
 * `age>=` / `ckd_stage>=` 直接返回 true (no-op), 导致 L1.5 与下游层级无法
 * 复现同一队列。本模块把协议规则转成结构化、可执行、可复现的判定, 并让
 * 判定规则定义带上 git 版本标签。
 *
 * 设计约束:
 * - 确定性: 同一输入两次重跑产出完全一致的队列 (人数与 patientId 集合 100%
 *   一致)。
 * - 可执行: 规则为闭集文法 (pregnancy / age>=N / age<N / ckd_stage>=N /
 *   sex=M|F / drug:X / condition:X), 逐条可判定, 未知文法 fail-closed。
 * - 版本化: 判定规则定义带 git 短 SHA (或 semver 兜底)。
 */

export interface CohortDefinition {
  /** 稳定 id — 同一批规则 → 同一 id (内容哈希), 跨重跑可对账。 */
  id: string;
  /** git 短 SHA (或 semver 兜底) — 规则定义文件的版本标签。 */
  version: string;
  inclusion: string[];
  exclusion: string[];
  exposureArm?: string;
  comparatorArm?: string;
  timeZeroRule?: string;
}

export interface CohortSelection {
  count: number;
  patientIds: string[];
}

/** Age band 的下界: '40-49' → 40; '0-9' → 0; '80+' → 80; '65' → 65. 无法解析 → undefined. */
export function ageBandLowerBound(ageBand: string | undefined): number | undefined {
  if (!ageBand) return undefined;
  const band = ageBand.trim();
  if (!band) return undefined;
  const range = band.match(/^(\d+)\s*[-~]/);
  if (range) return Number(range[1]);
  const plus = band.match(/^(\d+)\s*\+$/);
  if (plus) return Number(plus[1]);
  const exact = band.match(/^(\d+)$/);
  if (exact) return Number(exact[1]);
  return undefined;
}

/** 条件里的 CKD 分期: 'Chronic kidney disease stage 3' → 3; '慢性肾病3期' → 3. */
export function ckdStage(conditions: readonly string[]): number | undefined {
  for (const c of conditions) {
    const en =
      c.match(/ckd\s+stage\s*(\d+)/i) ??
      c.match(/chronic\s+kidney\s+disease\s+stage\s*(\d+)/i);
    if (en) return Number(en[1]);
    const zh = c.match(/慢性肾病\s*(\d+)\s*期/);
    if (zh) return Number(zh[1]);
    const zhGeneric = c.match(/肾病.*?(\d)\s*期/);
    if (zhGeneric) return Number(zhGeneric[1]);
  }
  return undefined;
}

/**
 * 判定规则是否为模块支持的闭集文法（可执行、可复现）:
 *   pregnancy | 妊娠        → 条件含妊娠
 *   age>=N | age<N          → 按 ageBand 下界比较
 *   ckd_stage>=N            → 按条件里的 CKD 分期比较
 *   sex=M | sex=F           → 按 sex 比较
 *   drug:X | medication:X   → 按用药匹配
 *   condition:X             → 按条件匹配
 *
 * 空串视为 no-op（支持）。未知文法返回 false —— 供调用方 fail-closed:
 * 无法验证的规则不得让记录静默混入队列。
 */
export function isSupportedCohortRule(rule: string): boolean {
  const s = rule.trim();
  if (!s) return true;
  if (/^pregnancy$|^pregnant$|妊娠/.test(s)) return true;
  if (/^age\s*>=\s*(\d+)$/i.test(s)) return true;
  if (/^age\s*<\s*(\d+)$/i.test(s)) return true;
  if (/^ckd_stage\s*>=\s*(\d+)$/i.test(s)) return true;
  if (/^sex\s*=\s*([MF])$/i.test(s)) return true;
  if (/^(?:drug|medication):(.+)$/i.test(s)) return true;
  if (/^condition:(.+)$/i.test(s)) return true;
  return false;
}

/**
 * 逐条判定一个协议队列规则对某条记录是否成立。
 *
 * 闭集文法 (可执行、可复现):
 *   pregnancy | 妊娠        → 条件含妊娠
 *   age>=N | age<N          → 按 ageBand 下界比较
 *   ckd_stage>=N            → 按条件里的 CKD 分期比较
 *   sex=M | sex=F           → 按 sex 比较
 *   drug:X | medication:X   → 按用药匹配
 *   condition:X             → 按条件匹配
 *
 * 未知文法 fail-closed (返回 false): 无法验证的规则不得让记录静默混入队列。
 */
export function evaluateCohortRule(row: InternalRecord, rule: string): boolean {
  const s = rule.trim();
  if (!s) return true;

  if (/^pregnancy$|^pregnant$|妊娠/.test(s)) {
    return row.conditions.some((c) => c.includes('妊娠') || /pregnan/i.test(c));
  }

  const ageGte = s.match(/^age\s*>=\s*(\d+)$/i);
  if (ageGte) {
    const lower = ageBandLowerBound(row.ageBand);
    return lower !== undefined && lower >= Number(ageGte[1]);
  }

  const ageLt = s.match(/^age\s*<\s*(\d+)$/i);
  if (ageLt) {
    const lower = ageBandLowerBound(row.ageBand);
    return lower !== undefined && lower < Number(ageLt[1]);
  }

  const ckd = s.match(/^ckd_stage\s*>=\s*(\d+)$/i);
  if (ckd) {
    const stage = ckdStage(row.conditions);
    return stage !== undefined && stage >= Number(ckd[1]);
  }

  const sex = s.match(/^sex\s*=\s*([MF])$/i);
  if (sex) {
    return (row.sex ?? '').toUpperCase() === sex[1].toUpperCase();
  }

  const drug = s.match(/^(?:drug|medication):(.+)$/i);
  if (drug) return matchesMedication(row.medications, drug[1].trim());

  const condition = s.match(/^condition:(.+)$/i);
  if (condition) return matchesCondition(row.conditions, condition[1].trim());

  return false;
}

/** 记录通过队列判定 ⇔ 满足全部 inclusion 且不命中任何 exclusion。未知文法 fail-closed。 */
export function passesCohortDefinition(
  row: InternalRecord,
  def: Pick<CohortDefinition, 'inclusion' | 'exclusion'>,
): boolean {
  for (const rule of def.inclusion) {
    if (!isSupportedCohortRule(rule)) return false;
    if (!evaluateCohortRule(row, rule)) return false;
  }
  for (const rule of def.exclusion) {
    if (!isSupportedCohortRule(rule)) return false;
    if (evaluateCohortRule(row, rule)) return false;
  }
  return true;
}

/**
 * 确定性队列选择 — 同一数据 + def ⇒ 同一 patientIds（与读取物理行序无关）。
 *
 * 「患者 ID 集合」语义：同一 subjectKey 只计一次；输出按 subjectKey 排序，
 * 保证同一数据库版本任意两次重跑产出完全一致的队列（人数与患者 ID 集合 100% 一致）。
 */
export function selectCohort(rows: readonly InternalRecord[], def: CohortDefinition): CohortSelection {
  const seen = new Set<string>();
  for (const r of rows) {
    if (passesCohortDefinition(r, def) && r.subjectKey) seen.add(r.subjectKey);
  }
  const patientIds = [...seen].sort();
  return { count: patientIds.length, patientIds };
}

let versionCache: string | undefined;

/** 规则定义来源的 git 短 SHA; 非 git checkout 环境回落 semver 标签。 */
function resolveGitVersion(): string {
  if (versionCache) return versionCache;
  try {
    versionCache = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    versionCache = '0.0.0';
  }
  return versionCache;
}

/** 把分析的 TTE 协议块转成可执行、带 git 版本标签的队列定义。 */
export function resolveCohortDefinition(analysis: { tte?: TteSpec }): CohortDefinition {
  const tte: TteSpec | undefined = analysis.tte;
  if (!tte) throw new Error('resolveCohortDefinition 须声明 tte 块');
  const inclusion = [...(tte.inclusion ?? [])];
  const exclusion = [...(tte.exclusion ?? [])];
  const exposureArm = tte.exposureArm;
  const comparatorArm = tte.comparatorArm;
  const timeZeroRule = tte.timeZeroRule;
  const canonical = JSON.stringify({ inclusion, exclusion, exposureArm, comparatorArm, timeZeroRule });
  const id = 'cohort:' + createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  return { id, version: resolveGitVersion(), inclusion, exclusion, exposureArm, comparatorArm, timeZeroRule };
}
