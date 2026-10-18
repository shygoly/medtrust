import { bestScenario, matchScenarios } from './scenario-matcher';

describe('场景识别（FR-1）', () => {
  it('疗效对比类描述命中单臂外部对照', () => {
    const match = bestScenario('我想对比试验组和对照组的疗效');
    expect(match?.scenario.id).toBe('external-control');
  });

  it('电力负荷描述命中负荷预测', () => {
    expect(bestScenario('我想预测明天的电力负荷')?.scenario.id).toBe('load-forecast');
  });

  it('多方预测模型描述命中 L4 联邦学习', () => {
    expect(bestScenario('我有两家医院的数据，想做预测模型')?.scenario.id).toBe('fl-prediction');
  });

  it('窃电描述命中窃电检测', () => {
    expect(bestScenario('检测一下跨区域的异常用电')?.scenario.id).toBe('theft-detection');
  });

  it('空输入没有匹配', () => {
    expect(matchScenarios('')).toEqual([]);
    expect(bestScenario('')).toBeNull();
  });

  it('多个场景得分接近时不武断（bestScenario 返回 null）', () => {
    expect(bestScenario('负荷预测和窃电检测都要')).toBeNull();
    const all = matchScenarios('负荷预测和窃电检测都要');
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.map((match) => match.scenario.id)).toEqual(
      expect.arrayContaining(['load-forecast', 'theft-detection']),
    );
  });

  it('可与场景 id 直接对齐，且结果是稳定的 topN', () => {
    const matches = matchScenarios('external-control', 3);
    expect(matches[0].scenario.id).toBe('external-control');
    expect(matches.length).toBeLessThanOrEqual(3);
  });

  it('无关键词时兜底为空（由调用方列场景）', () => {
    expect(bestScenario('你好')).toBeNull();
  });
});

/**
 * 识别语料（FR-1 验收：识别准确率 > 90%）。
 * 每条都是「用户可能真这么说」的句子；准确率按整表统计，不删失败样本来凑绿。
 */
const RECOGNITION_CORPUS: Array<{ text: string; expected: string }> = [
  { text: '我想对比试验组和对照组的疗效', expected: 'external-control' },
  { text: '做个单臂试验，用外部对照', expected: 'external-control' },
  { text: '试验组和对照组按年龄性别匹配，卡尺 30 天', expected: 'external-control' },
  { text: '我有两家医院的数据，想做预测模型', expected: 'fl-prediction' },
  { text: '用联邦学习训练一个风险预测模型', expected: 'fl-prediction' },
  { text: '多方联合建模，数据不出院', expected: 'fl-prediction' },
  { text: '统计一下两院各年龄段的患病人数', expected: 'cohort-count' },
  { text: '队列规模有多少人', expected: 'cohort-count' },
  { text: '帮我看看慢病现患的计数', expected: 'cohort-count' },
  { text: '我想预测明天的电力负荷', expected: 'load-forecast' },
  { text: '做个负荷预测，未来 24 小时', expected: 'load-forecast' },
  { text: '用电预测用什么模型', expected: 'load-forecast' },
  { text: '帮我做削峰填谷的需求响应优化', expected: 'demand-response' },
  { text: '需求响应，激励预算怎么分配', expected: 'demand-response' },
  { text: '负荷调度想优化一下', expected: 'demand-response' },
  { text: '检测一下跨区域的异常用电', expected: 'theft-detection' },
  { text: '查一查窃电嫌疑名单', expected: 'theft-detection' },
  { text: '线损异常，想做偷电排查', expected: 'theft-detection' },
];

describe('识别语料（FR-1：准确率 > 90%）', () => {
  it('每条语料都识别出预期场景', () => {
    const failures = RECOGNITION_CORPUS.filter(
      (sample) => bestScenario(sample.text)?.scenario.id !== sample.expected,
    ).map((sample) => `${sample.text} → ${bestScenario(sample.text)?.scenario.id ?? 'null'}（期望 ${sample.expected}）`);

    expect(failures).toEqual([]);
  });

  it('准确率统计 > 90%', () => {
    const hits = RECOGNITION_CORPUS.filter(
      (sample) => bestScenario(sample.text)?.scenario.id === sample.expected,
    ).length;
    const accuracy = hits / RECOGNITION_CORPUS.length;
    expect(accuracy).toBeGreaterThan(0.9);
  });

  it('语料覆盖全部六个场景', () => {
    expect(new Set(RECOGNITION_CORPUS.map((sample) => sample.expected)).size).toBe(6);
  });
});
