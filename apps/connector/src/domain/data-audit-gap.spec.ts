/**
 * L1.5-data-audit — RED 阶段测试（锚定既有代码缺陷）。
 *
 * Gap: 关键变量（吸烟史、合并症评分等）缺失率/异常值未系统统计，高缺失变量
 * 未被标记，污染下游建模。
 *
 * Acceptance: 审计脚本对每个分析变量输出缺失率与分布摘要；任一变量缺失率>30%
 * 时流水线显式告警并写入质量报告。
 *
 * 这些用例全部锚定既有 RwsExecutor 的当前行为：聚合结果不携带任何逐变量
 * 缺失率/分布审计，也没有质量报告——每条断言都因该功能缺失而红
 * （断言级失败，is_assertion_failure=true）。
 */
import { AuditService } from './audit';
import { Deidentifier } from './deidentifier';
import { LocalStore } from './local-store';
import { createTestMdopExecutor } from '../test/mdop-local-executor';
import { AggregateResult, InternalRecord } from './types';

const DRUG = '注射用紫杉醇';
const ae = (term: string) => [{ organSystem: '肝胆系统', term, serious: false }];

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

/**
 * 放宽后的聚合结果形状：`dataAudit` / `qualityReport` 是 L1.5-data-audit 的目标
 * 契约字段，尚不存在于 `AggregateResult` 类型——此处用交集类型标注，使断言
 * 可编译并在运行时对 undefined 红（避免把"功能缺失"错变成"类型编译错误"）。
 */
type AuditedAggregate = AggregateResult & {
  dataAudit?: {
    totalRows: number;
    variables: Array<{
      variable: string;
      present: number;
      missing: number;
      missingRate: number;
      distribution: Array<{ value: string; count: number }>;
      flagged: boolean;
    }>;
    highMissingVariables: string[];
  };
  qualityReport?: {
    totalRows: number;
    highMissingVariables: string[];
    audit: unknown;
  };
};

function runCohortCount(rows: InternalRecord[]): Promise<AuditedAggregate> {
  const audit = new AuditService();
  const store = new LocalStore(audit);
  store.replaceAll(rows);
  const bands = [...new Set(rows.map((r) => r.ageBand).filter(Boolean))] as string[];
  const exec = createTestMdopExecutor({ id: 'spec-audit', store, categoryKeys: bands });
  return Promise.resolve(exec.run({ type: 'cohort-count', level: 'L1.5' }) as AuditedAggregate);
}

describe('L1.5-data-audit — 逐变量缺失率审计必须随聚合结果流出', () => {
  it('聚合结果必须对每个分析变量输出缺失率与分布摘要（dataAudit.variables）', async () => {
    const rows: InternalRecord[] = [
      rec({ subjectKey: 'r1', sex: 'M' }),
      rec({ subjectKey: 'r2', sex: 'F' }),
      rec({ subjectKey: 'r3', sex: undefined }), // sex 缺失 1/3
    ];
    const out = await runCohortCount(rows);
    // 当前实现从未挂 dataAudit → undefined，断言红
    expect(out.dataAudit).toBeDefined();
    const sexAudit = out.dataAudit!.variables.find((v) => v.variable === 'sex');
    expect(sexAudit).toBeDefined();
    expect(sexAudit!.missing).toBe(1);
    expect(sexAudit!.missingRate).toBeCloseTo(1 / 3, 5);
    // 分布摘要须含 M/F 计数
    const dist = sexAudit!.distribution.map((d) => ({ value: d.value, count: d.count }));
    expect(dist).toContainEqual({ value: 'M', count: 1 });
    expect(dist).toContainEqual({ value: 'F', count: 1 });
  });

  it('缺失率>30% 的变量必须被显式标记（highMissingVariables）', async () => {
    const rows: InternalRecord[] = [
      rec({ subjectKey: 'r1', sex: 'M' }),
      rec({ subjectKey: 'r2', sex: undefined }),
      rec({ subjectKey: 'r3', sex: undefined }),
      rec({ subjectKey: 'r4', sex: undefined }), // sex 缺失 3/4 = 75%
    ];
    const out = await runCohortCount(rows);
    // 当前无审计 → out.dataAudit 为 undefined → 红
    expect(out.dataAudit?.highMissingVariables).toContain('sex');
    const sexAudit = out.dataAudit?.variables.find((v) => v.variable === 'sex');
    expect(sexAudit?.flagged).toBe(true);
    expect(sexAudit?.missingRate).toBeGreaterThan(0.3);
  });

  it('任一变量缺失率>30% 时必须显式告警（high_missing_rate）', async () => {
    const rows: InternalRecord[] = [
      rec({ subjectKey: 'r1', sex: 'M' }),
      rec({ subjectKey: 'r2', sex: undefined }),
      rec({ subjectKey: 'r3', sex: undefined }),
      rec({ subjectKey: 'r4', sex: undefined }),
    ];
    const out = await runCohortCount(rows);
    // 当前 warnings 不含任何数据质量告警 → 红
    const warnings = (out.warnings ?? []) as Array<{ code: string; detail: string }>;
    expect(
      warnings.some((w) => w.code === 'high_missing_rate' && w.detail.includes('sex')),
    ).toBe(true);
  });

  it('缺失率>30% 时必须写入质量报告（qualityReport.highMissingVariables）', async () => {
    const rows: InternalRecord[] = [
      rec({ subjectKey: 'r1', sex: 'M' }),
      rec({ subjectKey: 'r2', sex: undefined }),
      rec({ subjectKey: 'r3', sex: undefined }),
      rec({ subjectKey: 'r4', sex: undefined }),
    ];
    const out = await runCohortCount(rows);
    // 当前从不产生 qualityReport → undefined → 红
    expect(out.qualityReport).toBeDefined();
    expect(out.qualityReport!.highMissingVariables).toContain('sex');
    expect(out.qualityReport!.totalRows).toBe(4);
  });
});
