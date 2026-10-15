// SPDX-License-Identifier: MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * 批次 2 三型 L0/L1 的**默认分类词典**（行业知识，归行业包所有；调用方可以覆盖）。
 *
 * 为什么放在包里而不是基座：分类键是行业用语（年龄带、器官系统、慢病标签），
 * 基座只按参数取、不写死域词（design D6 + 基座纯度守护）。
 *
 * 口径提醒：`categorical-count` 的 `categoryKeys` 是**闭合列表**（≤64 项，模块 ABI 用 u8 下标）——
 * 不在列表里的取值会在节点侧**拒绝执行**（fail-closed），不会静默丢进别的桶。
 * 所以词典要么覆盖数据的实际取值，要么由调用方显式给出更贴合的列表。
 */

/** 队列规模默认年龄带（覆盖院内常见分段；随数据字典演进，可被调用方覆盖）。 */
export const DEFAULT_COHORT_AGE_BANDS: readonly string[] = [
  "0-17",
  "18-39",
  "40-49",
  "50-59",
  "60-69",
  "70-79",
  "80+",
];

/** 器官系统默认词典（院内自建口径，**不是** MedDRA SOC —— MedDRA 需授权，不在此固化）。 */
export const DEFAULT_ORGAN_SYSTEMS: readonly string[] = [
  "皮肤及皮下组织",
  "胃肠系统",
  "肝胆系统",
  "血液及淋巴系统",
  "心血管系统",
  "呼吸系统",
  "神经系统",
  "泌尿系统",
  "内分泌及代谢",
  "肌肉骨骼系统",
  "眼及附属器官",
  "全身性及其他",
];

/** 慢病标签默认词典（院内自建口径；调用方通常会给出本机构实际使用的标签集）。 */
export const DEFAULT_CONDITION_LABELS: readonly string[] = [
  "高血压",
  "糖尿病",
  "冠心病",
  "脑卒中",
  "慢性阻塞性肺病",
  "慢性肾病",
  "恶性肿瘤",
];

/** 持有方列表字段在既有入口里叫 `hospitals`、在本批次模板里叫 `holders` —— 两个都收，避免调用方记两套。 */
export function normalizeHolders<T>(input: { holders?: T[]; hospitals?: T[] }): T[] {
  const list = input.holders?.length ? input.holders : input.hospitals;
  return Array.isArray(list) ? list : [];
}
