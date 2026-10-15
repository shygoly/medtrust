import type { LogicalPlanDraft } from "@medtrust/mdop";

/**
 * 计划模板（任务 9.1）：把「药物/事件/队列定义/医院/合约」翻译成逻辑计划。
 *
 * 本期的模板 `rws.l15.disproportionality` 固定四个阶段：
 *   每家医院：`source.dataset@1` → `rws.disproportionality@1` → `declassify.small_cell@1`
 *   平台合并：`merge.disproportionality@1`（吃各院 C3）
 * 申请方只描述「算什么」，不描述「在哪算」——放置由编译器按数据就近决定。
 */

export const L15_TEMPLATE_ID = "rws.l15.disproportionality";

export type { LogicalPlanDraft } from "@medtrust/mdop";

export const L4_TEMPLATE_ID = "rws.l4.fl-prediction";

/** LoRA FedAvg（批次 1B）：节点间安全聚合的模板 id。 */
export const LORA_FEDAVG_TEMPLATE_ID = "rws.lora-fedavg";

export const PAIRED_COHORT_TEMPLATE_ID = "rws.paired-cohort";

/** 疫苗接种后不良事件主动监测（自身对照风险期 SCRI）的模板 id。 */
export const VACCINE_SCRI_TEMPLATE_ID = "rws.vaccine-scri";

/** 疫苗真实世界保护效果（检测阴性设计）的模板 id。 */
export const VE_TND_TEMPLATE_ID = "rws.ve-tnd";

/** 跨院去重发病率的模板 id。 */
export const DEDUP_INCIDENCE_TEMPLATE_ID = "rws.dedup-incidence";
