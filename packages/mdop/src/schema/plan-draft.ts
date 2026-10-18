/**
 * 逻辑计划草案（编译器输入）：申请方描述「算什么」，不描述「在哪算」。
 *
 * 从 `apps/api/src/mdop/plan-templates.ts` 提升到协议核（change `pack-med-templates` design D4）：
 * 计划形状是**基座概念**，行业包必须能引用它来产出草案；放在协议核后应用侧改为再导出，调用点不变。
 * 本类型零领域语义（字段全是编排概念）。
 */
export interface LogicalPlanDraft {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  stages: Array<{
    id: string;
    op: string;
    inputs: Array<{ from: string }>;
    params: Record<string, unknown>;
    at?: string;
  }>;
  ethics_ref?: string;
  not_before: string;
  not_after: string;
  contractBundle?: {
    id: string;
    version: string;
  };
  contractBindings?: Array<{
    contractId: string;
    participantId: string;
    dataProductId: string;
    role: string;
    stages: string[];
  }>;
}
