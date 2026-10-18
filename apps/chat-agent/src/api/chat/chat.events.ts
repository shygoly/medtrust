import type { CardMessage } from '@medtrust/chat-cards';
import type { ChatResponseDto } from './chat.types';

/**
 * 对话的**步骤级**事件流（tasks 4.1.1）。
 *
 * 说明清楚它不是什么：这不是 token 级流式。`LLMClient.complete()` 目前一次性返回，
 * 要让 token 级流式成立，得先给 LLM 客户端加流式方法（Anthropic 侧用 messages.stream()）。
 * 这里先把**可见的推进节点**流出去：开始 → 工具调用开始/结束 → 卡片 → 完成。
 * 对"提交任务要等好几秒"这个真实痛点，它已经能给出进展反馈。
 */
export type ChatEvent =
  | { type: 'start'; sessionId: string; spaceId: string }
  | { type: 'tool'; phase: 'start' | 'end'; name: string; ok?: boolean; durationMs?: number }
  | { type: 'card'; card: CardMessage }
  | { type: 'done'; response: ChatResponseDto; suggestions: string[] }
  | { type: 'error'; message: string };
