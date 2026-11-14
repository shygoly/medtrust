// 对话式任务配置 Agent 的浏览器侧客户端（apps/chat-agent，端口 5032）。
//
// 与主 API 客户端（@/api/client → 5021）分开：chat-agent 是独立进程。身份用
// x-user-id / x-space-id 头（控制面 JWT 校验接入前的开发期实现，见 tasks 2.1.7）；
// Authorization 一并带上，供 chat-agent 提交作业时透传给控制面。

import { encodeCardSubmission, type CardMessage, type CardSubmission } from '@medtrust/chat-cards';
import { SPACE_COOKIE, readCookie } from './space-context';

const CHAT_BASE_URL =
  process.env.NEXT_PUBLIC_CHAT_AGENT_URL || 'http://localhost:5032/api/v1';

export type ChatRole = 'user' | 'assistant' | 'tool';

export interface ChatTurn {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  cards?: CardMessage[];
  createdAt: string;
}

export interface ChatReply {
  sessionId: string;
  message: ChatTurn;
  cards: CardMessage[];
  suggestions: string[];
  assistantIntent?: string;
  draft?: Record<string, unknown>;
}

export interface ChatContextLink {
  objectType: string;
  objectId: string;
  page: string;
  status?: string;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  spaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSessionDetail extends ChatSessionSummary {
  messages: ChatTurn[];
}

export interface ChatIdentity {
  /** 控制面用户 id（字符串化，进 x-user-id） */
  userId: string;
  token?: string | null;
  /** 显式空间；缺省读空间 cookie */
  spaceId?: string | null;
  role?: string | null;
}

export function chatBaseUrl(): string {
  return CHAT_BASE_URL;
}

/** 组装请求头。纯函数，便于单测；空间缺省从 cookie 取。 */
export function chatHeaders(
  identity: ChatIdentity,
  readSpace: () => string | null = () => readCookie(SPACE_COOKIE),
): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (identity.userId) headers['x-user-id'] = identity.userId;
  const spaceId = identity.spaceId ?? readSpace();
  if (spaceId) headers['x-space-id'] = spaceId;
  if (identity.token) headers['authorization'] = `Bearer ${identity.token}`;
  if (identity.role) headers['x-user-role'] = identity.role;
  return headers;
}

/** 把卡片表单值包成一条用户消息（服务端按 [card:submit] 信封路由到 submit 工具）。 */
export function cardSubmissionMessage(
  card: Pick<CardMessage, 'type' | 'title' | 'scenario'>,
  values: Record<string, unknown>,
): string {
  const submission: CardSubmission = {
    kind: 'card-submit',
    cardType: card.type,
    title: card.title,
    ...(card.scenario ? { scenario: card.scenario } : {}),
    values,
  };
  return encodeCardSubmission(submission);
}

/** 统一的失败文案（JSON 与 SSE 两条路径共用）。 */
export async function describeFailure(response: Response): Promise<string> {
  const detail = await response
    .json()
    .then((body) => (typeof body?.message === 'string' ? body.message : ''))
    .catch(() => '');
  return detail || `AI 助手请求失败（HTTP ${response.status}）`;
}

async function request<T>(
  path: string,
  init: RequestInit,
  identity: ChatIdentity,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${CHAT_BASE_URL}${path}`, {
      ...init,
      headers: { ...chatHeaders(identity), ...((init.headers as Record<string, string>) ?? {}) },
    });
  } catch {
    throw new Error('无法连接 AI 助手服务（chat-agent），请确认 5032 端口已启动');
  }
  if (!response.ok) throw new Error(await describeFailure(response));
  return (await response.json()) as T;
}

export function sendChatMessage(
  message: string,
  sessionId: string | undefined,
  identity: ChatIdentity,
  options: { assistantIntent?: string; page?: string; context?: ChatContextLink } = {},
): Promise<ChatReply> {
  return request<ChatReply>(
    '/chat',
    {
      method: 'POST',
      body: JSON.stringify({
        message,
        ...(sessionId ? { sessionId } : {}),
        ...(options.assistantIntent ? { assistantIntent: options.assistantIntent } : {}),
        ...(options.page ? { page: options.page } : {}),
        ...(options.context ? { context: options.context } : {}),
      }),
    },
    identity,
  );
}

export interface ChatStreamEvent {
  type: 'start' | 'tool' | 'card' | 'done' | 'error' | string;
  [key: string]: unknown;
}

/**
 * 拆 SSE 帧。纯函数：与网络无关，便于单测。
 *
 * 帧以空行分隔；`:` 开头是心跳注释（丢弃）；`event:`/`data:` 逐行取值，
 * 一条 data 都没出现的帧直接丢弃（例如只有注释的心跳帧）。
 */
export function parseSseFrames(buffer: string): {
  events: Array<{ event: string; data: string }>;
  rest: string;
} {
  const events: Array<{ event: string; data: string }> = [];
  let rest = buffer;
  for (;;) {
    const index = rest.indexOf('\n\n');
    if (index < 0) break;
    const frame = rest.slice(0, index);
    rest = rest.slice(index + 2);

    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
    }
    if (dataLines.length > 0) events.push({ event: eventName, data: dataLines.join('\n') });
  }
  return { events, rest };
}

/**
 * 流式对话（4.1.1）：`POST /chat/stream` + 手读 ReadableStream。
 *
 * 中间事件通过 `onEvent` 回调给 UI 做进展提示；返回值与 `sendChatMessage` 形状一致，
 * 因此调用方可以在两者之间切换而不改数据结构。
 */
export async function streamChatMessage(
  message: string,
  sessionId: string | undefined,
  identity: ChatIdentity,
  onEvent?: (event: ChatStreamEvent) => void,
  options: { assistantIntent?: string; page?: string; context?: ChatContextLink } = {},
): Promise<ChatReply> {
  // 续聊断流恢复的基线：发送前最后一条助手消息 id。须在 POST 之前取，
  // 否则服务端已落库的新回复会被误判成旧消息（恢复永远等不到「新」回复）。
  let baselineAssistantId: string | undefined;
  if (sessionId) {
    try {
      const before = await getChatSession(sessionId, identity);
      baselineAssistantId = [...(before.messages ?? [])]
        .reverse()
        .find((m) => m.role === 'assistant')?.id;
    } catch {
      // 基线拿不到不阻断发送；恢复时退回「最后一条是助手」的兜底判定。
    }
  }

  let response: Response;
  try {
    response = await fetch(`${CHAT_BASE_URL}/chat/stream`, {
      method: 'POST',
      headers: chatHeaders(identity),
      body: JSON.stringify({
        message,
        ...(sessionId ? { sessionId } : {}),
        ...(options.assistantIntent ? { assistantIntent: options.assistantIntent } : {}),
        ...(options.page ? { page: options.page } : {}),
        ...(options.context ? { context: options.context } : {}),
      }),
    });
  } catch {
    throw new Error('无法连接 AI 助手服务（chat-agent），请确认 5032 端口已启动');
  }
  if (!response.ok) throw new Error(await describeFailure(response));
  if (!response.body) throw new Error('当前浏览器不支持流式响应');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reply: ChatReply | undefined;
  // start 帧带服务端会话 id：断流后服务端仍会把流程跑完并落库（见 chat.controller），
  // 因此可以按会话 id 把结果捞回来，而不是把浏览器原生 NetworkError 抛给用户。
  let streamSessionId = sessionId;
  let streamFailed = false;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const { events, rest } = parseSseFrames(buffer);
      buffer = rest;
      for (const frame of events) {
        let payload: ChatStreamEvent;
        try {
          payload = JSON.parse(frame.data) as ChatStreamEvent;
        } catch {
          continue;
        }
        onEvent?.(payload);
        if (payload.type === 'start' && typeof payload.sessionId === 'string') {
          streamSessionId = payload.sessionId;
        }
        if (payload.type === 'done') reply = payload.response as ChatReply;
        if (payload.type === 'error') throw new Error(String(payload.message ?? '流式对话失败'));
      }
    }
  } catch (err) {
    // 服务端 error 帧是业务错误，原样上抛；其余（reader.read 抛 TypeError 等）是传输中断。
    if (err instanceof Error && !(err instanceof TypeError)) throw err;
    streamFailed = true;
  }

  if (reply) return reply;
  if (streamSessionId) {
    const recovered = await recoverReply(streamSessionId, identity, baselineAssistantId);
    if (recovered) return recovered;
  }
  throw new Error(
    streamFailed
      ? '网络连接中断，AI 助手响应未完成。请检查网络后重试；若经代理软件访问，请将本站加入直连规则再试。'
      : '流式响应未产出结果，请重试',
  );
}

/**
 * 断流恢复：轮询会话详情，取最后一条助手消息组装成与 done 帧同形的回复。
 * 只接受发送前基线（baselineAssistantId）之后的新助手消息，避免续聊时
 * 把上一轮的旧回复当成这次的结果。
 */
async function recoverReply(
  sessionId: string,
  identity: ChatIdentity,
  baselineAssistantId: string | undefined,
): Promise<ChatReply | undefined> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const detail = await getChatSession(sessionId, identity);
      const last = [...(detail.messages ?? [])].reverse().find((m) => m.role === 'assistant');
      if (last && last.id !== baselineAssistantId) {
        return {
          sessionId: detail.id,
          message: last,
          cards: last.cards ?? [],
          suggestions: [],
        };
      }
    } catch {
      // 会话可能尚未落库，继续轮询。
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return undefined;
}

export function listChatSessions(identity: ChatIdentity): Promise<ChatSessionSummary[]> {
  return request<ChatSessionSummary[]>('/chat/sessions', { method: 'GET' }, identity);
}

export function getChatSession(
  sessionId: string,
  identity: ChatIdentity,
): Promise<ChatSessionDetail> {
  return request<ChatSessionDetail>(
    `/chat/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'GET' },
    identity,
  );
}

export function deleteChatSession(
  sessionId: string,
  identity: ChatIdentity,
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(
    `/chat/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
    identity,
  );
}
