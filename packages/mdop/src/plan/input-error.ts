/**
 * 计划模板的**入参**不合法（申请方描述错了，不是协议/策略拒绝）。
 *
 * 为什么在基座包而不是应用层（change `pack-med-templates` design D2）：
 * 校验逻辑要随模板进行业包，而行业包 MUST NOT 依赖 web 框架（`@nestjs/common`）或应用内部路径；
 * 于是「领域错误」由基座提供、「HTTP 400」由应用层控制器映射（文案原样透传）。
 */
export class PlanInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanInputError";
  }
}
