/**
 * Card 文本协议：从 LLM 文本里抽取卡片、把表单提交编解码成一条用户消息。
 */
import type { CardMessage, CardSubmission } from './types';
import { CARD_FENCE, CARD_SUBMIT_PREFIX } from './types';
import { isCardMessage } from './validation';

const FENCE_RE = new RegExp('```' + CARD_FENCE + '\\s*\\n([\\s\\S]*?)\\n```', 'g');

/** 抽取所有合法 card 围栏块，并返回去掉围栏后的正文。 */
export function extractCardMessages(content: string): {
  cards: CardMessage[];
  text: string;
  invalid: string[];
} {
  const cards: CardMessage[] = [];
  const invalid: string[] = [];
  if (typeof content !== 'string') return { cards, text: '', invalid };

  const text = content.replace(FENCE_RE, (_match, body: string) => {
    try {
      const parsed = JSON.parse(body.trim());
      if (isCardMessage(parsed)) cards.push(parsed as CardMessage);
      else invalid.push(JSON.stringify(parsed));
    } catch {
      invalid.push(body.trim());
    }
    return '';
  });

  return { cards, text: text.replace(/\n{3,}/g, '\n\n').trim(), invalid };
}

export function encodeCardSubmission(submission: CardSubmission): string {
  return `${CARD_SUBMIT_PREFIX} ${JSON.stringify(submission)}`;
}

export function parseCardSubmission(content: string): CardSubmission | null {
  if (typeof content !== 'string') return null;
  const index = content.indexOf(CARD_SUBMIT_PREFIX);
  if (index < 0) return null;
  const raw = content.slice(index + CARD_SUBMIT_PREFIX.length).trim();
  try {
    const parsed = JSON.parse(raw) as CardSubmission;
    if (parsed && parsed.kind === 'card-submit' && typeof parsed.values === 'object')
      return parsed;
  } catch {
    return null;
  }
  return null;
}
