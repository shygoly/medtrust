import type { Tool } from '@medtrust/pi-agent';
import { SCENARIOS } from '../scenarios';
import { withSpan } from '../../observability/tracing';
import type { MedTrustApiClient } from './api-client';
import { buildRefreshCardTool, buildSubmitTool } from './mdop.tools';
import { buildSpaceTools } from './space.tools';
import { buildTemplateTools } from './template.tools';
import { buildComplianceTools } from './compliance.tools';
import { buildContractProgressTool, buildContractRequestTool } from './contract.tools';
import { buildRegistrationTools } from './registration.tools';

export * from './api-client';
export { buildRefreshCardTool, buildSubmitTool } from './mdop.tools';
export { buildSpaceTools } from './space.tools';
export { buildTemplateTools } from './template.tools';
export { buildContractProgressTool, buildContractRequestTool } from './contract.tools';
export {
  buildRegistrationTools,
  registrationToolFromValues,
} from './registration.tools';

/**
 * 给每个工具套一个 span（4.2.3）。
 *
 * 在注册点统一包装，而不是在 6 个场景工具里各写一遍：后者必然漏掉某个工具，
 * 而"追踪覆盖率"最怕的就是漏。工具名/是否成功进属性，**参数与返回值不进**——
 * 那里是用户填的取值。
 */
export function withToolSpan(tool: Tool): Tool {
  return {
    ...tool,
    execute: (params, context) =>
      withSpan(`tool.${tool.name}`, { 'tool.name': tool.name }, async (span) => {
        const result = await tool.execute(params, context);
        span?.setAttribute('tool.ok', result?.success !== false);
        return result;
      }),
  };
}

/** 场景 → 工具的唯一注册点：新增场景只改 `SCENARIOS`。 */
export function buildTools(api: MedTrustApiClient, allowedTools?: ReadonlySet<string>): Tool[] {
  const tools = [
    ...SCENARIOS.map((scenario) => buildSubmitTool(scenario, api)),
    ...buildSpaceTools(api),
    ...buildTemplateTools(),
    ...buildComplianceTools(api),
    buildContractRequestTool(api),
    buildContractProgressTool(api),
    ...buildRegistrationTools(api),
    buildRefreshCardTool(SCENARIOS),
  ].map(withToolSpan);
  return allowedTools
    ? tools.filter((tool) => allowedTools.has(tool.name))
    : tools;
}
