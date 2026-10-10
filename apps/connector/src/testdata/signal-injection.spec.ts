import {
  injectSignal,
  syntheticBase,
  DEFAULT_INJECTION,
  crudeOddsRatio,
  stratifiedOddsRatio,
  confusionFromTruth,
  cellsFromRecords,
} from './signal-injection';

// 大样本 + 固定 seed → 结果确定,断言收敛到注入真值(容许错分衰减)。
describe('signal-injection — 注入已知真值信号 (rws-test-data-injection)', () => {
  it('同 seed 两次产出逐字节一致(可复现)', () => {
    const base = syntheticBase(500, ['demohospa', 'demohospb']);
    const a = injectSignal(base, DEFAULT_INJECTION, 12345);
    const b = injectSignal(base, DEFAULT_INJECTION, 12345);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('L0 混淆矩阵 Se/Sp 复原注入值', () => {
    const base = syntheticBase(40000, ['demohospa']);
    const { truth } = injectSignal(base, DEFAULT_INJECTION, 7);
    const m = confusionFromTruth(truth);
    expect(m.sensitivity).toBeGreaterThan(0.84);
    expect(m.sensitivity).toBeLessThan(0.92); // 注入 0.88
    expect(m.specificity).toBeGreaterThan(0.96);
    expect(m.specificity).toBeLessThan(0.995); // 注入 0.98
  });

  it('信号存在,且编码错分使观测 OR 向零衰减(低于注入 HR)', () => {
    const base = syntheticBase(40000, ['demohospa']);
    const { records } = injectSignal(base, DEFAULT_INJECTION, 7);
    const or = crudeOddsRatio(cellsFromRecords(records, DEFAULT_INJECTION));
    expect(or).toBeGreaterThan(1.3); // 信号存在
    expect(or).toBeLessThan(DEFAULT_INJECTION.trueHR); // 错分向零衰减(正确现象)
  });

  it('混杂已注入:crude OR 与 Z 分层 OR 存在可测差异,且 crude 偏高(正混杂)', () => {
    const base = syntheticBase(40000, ['demohospa']);
    const { records, truth } = injectSignal(base, DEFAULT_INJECTION, 7);
    const crude = crudeOddsRatio(cellsFromRecords(records, DEFAULT_INJECTION));
    const strat = stratifiedOddsRatio(records, truth, DEFAULT_INJECTION);
    expect(Math.abs(crude - strat)).toBeGreaterThan(0.03);
    expect(crude).toBeGreaterThan(strat);
  });

  it('10k 队列:每站真事件数 ≥300 且四格每格过闸(n≥5)', () => {
    const base = syntheticBase(10000, ['demohospa', 'demohospb']);
    const { answerKey, records } = injectSignal(base, DEFAULT_INJECTION, 42);
    for (const site of ['demohospa', 'demohospb']) {
      expect(answerKey.perSite[site].trueEvents).toBeGreaterThanOrEqual(300);
      const siteRecords = records.filter((r) => r.subjectKey.startsWith(site));
      const c = cellsFromRecords(siteRecords, DEFAULT_INJECTION);
      expect(Math.min(c.a, c.b, c.c, c.d)).toBeGreaterThanOrEqual(5);
    }
  });

  it('注入 HR=1(无信号)时,观测 OR 落在 1 附近(供 e2e 负向验证)', () => {
    const base = syntheticBase(40000, ['demohospa']);
    const { records } = injectSignal(base, { ...DEFAULT_INJECTION, trueHR: 1, zOddsRatio: 1 }, 7);
    const or = crudeOddsRatio(cellsFromRecords(records, DEFAULT_INJECTION));
    expect(or).toBeGreaterThan(0.8);
    expect(or).toBeLessThan(1.25);
  });

  it('产出 InternalRecord:暴露臂含目标药,结局含编码后胰腺炎,标合成溯源', () => {
    const base = syntheticBase(200, ['demohospa']);
    const { records } = injectSignal(base, DEFAULT_INJECTION, 1);
    // 至少有暴露臂记录带目标药
    expect(records.some((r) => r.medications.includes(DEFAULT_INJECTION.exposureDrug))).toBe(true);
    // 至少有记录带编码后胰腺炎不良事件
    expect(
      records.some((r) => r.adverseEvents.some((e) => e.term === DEFAULT_INJECTION.outcomeTerm)),
    ).toBe(true);
    // 每条记录标合成溯源
    expect(records.every((r) => r.conditions.includes('synthetic-injected'))).toBe(true);
  });
});
