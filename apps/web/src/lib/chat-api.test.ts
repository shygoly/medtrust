import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCardSubmission } from '@medtrust/chat-cards';
import {
  cardSubmissionMessage,
  chatBaseUrl,
  chatHeaders,
  parseSseFrames,
  streamChatMessage,
  type ChatIdentity,
} from './chat-api';

const identity: ChatIdentity = { userId: 'u-1', token: 'tk-1' };

test('chatHeaders：带用户、空间、令牌', () => {
  const headers = chatHeaders(identity, () => 'space-cookie');
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(headers['x-user-id'], 'u-1');
  assert.equal(headers['x-space-id'], 'space-cookie');
  assert.equal(headers['authorization'], 'Bearer tk-1');
});

test('chatHeaders：显式空间优先于 cookie', () => {
  const headers = chatHeaders({ ...identity, spaceId: 'space-explicit' }, () => 'space-cookie');
  assert.equal(headers['x-space-id'], 'space-explicit');
});

test('chatHeaders：无令牌不带 Authorization，无用户不带 x-user-id', () => {
  const headers = chatHeaders({ userId: '' }, () => null);
  assert.equal(headers['authorization'], undefined);
  assert.equal(headers['x-user-id'], undefined);
  assert.equal(headers['x-space-id'], undefined);
});

test('cardSubmissionMessage：可被服务端 parseCardSubmission 解回，且带场景', () => {
  const message = cardSubmissionMessage(
    { type: 'form', title: '外部对照配置', scenario: 'external-control' },
    { trial: 'p-sponsor', ratioK: 2 },
  );
  const parsed = parseCardSubmission(message);
  assert.ok(parsed);
  assert.equal(parsed.cardType, 'form');
  assert.equal(parsed.scenario, 'external-control');
  assert.deepEqual(parsed.values, { trial: 'p-sponsor', ratioK: 2 });
});

test('cardSubmissionMessage：无场景时省略 scenario 字段', () => {
  const parsed = parseCardSubmission(
    cardSubmissionMessage({ type: 'status', title: '提示' }, { ok: true }),
  );
  assert.ok(parsed);
  assert.equal(parsed.scenario, undefined);
});

test('chatBaseUrl：默认指向 chat-agent 5032', () => {
  assert.match(chatBaseUrl(), /\/api\/v1$/);
});

test('parseSseFrames：忽略心跳注释，按 data 组帧，保留不完整尾巴', () => {
  const buffer = [
    ': ping',
    '',
    'event: start',
    'data: {"type":"start","sessionId":"s1"}',
    '',
    'event: done',
    'data: {"type":"done","response":{"sessionId":"s1"}}',
    '',
    'event: partial',
    'data: {"type":"car',
  ].join('\n');

  const { events, rest } = parseSseFrames(buffer);
  assert.deepEqual(
    events.map((frame) => frame.event),
    ['start', 'done'],
  );
  assert.equal(JSON.parse(events[0].data).sessionId, 's1');
  assert.ok(rest.includes('{"type":"car'));
});

test('parseSseFrames：无 data 的帧（只有心跳）被丢弃', () => {
  const { events } = parseSseFrames(': ping\n\n: ping\n\n');
  assert.deepEqual(events, []);
});

test('streamChatMessage：跨分片重组、回调中间事件、返回最终 reply', async () => {
  const frames = [
    { type: 'start', sessionId: 's1', spaceId: 'sh-med' },
    { type: 'tool', phase: 'start', name: 'submit_external_control' },
    { type: 'tool', phase: 'end', name: 'submit_external_control', ok: true, durationMs: 12 },
    { type: 'card', card: { type: 'status', title: '任务已提交' } },
  ]
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
  const reply = {
    sessionId: 's1',
    message: { id: 'm1', sessionId: 's1', role: 'assistant', content: 'ok', createdAt: '' },
    cards: [],
    suggestions: ['去任务列表查看执行状态'],
  };
  const stream = frames + `event: done\ndata: ${JSON.stringify({ type: 'done', response: reply, suggestions: reply.suggestions })}\n\n`;

  const encoder = new TextEncoder();
  const bytes = encoder.encode(stream);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // 故意在帧中间切断：验证跨分片重组
      controller.enqueue(bytes.slice(0, 37));
      controller.enqueue(bytes.slice(37));
      controller.close();
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(body, { status: 200 })) as typeof fetch;
  try {
    const seen: string[] = [];
    const result = await streamChatMessage('hi', undefined, { userId: 'u-1' }, (event) => {
      seen.push(event.type);
    });
    assert.equal(result.sessionId, 's1');
    assert.deepEqual(seen, ['start', 'tool', 'tool', 'card', 'done']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamChatMessage：流中途断网后按会话 id 恢复已落库的回复，不抛原生 NetworkError', async () => {
  const encoder = new TextEncoder();
  const recoveredMessage = {
    id: 'm-recovered',
    sessionId: 's-drop',
    role: 'assistant',
    content: '已按会话恢复',
    cards: [],
    createdAt: '',
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/chat/stream')) {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `event: start\ndata: ${JSON.stringify({ type: 'start', sessionId: 's-drop', spaceId: 'sh-med' })}\n\n`,
              ),
            );
            // 模拟代理/CF 中途掐断连接：先送达 start 帧，随后 reader.read() 抛 TypeError
            setTimeout(
              () => controller.error(new TypeError('NetworkError when attempting to fetch resource.')),
              10,
            );
          },
        }),
        { status: 200 },
      );
    }
    if (url.endsWith('/chat/sessions/s-drop')) {
      return new Response(
        JSON.stringify({
          id: 's-drop',
          title: 't',
          spaceId: 'sh-med',
          createdAt: '',
          updatedAt: '',
          messages: [recoveredMessage],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  try {
    const result = await streamChatMessage('hi', undefined, { userId: 'u-1' });
    assert.equal(result.sessionId, 's-drop');
    assert.equal(result.message.id, 'm-recovered');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamChatMessage：未拿到会话 id 就断网 → 中文断网提示，而不是原生错误文本', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new TypeError('Failed to fetch'));
        },
      }),
      { status: 200 },
    )) as typeof fetch;
  try {
    await assert.rejects(() => streamChatMessage('hi', undefined, { userId: 'u-1' }), /网络连接中断/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamChatMessage：非 2xx 用服务端 message；error 帧转成异常', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: '请求过于频繁，请 12 秒后重试' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    await assert.rejects(
      () => streamChatMessage('hi', undefined, { userId: 'u' }),
      /请求过于频繁/,
    );

    const encoder = new TextEncoder();
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(`event: error\ndata: ${JSON.stringify({ type: 'error', message: '上游炸了' })}\n\n`),
            );
            controller.close();
          },
        }),
        { status: 200 },
      )) as typeof fetch;
    await assert.rejects(() => streamChatMessage('hi', undefined, { userId: 'u' }), /上游炸了/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
