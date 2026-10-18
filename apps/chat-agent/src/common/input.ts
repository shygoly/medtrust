export type NormalizedMessage =
  | { ok: true; text: string }
  | { ok: false; status: number; reason: string };

// 有意匹配控制字符：去控制字符正是本函数的目的（换行/制表保留）
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * 用户输入规范化与边界（4.3.2）。
 *
 * 三条规则：
 * 1. 只接受字符串（其余类型一律拒，不做隐式转换）；
 * 2. 去掉控制字符（保留 \n \r \t），其余内容**原样保留**——不做 HTML 转义，
 *    因为前端用 React 渲染（默认转义），在这里"转义"只会污染用户数据；
 * 3. 长度封顶，超限即拒（413），避免把超长文本塞进提示词与存储。
 */
export function normalizeUserMessage(raw: unknown, maxChars: number): NormalizedMessage {
  if (typeof raw !== 'string') {
    return { ok: false, status: 400, reason: 'message 必须是字符串' };
  }
  const text = raw.replace(CONTROL_CHARS, '').trim();
  if (text.length === 0) {
    return { ok: false, status: 400, reason: 'message 不能为空' };
  }
  if (text.length > maxChars) {
    return { ok: false, status: 413, reason: `message 过长（上限 ${maxChars} 字符，收到 ${text.length}）` };
  }
  return { ok: true, text };
}
