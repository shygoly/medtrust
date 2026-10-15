// 中心 meta 分析核。实现在协议核 `@medtrust/mdop`（领域中立的随机效应合并），此处再导出，
// 既有调用点（MetaAnalysisService、比较效果合并）一字不变。
export {
  MetaInputRejected,
  derSimonianLaird,
  fingerprintSiteEffects,
  validateSiteEffects,
} from "@medtrust/mdop";
export type {
  EffectMeasure,
  ForestPlotEntry,
  HeterogeneityStats,
  MetaAnalysisResult,
  SiteEffectEstimate,
} from "@medtrust/mdop";
