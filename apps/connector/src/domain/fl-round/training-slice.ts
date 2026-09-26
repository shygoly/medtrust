// omop-data-source-access task 4.3（D-CN-6）—— 联邦训练切片由连接器投影，agent 只收切片。
//
// agent 过去按任务下发的 dataPath 自读院内文件（含姓名 / 生日，绕过连接器去标识），
// 标签是它对**原始英文诊断文本**跑的肾病正则。现在「数据从哪来、特征与标签怎么算」
// 都在连接器里决定，agent 只收到下面这一个对象：
//
//   { schema, featureKeys[7], rows[n][7], labels[n] }
//
// 没有 subjectKey / 年龄段 / 性别 / 用药 / 日期——模型用不到的一概不出连接器进程。
//
// 特征与标签的**口径**（schema = esrd-proxy@1，演示终点「24 个月内 ESRD」的代理）：
//   · 特征：7 项数值观测，按下面的固定顺序；记录里没有的观测记 0（与 agent 旧口径一致）。
//   · 标签：任一诊断落在肾病词表即为 1。连接器摄入时已把诊断规范化成中文术语
//     （慢性肾病 / 糖尿病肾病 / 终末期肾病 / 肾炎），未收录的保留英文原文——
//     所以词表 = agent 旧英文正则 ∪「肾」。这是口径迁移，不是新定义：
//     同一批演示文件上逐人对拍一致（training-slice.spec.ts）。
import { InternalRecord } from '../types';

export const TRAINING_SLICE_SCHEMA = 'esrd-proxy@1';

/** structured_ehr 特征：顺序即向量维度（agent 按维数校验）。 */
export const FL_STRUCTURED_EHR_FEATURES = [
  'Body Height',
  'Body Weight',
  'Body mass index (BMI) [Ratio]',
  'Heart rate',
  'Respiratory rate',
  'Cholesterol [Mass/volume] in Serum or Plasma',
  'Glucose',
] as const;

/** 演示终点标签的词表：agent 旧英文正则 ∪ 规范化后的中文「肾」。 */
export const ESRD_PROXY_CONDITION = /肾|kidney|renal|neph|ckd|esrd|dialysis|glomer|creatinine|egfr|uacr/i;

export interface TrainingSlice {
  schema: typeof TRAINING_SLICE_SCHEMA;
  featureKeys: string[];
  rows: number[][];
  labels: Array<0 | 1>;
}

export function esrdProxyLabel(record: Pick<InternalRecord, 'conditions'>): 0 | 1 {
  return record.conditions.some((c) => ESRD_PROXY_CONDITION.test(c)) ? 1 : 0;
}

/**
 * 从连接器已去标识的记录投影训练切片。行按 subjectKey（假名）排序——
 * 同一份数据每轮得到同一个切片，训练可复现；排序键本身不出切片。
 */
export function buildTrainingSlice(records: readonly InternalRecord[]): TrainingSlice {
  const ordered = [...records].sort((a, b) =>
    a.subjectKey < b.subjectKey ? -1 : a.subjectKey > b.subjectKey ? 1 : 0,
  );
  return {
    schema: TRAINING_SLICE_SCHEMA,
    featureKeys: [...FL_STRUCTURED_EHR_FEATURES],
    rows: ordered.map((r) =>
      FL_STRUCTURED_EHR_FEATURES.map((k) => {
        const v = r.observations?.[k];
        return typeof v === 'number' && Number.isFinite(v) ? v : 0;
      }),
    ),
    labels: ordered.map(esrdProxyLabel),
  };
}
