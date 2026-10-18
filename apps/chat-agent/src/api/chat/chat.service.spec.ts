import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { encodeCardSubmission } from '@medtrust/chat-cards';
import { buildChatConfig } from '../../config/agent.config';
import { buildSystemPrompt } from '../../agent/prompts/system';
import { InMemorySessionRepository } from '../../session/in-memory-session.repository';
import { MetricsService } from '../../observability/metrics.service';
import { DirectoryCache } from '../../cache/directory-cache.service';
import { NullKeyValueStore, type KeyValueStore } from '../../store/key-value.store';
import { FakeKeyValueStore } from '../../test-utils/key-value-store.fake';
import { FakeApiClient, type FakeApiOptions } from '../../test-utils/fake-api-client';
import { ChatService } from './chat.service';
import type { ChatEvent } from './chat.events';

const config = buildChatConfig(
  { DEFAULT_CONTRACTS: 'ct-1', DEFAULT_MIN_CELL: '5' },
  buildSystemPrompt(),
);
const identity = { userId: 'user-1', spaceId: 'sh-med' };

function make(options: FakeApiOptions & { store?: KeyValueStore } = {}) {
  const api = new FakeApiClient(options);
  const repository = new InMemorySessionRepository({ ttlHours: 24, maxMessagesPerSession: 50 });
  const metrics = new MetricsService();
  const store = options.store ?? new NullKeyValueStore();
  const directoryCache = new DirectoryCache(store, 300, metrics);
  const service = new ChatService(config, repository, api, metrics, directoryCache);
  return { api, repository, metrics, store, service };
}

const EXTERNAL_CONTROL_VALUES = {
  trial: 'p-sponsor',
  trialDataProduct: 'dp-trial',
  controls: 'p-hosp-a',
  controlsDataProduct: 'dp-controls',
  strataKeys: '<40|M, 40+|F',
};

const submitExternalControl = () =>
  encodeCardSubmission({
    kind: 'card-submit',
    cardType: 'form',
    title: '外部对照配置',
    scenario: 'external-control',
    values: EXTERNAL_CONTROL_VALUES,
  });

describe('ChatService（端到端对话流程）', () => {
  it('首轮：识别场景 → 返回 FormCard，并持久化用户与助手消息', async () => {
    const { api, repository, service } = make();
    const response = await service.chat({ message: '我想做单臂试验的外部对照' }, identity);

    expect(response.sessionId).toBeTruthy();
    expect(response.cards).toHaveLength(1);
    expect(response.cards[0]).toMatchObject({ type: 'form', scenario: 'external-control' });
    expect(response.suggestions.length).toBeGreaterThan(0);
    expect(api.directoryCalls.length).toBeGreaterThan(0);

    const session = await repository.get(response.sessionId);
    expect(session?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(session?.title).toContain('单臂');
  });

  it('次轮：卡片提交 → 调用 MDOP 工具 → 返回任务 ID 状态卡', async () => {
    const { api, service } = make();
    const first = await service.chat({ message: '我想做单臂试验的外部对照' }, identity);
    const second = await service.chat(
      { message: submitExternalControl(), sessionId: first.sessionId },
      identity,
    );

    expect(second.sessionId).toBe(first.sessionId);
    expect(api.submissions).toHaveLength(1);
    expect(api.submissions[0].submission.endpoint).toBe('/mdop/jobs/external-control');
    const status = second.cards.find((card) => card.type === 'status')!;
    expect(status.tone).toBe('success');
    expect(status.data).toMatchObject({ jobId: 'job-fake-1' });
    expect(second.message.content).toContain('job-fake-1');
  });

  it('参数不合法时返回失败卡，且不提交', async () => {
    const { api, service } = make();
    const bad = encodeCardSubmission({
      kind: 'card-submit',
      cardType: 'form',
      title: '外部对照配置',
      scenario: 'external-control',
      values: { trial: 'p-sponsor', controls: 'p-sponsor', strataKeys: '<40|M' },
    });
    const response = await service.chat({ message: bad }, identity);
    expect(api.submissions).toHaveLength(0);
    const status = response.cards.find((card) => card.type === 'status')!;
    expect(status.tone).toBe('error');
    expect(status.description).toContain('不能是同一参与方');
  });

  it('控制面 API 失败时给出可恢复的失败卡', async () => {
    const { service } = make({ failWith: '409 [E_CHANNEL_UNKNOWN]' });
    const response = await service.chat({ message: submitExternalControl() }, identity);
    const status = response.cards.find((card) => card.type === 'status')!;
    expect(status.tone).toBe('error');
    expect(status.description).toContain('E_CHANNEL_UNKNOWN');
  });

  it('目录不可用时仍返回可用卡片（select 降级为文本），不静默丢卡', async () => {
    const { service } = make({ directory: { participants: [], dataProducts: [] } });

    const response = await service.chat({ message: '我想做单臂试验的外部对照' }, identity);
    expect(response.cards).toHaveLength(1);
    expect(response.cards[0].type).toBe('form');
    const trial = response.cards[0].fields?.find((field) => field.name === 'trial');
    expect(trial?.type).toBe('text');
  });

  it('空消息被拒（400）', async () => {
    const { service } = make();
    await expect(service.chat({ message: '   ' }, identity)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('超长消息被拒（413）且计入 rejected 指标（4.3.2）', async () => {
    const { metrics, service } = make();
    const tooLong = 'x'.repeat(config.maxMessageChars + 1);
    await expect(service.chat({ message: tooLong }, identity)).rejects.toMatchObject({
      status: 413,
    });
    expect(metrics.render()).toContain('chat_requests_total{outcome="rejected"} 1');
  });

  it('非字符串 message 被拒（400），不做隐式转换', async () => {
    const { service } = make();
    await expect(
      service.chat({ message: 42 as unknown as string }, identity),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('事件流：start → tool(start/end) → card → done（4.1.1）', async () => {
    const { service } = make();
    const events: ChatEvent[] = [];
    for await (const event of service.chatStream(
      { message: submitExternalControl() },
      identity,
    )) {
      events.push(event);
    }

    expect(events[0]).toMatchObject({ type: 'start', spaceId: 'sh-med' });
    expect(events[events.length - 1].type).toBe('done');

    const toolStart = events.find(
      (event): event is Extract<ChatEvent, { type: 'tool' }> =>
        event.type === 'tool' && event.phase === 'start',
    );
    expect(toolStart?.name).toBe('submit_external_control');

    const toolEnd = events.find(
      (event): event is Extract<ChatEvent, { type: 'tool' }> =>
        event.type === 'tool' && event.phase === 'end',
    );
    expect(toolEnd).toMatchObject({ ok: true });
    expect(typeof toolEnd?.durationMs).toBe('number');

    expect(events.some((event) => event.type === 'card')).toBe(true);

    const done = events.find(
      (event): event is Extract<ChatEvent, { type: 'done' }> => event.type === 'done',
    )!;
    expect(done.response.cards.some((card) => card.type === 'status')).toBe(true);
    expect(done.suggestions.length).toBeGreaterThan(0);
  });

  it('事件流与一次性返回同源：识别场景时卡片一致（同一条实现）', async () => {
    const streamed = make();
    const once = make();
    const direct = await once.service.chat(
      { message: '我想做单臂试验的外部对照' },
      identity,
    );

    let done: Extract<ChatEvent, { type: 'done' }> | undefined;
    for await (const event of streamed.service.chatStream(
      { message: '我想做单臂试验的外部对照' },
      identity,
    )) {
      if (event.type === 'done') done = event;
    }

    expect(done?.response.cards[0]).toMatchObject({
      type: direct.cards[0].type,
      scenario: direct.cards[0].scenario,
    });
    expect(done?.response.cards[0].title).toBe(direct.cards[0].title);
  });

  it('事件流：校验失败在第一次 yield 之前抛出（控制器才能给出 4xx JSON）', async () => {
    const { service } = make();
    await expect(service.chatStream({ message: '' }, identity).next()).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('事件流：上游失败时仍以 card + done 收尾（不把流打断）', async () => {
    const { service } = make({ failWith: '409 [E_CHANNEL_UNKNOWN]' });
    const events: ChatEvent[] = [];
    for await (const event of service.chatStream(
      { message: submitExternalControl() },
      identity,
    )) {
      events.push(event);
    }
    const cards = events.filter(
      (event): event is Extract<ChatEvent, { type: 'card' }> => event.type === 'card',
    );
    expect(cards.some((event) => event.card.tone === 'error')).toBe(true);
    expect(events[events.length - 1].type).toBe('done');
  });

  it('目录缓存：命中后不再打控制面（4.1.2）', async () => {
    const store = new FakeKeyValueStore();
    const { api, metrics, service } = make({ store });

    await service.chat({ message: '我想做单臂试验的外部对照' }, identity);
    expect(api.directoryCalls).toHaveLength(1);
    expect(metrics.render()).toMatch(/cache_misses_total\{[^}]*name="directory"/);

    // 第二条消息（同一空间）：目录应命中缓存，不再产生控制面请求
    await service.chat({ message: '我想预测明天的电力负荷' }, identity);
    expect(api.directoryCalls).toHaveLength(1);
    expect(metrics.render()).toMatch(/cache_hits_total\{[^}]*name="directory"/);
  });

  it('未配缓存时每次都打控制面（语义不变，只是慢一点）', async () => {
    const { api, service } = make();
    await service.chat({ message: '我想做单臂试验的外部对照' }, identity);
    await service.chat({ message: '我想预测明天的电力负荷' }, identity);
    expect(api.directoryCalls).toHaveLength(2);
  });

  it('可观测性：请求数 / 耗时 / 工具调用 / token 都有指标（4.2.2）', async () => {
    const { metrics, service } = make();
    await service.chat({ message: submitExternalControl() }, identity);

    const text = metrics.render();
    expect(text).toContain('chat_requests_total{outcome="success"} 1');
    expect(text).toContain('chat_duration_seconds_count 1');
    // 标签按字母序排列，断言不依赖顺序（只要求两个标签都在同一条序列上）
    expect(text).toMatch(/tool_calls_total\{[^}]*tool="submit_external_control"[^}]*\} 1/);
    expect(text).toMatch(/tool_calls_total\{[^}]*outcome="success"[^}]*\} 1/);
    expect(text).toMatch(/tool_calls_total\{[^}]*scenario="external-control"[^}]*\} 1/);
  });

  it('工具失败时按 outcome="error" 计数，且请求仍算 success（业务失败 ≠ 服务故障）', async () => {
    const { metrics, service } = make({ failWith: '409 [E_CHANNEL_UNKNOWN]' });
    await service.chat({ message: submitExternalControl() }, identity);

    const text = metrics.render();
    expect(text).toMatch(/tool_calls_total\{[^}]*outcome="error"[^}]*\} 1/);
    expect(text).toContain('chat_requests_total{outcome="success"} 1');
  });

  it('会话按用户隔离：他人会话不可读、不可删', async () => {
    const { service } = make();
    const created = await service.chat({ message: '你好' }, identity);
    await expect(
      service.getSession(created.sessionId, { userId: 'user-2', spaceId: 'sh-med' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.deleteSession(created.sessionId, { userId: 'user-2', spaceId: 'sh-med' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await service.getSession(created.sessionId, identity)).toMatchObject({
      id: created.sessionId,
    });
  });

  it('不存在的会话返回 404，删除幂等', async () => {
    const { service } = make();
    await expect(
      service.getSession('missing-session', identity),
    ).rejects.toThrow('会话不存在或已过期');
    await expect(service.deleteSession('missing-session', identity)).resolves.toEqual({
      success: true,
    });
  });

  it('会话列表不带消息体，且空间过滤生效', async () => {
    const { service } = make();
    await service.chat({ message: '我想预测明天的电力负荷', spaceId: 'power-space' }, identity);
    const inMedical = await service.listSessions(identity, 'sh-med');
    const inPower = await service.listSessions(identity, 'power-space');
    expect(inMedical).toHaveLength(0);
    expect(inPower).toHaveLength(1);
    expect(inPower[0].messages).toEqual([]);
  });

  it('提交失败 → 按已填值重新出卡 → 改完再提交成功（3.4.3 错误恢复）', async () => {
    const { api, service } = make({ failWith: '409 [E_CHANNEL_UNKNOWN]', failTimes: 1 });

    const failed = await service.chat({ message: submitExternalControl() }, identity);
    expect(failed.cards.find((card) => card.type === 'status')?.tone).toBe('error');

    const retryCard = failed.cards.find((card) => card.type === 'form');
    expect(retryCard?.scenario).toBe('external-control');
    expect(retryCard?.title).toBe('修改后重新提交');
    // 用户填过的值被放回卡片，不需要从头再填
    expect(retryCard?.fields?.find((field) => field.name === 'trial')?.defaultValue).toBe(
      'p-sponsor',
    );
    expect(retryCard?.fields?.find((field) => field.name === 'controls')?.defaultValue).toBe(
      'p-hosp-a',
    );

    const fixed = encodeCardSubmission({
      kind: 'card-submit',
      cardType: 'form',
      title: '修改后重新提交',
      scenario: 'external-control',
      values: { ...EXTERNAL_CONTROL_VALUES, controls: 'p-hosp-b', controlsDataProduct: 'dp-hosp-b' },
    });
    const ok = await service.chat({ message: fixed, sessionId: failed.sessionId }, identity);

    expect(api.submissions).toHaveLength(2);
    expect(api.submissions[1].submission.payload).toMatchObject({
      controls: { participantId: 'p-hosp-b', dataProductId: 'dp-hosp-b' },
    });
    expect(ok.cards.find((card) => card.type === 'status')?.tone).toBe('success');
  });

  it('多轮改场景：从队列计数切到单臂对照，再提交（3.4.2 场景切换）', async () => {
    const { api, service } = make();

    const first = await service.chat({ message: '统计一下队列人数' }, identity);
    expect(first.cards[0]).toMatchObject({ type: 'form', scenario: 'cohort-count' });

    const second = await service.chat(
      { message: '改成单臂试验的外部对照', sessionId: first.sessionId },
      identity,
    );
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.cards[0]).toMatchObject({ type: 'form', scenario: 'external-control' });

    const third = await service.chat(
      { message: submitExternalControl(), sessionId: first.sessionId },
      identity,
    );
    expect(api.submissions).toHaveLength(1);
    expect(api.submissions[0].submission.scenarioId).toBe('external-control');
    expect(third.cards.find((card) => card.type === 'status')?.tone).toBe('success');
  });

  it('超过 20 条消息窗口后仍从 ScenarioDraft 恢复双数据源并提交', async () => {
    const { api, service, repository } = make();
    const first = await service.chat({ message: '我想做单臂试验的外部对照' }, identity);
    for (let index = 0; index < 22; index += 1) {
      await service.chat(
        { message: `补充说明 ${index + 1}`, sessionId: first.sessionId },
        identity,
      );
    }
    const session = await repository.get(first.sessionId);
    expect(session?.messages.length).toBeGreaterThan(20);
    expect(session?.scenarioDraft).toMatchObject({
      scenarioId: 'external-control',
      purposeCode: '对话式任务配置（AI Chat Agent）',
    });

    const submitted = await service.chat(
      { message: submitExternalControl(), sessionId: first.sessionId },
      identity,
    );
    expect(api.submissions).toHaveLength(1);
    expect(api.submissions[0].submission.payload).toMatchObject({
      trial: {
        participantId: EXTERNAL_CONTROL_VALUES.trial,
        dataProductId: EXTERNAL_CONTROL_VALUES.trialDataProduct,
      },
      controls: {
        participantId: EXTERNAL_CONTROL_VALUES.controls,
        dataProductId: EXTERNAL_CONTROL_VALUES.controlsDataProduct,
      },
    });
    expect(submitted.draft?.status).toBe('submitted');
  });
});
