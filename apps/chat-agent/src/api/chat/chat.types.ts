import type { CardMessage } from '@medtrust/chat-cards';
import type { ChatMessage } from '../../session/session.types';
import type { ScenarioDraft } from '../../agent/scenario-draft';
import type { AssistantIntent } from '../../agent/assistant-intent';

export type { ChatRequestDto } from './dto/chat-request.dto';

export interface ChatIdentity {
  userId: string;
  spaceId: string;
  accessToken?: string;
  /** UI 角色提示；有 token 时服务端仍会从控制面重新读取。 */
  role?: string;
}

export interface ChatUsageDto {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResponseDto {
  sessionId: string;
  message: ChatMessage;
  cards: CardMessage[];
  suggestions: string[];
  usage?: ChatUsageDto;
  assistantIntent?: AssistantIntent;
  draft?: ScenarioDraft;
}
