import type { ToolContext } from '@medtrust/pi-agent';
import type { SpaceDirectory } from './directory';
import type { ScenarioDefaults } from './scenarios';
import type { ScenarioDraft } from './scenario-draft';
import type { AssistantIntent } from './assistant-intent';
import type { ScenarioDefinition } from './scenarios';

/** 工具执行上下文：PiAgent 的通用 ToolContext + 本应用需要的字段。 */
export interface ChatToolContext extends ToolContext {
  accessToken?: string;
  directory: SpaceDirectory;
  defaults: ScenarioDefaults;
  assistantIntent: AssistantIntent;
  draft?: ScenarioDraft;
  scenario?: ScenarioDefinition;
}

export function asChatContext(context: ToolContext): ChatToolContext {
  return context as ChatToolContext;
}
