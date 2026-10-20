/**
 * 逐场景的「规范取值 + 触发语」。
 *
 * 同时被 `scenarios.spec.ts`（工具层）与 `chat.e2e.spec.ts`（HTTP 层）使用——
 * 两处共用一份，避免"补了场景却只在一处覆盖"。新增场景必须在这里加一行
 * （scenarios.spec 有覆盖断言会拦下漏补）。
 */
export const CANONICAL_SCENARIO_VALUES: Record<string, Record<string, unknown>> = {
  'external-control': {
    trial: 'p-sponsor',
    trialDataProduct: 'dp-trial',
    controls: 'p-hosp-a',
    controlsDataProduct: 'dp-controls',
    strataKeys: '<40|M, 40+|F',
  },
  'rws-study': {
    analysisType: 'condition-prevalence',
    participants: 'p-hosp-a',
    dataProducts: 'dp-controls',
  },
  'external-control-registration': {
    studyId: 'REG-ECA-001',
    product: 'SIM-MAB-01',
    indication: 'SIM-DERM-01',
    evidenceRole: 'supportive',
    synthetic: true,
    profileVersion: 'registration-eca/1.0.0',
    protocolVersion: 'protocol-1',
    sapVersion: 'sap-1',
    timeZero: 'treatment-start',
    outcome: 'week-24-response',
    p0DecisionsFrozen: false,
    trial: 'p-sponsor',
    trialDataProduct: 'dp-trial',
    trialContract: 'ct-fake-trial',
    primaryControl: 'p-hosp-a',
    primaryControlDataProduct: 'dp-controls',
    primaryControlContract: 'ct-fake-1',
    contractBundleId: 'bundle-reg-1',
    contractBundleVersion: 'v1',
    teeNode: 'urn:tds:sh-med:participant:tee-node',
    covariates: 'age, sex, severity',
    missingness: 'MAR',
    effectMeasure: 'risk-ratio',
    truthRr: 0.65,
  },
  'fl-prediction': {
    hospitals: 'p-hosp-a, p-hosp-b',
    dataProducts: 'dp-hosp-b',
    target: 'label_diabetes',
  },
  'cohort-count': { holders: 'p-hosp-a, p-hosp-b', dataProducts: 'dp-hosp-b' },
  'load-forecast': {
    participants: 'p-grid-a, p-grid-b',
    dataProducts: 'dp-load-a, dp-load-b',
    features: 'load, temperature',
  },
  'demand-response': {
    participants: 'p-grid-a, p-grid-b',
    dataProducts: 'dp-load-a, dp-load-b',
    targetLoad: Array.from({ length: 24 }, (_, hour) => 100 + hour).join(', '),
    incentiveBudget: 1500,
  },
  'theft-detection': { participants: 'p-grid-a, p-grid-b', dataProducts: 'dp-load-a, dp-load-b' },
};

/** 每个场景一句「用户会这么说」的触发语（与识别语料同源）。 */
export const SCENARIO_PROMPTS: Record<string, string> = {
  'external-control': '我想对比试验组和对照组的疗效',
  'rws-study': '做一次 RWS 真实世界研究',
  'external-control-registration': '创建一项单臂外部对照注册研究并生成模拟报告',
  'fl-prediction': '用联邦学习训练一个风险预测模型',
  'cohort-count': '统计一下两院各年龄段的患病人数',
  'load-forecast': '我想预测明天的电力负荷',
  'demand-response': '帮我做削峰填谷的需求响应优化',
  'theft-detection': '检测一下跨区域的异常用电',
};
