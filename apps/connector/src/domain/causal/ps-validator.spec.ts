/**
 * L3-ps-valid — 倾向评分模型诊断 (red tests / TDD Test 阶段).
 *
 * 任务卡 acceptance:
 *   1) 诊断报告输出 AUC、SMD 表与重叠图;
 *   2) 所有协变量 |SMD|<0.1 或已记录再平衡措施及理由。
 */
import {
  computePsAuc,
  computeSmdTable,
  computeOverlap,
  computeCalibration,
  validatePsModel,
  SMD_BALANCE_THRESHOLD,
  type PsCohortRow,
} from "./ps-validator";

function row(
  treated: boolean,
  propensityScore: number,
  age: number,
  bmi: number,
): PsCohortRow {
  return { treated, propensityScore, covariates: { age, bmi } };
}

/** 处理组/对照组协变量分布相近、PS 重叠良好 → 期望 balanced=true, |SMD|<0.1。 */
function balancedCohort(): PsCohortRow[] {
  const rows: PsCohortRow[] = [];
  for (let i = 0; i < 100; i++) {
    const treated = i % 2 === 0;
    const age = 50 + (i % 5) - 2;
    const bmi = 26 + (i % 3);
    rows.push(row(treated, 0.4 + (i % 20) / 100, age, bmi));
  }
  return rows;
}

/** 处理组年龄显著更高 → age 协变量 |SMD|≥0.1 → 期望 balanced=false + 再平衡记录。 */
function imbalancedCohort(): PsCohortRow[] {
  const rows: PsCohortRow[] = [];
  for (let i = 0; i < 100; i++) {
    const treated = i % 2 === 0;
    const age = treated ? 60 + (i % 5) : 45 + (i % 5);
    rows.push(row(treated, treated ? 0.7 : 0.3, age, 26));
  }
  return rows;
}

/** 倾向评分强分离 → 期望 AUC ∈ (0.5, 1]。 */
function separableCohort(): PsCohortRow[] {
  const rows: PsCohortRow[] = [];
  for (let i = 0; i < 100; i++) {
    const treated = i % 2 === 0;
    rows.push(row(treated, treated ? 0.9 : 0.1, 50, 26));
  }
  return rows;
}

describe("L3-ps-valid — 倾向评分模型诊断报告", () => {
  it("诊断报告输出判别力 AUC（区分度检验）", () => {
    const report = validatePsModel(balancedCohort());
    // acceptance: 诊断报告输出 AUC。
    expect(report.auc).toBeGreaterThanOrEqual(0.5);
    expect(report.auc).toBeLessThanOrEqual(1);
  });

  it("诊断报告输出 SMD 平衡表", () => {
    const report = validatePsModel(balancedCohort());
    // acceptance: 诊断报告输出 SMD 表。
    expect(report.smdTable.length).toBeGreaterThan(0);
    for (const entry of report.smdTable) {
      expect(typeof entry.covariate).toBe("string");
      expect(entry.smd).toBeGreaterThanOrEqual(0);
    }
  });

  it("诊断报告输出共同支撑重叠图数据（覆盖完整 PS 区间）", () => {
    const report = validatePsModel(balancedCohort());
    // acceptance: 诊断报告输出重叠图。
    expect(report.overlap.length).toBeGreaterThan(0);
    const mids = report.overlap.map((o) => o.propensityScore);
    expect(Math.min(...mids)).toBeLessThan(0.2);
    expect(Math.max(...mids)).toBeGreaterThan(0.8);
    for (const bin of report.overlap) {
      expect(bin.treated).toBeGreaterThanOrEqual(0);
      expect(bin.comparator).toBeGreaterThanOrEqual(0);
    }
  });

  it("诊断报告输出校准度检验（Hosmer–Lemeshow）", () => {
    const report = validatePsModel(balancedCohort());
    // 缺口:倾向评分模型未做校准度检验。
    expect(report.calibration.df).toBeGreaterThan(0);
    expect(report.calibration.pValue).toBeGreaterThan(0);
    expect(report.calibration.pValue).toBeLessThanOrEqual(1);
  });

  it("平衡队列: 所有协变量 |SMD|<0.1 → balanced=true", () => {
    const report = validatePsModel(balancedCohort());
    // acceptance: 所有协变量 |SMD|<0.1。
    expect(report.balanced).toBe(true);
    expect(report.smdTable.length).toBeGreaterThan(0);
    expect(
      report.smdTable.every((e) => e.smd < SMD_BALANCE_THRESHOLD),
    ).toBe(true);
  });

  it("非平衡队列: 每个未达标协变量都记录再平衡措施及理由", () => {
    const report = validatePsModel(imbalancedCohort());
    // acceptance: 未达标协变量 MUST 记录再平衡措施及理由。
    expect(report.smdTable.length).toBeGreaterThan(0);
    for (const entry of report.smdTable) {
      if (entry.smd >= SMD_BALANCE_THRESHOLD) {
        const record = report.rebalancing.find(
          (r) => r.covariate === entry.covariate,
        );
        expect(record).toBeDefined();
        expect(record!.measure.trim().length).toBeGreaterThan(0);
        expect(record!.rationale.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("computePsAuc 对强分离组输出 (0.5, 1] 判别力", () => {
    const auc = computePsAuc(separableCohort());
    expect(auc).toBeGreaterThan(0.5);
    expect(auc).toBeLessThanOrEqual(1);
  });

  it("computeSmdTable 为每个数值协变量输出一行", () => {
    const table = computeSmdTable(balancedCohort());
    expect(table.map((e) => e.covariate).sort()).toEqual([
      "age",
      "bmi",
    ]);
  });

  it("computeOverlap 输出至少一个覆盖两端的分箱", () => {
    const overlap = computeOverlap(separableCohort(), 10);
    expect(overlap.length).toBeGreaterThan(0);
    const withCounts = overlap.filter(
      (o) => o.treated > 0 && o.comparator > 0,
    );
    // 强分离时仍须在两端都有共同支撑 (至少有重叠分箱存在)。
    expect(withCounts.length).toBeGreaterThan(0);
  });

  it("computeCalibration 对校准良好的队列返回 acceptable=true", () => {
    const cal = computeCalibration(balancedCohort());
    expect(cal.df).toBeGreaterThan(0);
    expect(cal.pValue).toBeGreaterThan(0.05);
    expect(cal.acceptable).toBe(true);
  });
});
