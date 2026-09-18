// MedTrust 平台自有能力对象:线上真实在跑、但行业《分类学》里没有的统计方法。
// 与 taxonomy.ts(忠实转写,计数受 EXPECTED_COUNTS 约束)分开;seeder 按 key upsert,
// 落地状态与依据见 landing.ts。
export const PLATFORM_OBJECTS = {
  models: [
    { key: 'disproportionality-prr-ror', name: 'Disproportionality (PRR / ROR / BCPNN IC)', category: 'Statistical',
      trainingAlgorithmKeys: ['two-stage-federated-meta'],
      complianceNote: '药物警戒信号检测:各院 2×2 计数(过小格抑制)→ 汇总后算比值与置信区间' },
    { key: 'mantel-haenszel-or', name: 'Mantel-Haenszel Pooled OR', category: 'Statistical',
      trainingAlgorithmKeys: ['two-stage-federated-meta'],
      complianceNote: '院内分层合并 OR(Greenland-Robins 方差),分离时 Firth 兜底;只出效应值与 SE' },
  ],
  algorithms: [
    { key: 'two-stage-federated-meta', name: 'Two-Stage Federated Meta-Analysis', category: 'Federated',
      underlyingOperatorKeys: ['Aggregate / Sum', 'Hash'],
      compliancePrivacyModels: ['只收院内聚合估计量(计数 / 效应值+SE),拒行级输入', '院端先过输出闸门(小格抑制 k≥5)'] },
  ],
};
