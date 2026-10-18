"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CardMessage } from "@medtrust/chat-cards";
import { CardRenderer } from "@medtrust/chat-cards/react";
import { api } from "@/api/client";
import { useAuth } from "@/lib/auth";
import {
  cardSubmissionMessage,
  deleteChatSession,
  getChatSession,
  listChatSessions,
  streamChatMessage,
  type ChatIdentity,
  type ChatSessionSummary,
} from "@/lib/chat-api";

const STARTERS = [
  "我想做单臂试验的外部对照",
  "我想预测明天的电力负荷",
  "我有两家医院的数据，想做预测模型",
];

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards: CardMessage[];
}

let localSeq = 0;
const localId = (prefix: string) => `${prefix}-${++localSeq}`;
const ACTIVE_SESSION_KEY = "medtrust_active_chat_session";

/**
 * 对话式任务配置面板。
 *
 * 状态就是消息历史（Pi Agent 无状态）：会话 id 由 chat-agent 返回，历史由服务端持久化。
 * 卡片渲染复用 @medtrust/chat-cards/react —— 与后端共享同一份 Card 类型与校验。
 */
export function ChatPanel() {
  const { user, ready } = useAuth();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [assistantIntent, setAssistantIntent] = useState<string | undefined>(
    searchParams.get("intent") ?? undefined,
  );
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Record<string, true>>({});
  const scroller = useRef<HTMLDivElement | null>(null);

  const identity: ChatIdentity = {
    userId: user ? String(user.id) : "",
    token: api.getToken(),
    role: user?.role,
  };

  const refreshSessions = useCallback(async () => {
    if (!user) return;
    try {
      setSessions(await listChatSessions(identity));
    } catch {
      // 侧栏失败不阻断对话；错误在发送时暴露。
    }
    // identity 由 user/token 派生，依赖 user 即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (ready && user) void refreshSessions();
  }, [ready, user, refreshSessions]);

  useEffect(() => {
    if (!ready || !user) return;
    const saved = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (saved) void openSession(saved);
    // openSession 只读取当前登录身份；ready/user 变化时才恢复一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user]);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, pending]);

  async function send(text: string, display?: string) {
    const trimmed = text.trim();
    if (!trimmed || pending || !user) return;
    setPending(true);
    setError(null);
    setProgress(null);
    setMessages((prev) => [
      ...prev,
      { id: localId("user"), role: "user", text: display ?? trimmed, cards: [] },
    ]);
    setInput("");
    try {
      // chat-agent 不经过本客户端的 401→refresh：发消息前先确保 token 未过期（15m TTL）
      const sendIdentity: ChatIdentity = { ...identity, token: await api.ensureFreshToken() };
      // 流式（4.1.1）：工具开始/结束时给一行进展提示；最终返回值与一次性接口同形。
      const contextQuery = searchParams.toString();
      const reply = await streamChatMessage(
        trimmed,
        sessionId,
        sendIdentity,
        (event) => {
          if (event.type === "tool" && event.phase === "start") {
            setProgress(`正在执行 ${String(event.name)}…`);
          } else if (event.type === "tool" || event.type === "card") {
            setProgress(null);
          }
        },
        {
          ...(assistantIntent ? { assistantIntent } : {}),
          page:
            typeof window === "undefined"
              ? "/space/assistant"
              : `${window.location.pathname}${contextQuery ? `?${contextQuery}` : ""}`,
          ...(searchParams.get("objectType") && searchParams.get("objectId")
            ? {
                context: {
                  objectType: searchParams.get("objectType")!,
                  objectId: searchParams.get("objectId")!,
                  page: searchParams.get("page") ?? window.location.pathname,
                  ...(searchParams.get("status")
                    ? { status: searchParams.get("status")! }
                    : {}),
                },
              }
            : {}),
        },
      );
      setSessionId(reply.sessionId);
      localStorage.setItem(ACTIVE_SESSION_KEY, reply.sessionId);
      if (reply.assistantIntent) setAssistantIntent(reply.assistantIntent);
      setMessages((prev) => [
        ...prev,
        {
          id: reply.message?.id ?? localId("assistant"),
          role: "assistant",
          text: reply.message?.content ?? "",
          cards: reply.cards ?? [],
        },
      ]);
      void refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "对话失败，请稍后重试");
    } finally {
      setPending(false);
      setProgress(null);
    }
  }

  function submitCard(messageId: string, card: CardMessage, values: Record<string, unknown>) {
    setSubmitted((prev) => ({ ...prev, [messageId]: true }));
    void send(
      cardSubmissionMessage(card, values),
      `已填写「${card.title}」${Object.keys(values).length} 项参数`,
    );
  }

  async function openSession(id: string) {
    if (pending) return;
    setError(null);
    try {
      const detail = await getChatSession(id, identity);
      setSessionId(detail.id);
      localStorage.setItem(ACTIVE_SESSION_KEY, detail.id);
      setSubmitted({});
      setMessages(
        (detail.messages ?? [])
          .filter((turn) => turn.role === "user" || turn.role === "assistant")
          .map((turn) => ({
            id: turn.id,
            role: turn.role === "user" ? "user" : "assistant",
            text: turn.content,
            cards: turn.cards ?? [],
          })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "打不开该会话");
    }
  }

  function newSession() {
    setSessionId(undefined);
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    setMessages([]);
    setSubmitted({});
    setError(null);
  }

  async function removeSession(id: string) {
    try {
      await deleteChatSession(id, identity);
    } catch {
      // 删除失败不阻断；下一次列表刷新会反映真实状态。
    }
    if (id === sessionId) newSession();
    void refreshSessions();
  }

  const disabled = !ready || !user || pending;
  const activeAssistant = assistantIntent ?? "统一入口";

  return (
    <div className="flex gap-6 items-start">
      <aside className="cs-panel w-64 shrink-0 p-3 hidden lg:block" data-testid="session-rail">
        <div className="flex items-center justify-between mb-2">
          <span className="cs-label">会话</span>
          <button type="button" className="cs-btn-ghost text-xs" onClick={newSession}>
            新会话
          </button>
        </div>
        {sessions.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--cs-faint)" }}>
            还没有历史会话
          </p>
        ) : (
          <ul className="space-y-1">
            {sessions.map((session) => (
              <li key={session.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className="flex-1 truncate text-left text-xs py-1 px-2 rounded"
                  style={{
                    background: session.id === sessionId ? "var(--cs-bg-3)" : "transparent",
                    color: session.id === sessionId ? "var(--cs-text)" : "var(--cs-dim)",
                  }}
                  title={session.title}
                  onClick={() => void openSession(session.id)}
                >
                  {session.title || "未命名会话"}
                </button>
                <button
                  type="button"
                  aria-label="删除会话"
                  className="cs-btn-ghost text-xs"
                  onClick={() => void removeSession(session.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="flex-1 min-w-0 cs-panel flex flex-col" style={{ minHeight: "32rem" }}>
        <div ref={scroller} className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="message-list">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: "var(--cs-dim)" }}>
                用一句话说明你的数据与目标，我会推荐场景、用卡片收集参数并提交作业。
              </p>
              <p className="cs-label">当前助手 · {activeAssistant}</p>
              <div className="flex flex-wrap gap-2">
                {STARTERS.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    className="cs-chip text-xs"
                    disabled={disabled}
                    onClick={() => void send(starter)}
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            // data-role：稳定区分用户/助手消息（断言与样式钩子都用它，不靠文案）
            <div key={message.id} className="space-y-2" data-role={message.role}>
              <div
                className="text-sm whitespace-pre-wrap"
                style={{
                  color: message.role === "user" ? "var(--cs-faint)" : "var(--cs-text)",
                }}
              >
                <span className="cs-label mr-2">{message.role === "user" ? "我" : "助手"}</span>
                {message.text}
              </div>
              {message.cards.map((card, index) => (
                <CardRenderer
                  key={`${message.id}-card-${index}`}
                  card={card}
                  disabled={disabled || Boolean(submitted[message.id])}
                  onSubmit={(values) => submitCard(message.id, card, values)}
                />
              ))}
            </div>
          ))}

          {pending && (
            <div className="text-sm" data-testid="chat-progress" style={{ color: "var(--cs-cyan)" }}>
              {progress ?? "助手思考中…"}
            </div>
          )}
          {error && (
            <div className="text-sm" style={{ color: "var(--cs-red)" }} role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="border-t p-3 flex items-end gap-2" style={{ borderColor: "var(--cs-line)" }}>
          <textarea
            className="cs-input flex-1 resize-none"
            rows={2}
            data-testid="chat-input"
            placeholder={user ? "描述你的计算需求，Enter 发送 / Shift+Enter 换行" : "请先登录"}
            value={input}
            disabled={disabled}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
          />
          <button
            type="button"
            className="cs-btn"
            data-testid="send-button"
            disabled={disabled || input.trim().length === 0}
            onClick={() => void send(input)}
          >
            发送
          </button>
        </div>
      </section>
    </div>
  );
}
