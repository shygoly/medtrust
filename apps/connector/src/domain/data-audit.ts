import {
  DataAuditReport,
  InternalRecord,
  QualityReport,
  VariableAudit,
} from './types';

/**
 * L1.5-data-audit — 逐变量缺失率审计与质量报告。
 *
 * Acceptance: 审计脚本对每个分析变量输出缺失率与分布摘要；任一变量缺失率>30%
 * 时流水线显式告警并写入质量报告。
 *
 * 目标模块契约（RED 阶段 spec 声明）:
 *   - `auditVariables(rows)` → `DataAuditReport`：逐变量 present/missing/
 *     missingRate/distribution + highMissingVariables
 *   - `buildQualityReport(report)` → `QualityReport`：质量报告（含高缺失变量清单）
 *
 * 设计约束:
 * - 确定性: 同一输入两次重跑产出完全一致的审计（变量序固定、分布按值排序）。
 * - 聚合语义: 只输出计数/比率/分布摘要，绝不携带行级或可识别数据（INV-GATE-01）。
 * - 缺失语义: 标量缺失 = null/undefined/''；数组缺失 = 字段本身非数组
 *   （空数组视为合法空集，计 present）；数值/布尔缺失 = null/undefined。
 */

/** 缺失率阈值: 任一变量缺失率 > 30% 即显式告警（= 0.3 不告警）。 */
export const HIGH_MISSING_THRESHOLD = 0.3;

interface AuditVariableDef {
  variable: string;
  kind: 'scalar' | 'array' | 'numeric';
}

/** 分析变量闭集（RWS 描述性分析的基线临床/人口字段）。 */
const AUDIT_VARIABLES: AuditVariableDef[] = [
  { variable: 'ageBand', kind: 'scalar' },
  { variable: 'sex', kind: 'scalar' },
  { variable: 'conditions', kind: 'array' },
  { variable: 'medications', kind: 'array' },
  { variable: 'adverseEvents', kind: 'array' },
];

function rowValue(row: InternalRecord, variable: string): unknown {
  return (row as unknown as Record<string, unknown>)[variable];
}

function isMissingValue(def: AuditVariableDef, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (def.kind === 'scalar') return value === '';
  if (def.kind === 'array') return !Array.isArray(value);
  return false; // numeric: 0 / false 是有效取值，不算缺失
}

/** 抽取分布计数用的「取值集合」：数组按元素摊平，标量/数值取单值。 */
function distributionValues(def: AuditVariableDef, value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  if (def.kind === 'array') return Array.isArray(value) ? (value as unknown[]) : [];
  return [value];
}

/** 对一组内部记录产出逐变量缺失率审计（聚合语义、确定性）。 */
export function auditVariables(rows: readonly InternalRecord[]): DataAuditReport {
  const totalRows = rows.length;
  const variables: VariableAudit[] = AUDIT_VARIABLES.map((def) => {
    let present = 0;
    let missing = 0;
    const dist = new Map<string, number>();
    for (const r of rows) {
      const value = rowValue(r, def.variable);
      if (isMissingValue(def, value)) {
        missing++;
      } else {
        present++;
        for (const v of distributionValues(def, value)) {
          const key = String(v);
          dist.set(key, (dist.get(key) ?? 0) + 1);
        }
      }
    }
    const missingRate = totalRows === 0 ? 0 : missing / totalRows;
    const distribution = [...dist.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value));
    return {
      variable: def.variable,
      present,
      missing,
      missingRate,
      distribution,
      flagged: missingRate > HIGH_MISSING_THRESHOLD,
    };
  });
  const highMissingVariables = variables
    .filter((v) => v.flagged)
    .map((v) => v.variable)
    .sort();
  return { totalRows, variables, highMissingVariables };
}

/** 由审计报告产出质量报告（含高缺失变量清单），引用同一审计对象。 */
export function buildQualityReport(report: DataAuditReport): QualityReport {
  return {
    totalRows: report.totalRows,
    highMissingVariables: [...report.highMissingVariables],
    audit: report,
  };
}

export type { DataAuditReport, QualityReport, VariableAudit } from './types';
