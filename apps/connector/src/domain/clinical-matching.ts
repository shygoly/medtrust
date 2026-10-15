// SPDX-License-Identifier: MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * 临床匹配的**实现已下移到行业包**（`industries/med/src/analysis/clinical-matching.ts`）：
 * 它是行业知识（药名/诊断/不良事件怎么算命中），站点内计算与批处理共用同一份实现。
 * 此处保留**具名**再导出（不用 `export *`，避免把包的全部导出灌进连接器的命名空间），
 * 既有调用点（legacy 执行器 + 用例）一字不变。
 */
export {
  enrichMedications,
  enrichConditions,
  matchesMedication,
  matchesCondition,
  matchesAdverseEvent,
} from "@medtrust/domain-med";
