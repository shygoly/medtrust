/**
 * L1.5-data-audit — RED 阶段测试（新模块目标契约）。
 *
 * Acceptance: 审计脚本对每个分析变量输出缺失率与分布摘要；任一变量缺失率>30%
 * 时流水线显式告警并写入质量报告。
 *
 * 目标模块 `./data-audit` 尚不存在，整个套件红（Cannot find module）。这是
 * target contract：实现落地后这些测试应转绿。声明形状：
 *   - `auditVariables(rows)` → `DataAuditReport`：逐变量 present/missing/
 *     missingRate/distribution + highMissingVariables
 *   - `buildQualityReport(report)` → `QualityReport`：质量报告（含高缺失变量清单）
 */
import { InternalRecord } from './types';
import {
  auditVariables,
  buildQualityReport,
  DataAuditReport,
  QualityReport,
  VariableAudit,
} from './data-audit';

const DRUG = '注射用紫杉醇';

function rec(over: Partial<InternalRecord>): InternalRecord {
  return {
    subjectKey: 'sk-' + Math.random(),
    ageBand: '40-49',
    sex: 'M',
    conditions: [],
    medications: [DRUG],
    adverseEvents: [],
    ...over,
  };
}

describe('data-audit — 逐变量缺失率审计与质量报告', () => {
  it('对每个分析变量输出缺失率与分布摘要', () => {
    const rows: InternalRecord[] = [
      rec({ subjectKey: 'r1', sex: 'M' }),
      rec({ subjectKey: 'r2', sex: 'F' }),
      rec({ subjectKey: 'r3', sex: undefined }), // sex 缺失 1/3
    ];
    const report: DataAuditReport = auditVariables(rows);
    const sexAudit: VariableAudit | undefined = report.variables.find(
      (v) => v.variable === 'sex',
    );
    expect(sexAudit).toBeDefined();
    expect(sexAudit!.present).toBe(2);
    expect(sexAudit!.missing).toBe(1);
    expect(sexAudit!.missingRate).toBeCloseTo(1 / 3, 5);
    expect(sexAudit!.distribution).toContainEqual({ value: 'M', count: 1 });
    expect(sexAudit!.distribution).toContainEqual({ value: 'F', count: 1 });
  });

  it('缺失率>30% 的变量被标记并列入 highMissingVariables', () => {
    const rows: InternalRecord[] = [
      rec({ subjectKey: 'r1', sex: 'M' }),
      rec({ subjectKey: 'r2', sex: undefined }),
      rec({ subjectKey: 'r3', sex: undefined }),
      rec({ subjectKey: 'r4', sex: undefined }), // 3/4 = 75% 缺失
    ];
    const report: DataAuditReport = auditVariables(rows);
    expect(report.highMissingVariables).toContain('sex');
    const sexAudit = report.variables.find((v) => v.variable === 'sex');
    expect(sexAudit?.flagged).toBe(true);
    expect(sexAudit?.missingRate).toBeGreaterThan(0.3);
  });

  it('缺失率≤30% 的变量不告警（阈值恰为 30%）', () => {
    const rows: InternalRecord[] = [
      rec({ subjectKey: 'r1', sex: 'M' }),
      rec({ subjectKey: 'r2', sex: 'F' }),
      rec({ subjectKey: 'r3', sex: undefined }),
      rec({ subjectKey: 'r4', sex: 'M' }), // 1/4 = 25% 缺失，未超阈值
    ];
    const report: DataAuditReport = auditVariables(rows);
    expect(report.highMissingVariables).not.toContain('sex');
  });

  it('buildQualityReport 产出质量报告并列出高缺失变量', () => {
    const rows: InternalRecord[] = [
      rec({ subjectKey: 'r1', sex: 'M' }),
      rec({ subjectKey: 'r2', sex: undefined }),
      rec({ subjectKey: 'r3', sex: undefined }),
      rec({ subjectKey: 'r4', sex: undefined }),
    ];
    const report: DataAuditReport = auditVariables(rows);
    const qr: QualityReport = buildQualityReport(report);
    expect(qr.highMissingVariables).toContain('sex');
    expect(qr.totalRows).toBe(4);
    expect(qr.audit).toBe(report);
  });

  it('同一输入两次重跑产出完全一致的审计（可复现）', () => {
    const rows: InternalRecord[] = [
      rec({ subjectKey: 'r1', sex: 'M' }),
      rec({ subjectKey: 'r2', sex: undefined }),
      rec({ subjectKey: 'r3', sex: 'F' }),
    ];
    const first: DataAuditReport = auditVariables(rows);
    const second: DataAuditReport = auditVariables(rows);
    expect(second.variables).toEqual(first.variables);
    expect(second.highMissingVariables).toEqual(first.highMissingVariables);
  });
});
