import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { AGENT_CONFIG, buildChatConfig } from '../../config/agent.config';
import { setupApiDocs } from '../docs/api-docs';
import { buildSystemPrompt } from '../../agent/prompts/system';
import { MEDTRUST_API_CLIENT } from '../../agent/tools/api-client';
import { FakeApiClient } from '../../test-utils/fake-api-client';
import {
  CANONICAL_SCENARIO_VALUES,
  SCENARIO_PROMPTS,
} from '../../test-utils/canonical-scenario-values';
import { SCENARIOS } from '../../agent/scenarios';

/**
 * 用例**必须**在确定性回退上跑。
 *
 * `load-env.ts` 会在模块导入期把 `apps/chat-agent/.env` 灌进 `process.env`（含真实
 * `DEEPSEEK_API_KEY`），于是配置工厂会选中 deepseek —— 用例会真打外部模型：超时、烧钱、
 * 结果不可复现。这里在导入之后、编译测试模块之前把供应商钉死为 rule-based。
 */
process.env.LLM_PROVIDER = 'rule-based';

/** 用规范取值直接构造卡片提交信封（与 SCENARIO_PROMPTS 同源，避免两处漂移）。 */
function submitExternalControlMessage(): string {
  return `[card:submit] ${JSON.stringify({
    kind: 'card-submit',
    cardType: 'form',
    title: '外部对照配置',
    scenario: 'external-control',
    values: CANONICAL_SCENARIO_VALUES['external-control'],
  })}`;
}

describe('Chat API（e2e）', () => {
  let app: INestApplication;
  let api: FakeApiClient;

  beforeAll(async () => {
    api = new FakeApiClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDTRUST_API_CLIENT)
      .useValue(api)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // 与 main.ts 走同一个挂载函数：文档端点在本用例里是真的，不是靠 bootstrap 才有。
    setupApiDocs(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('健康检查：存活与就绪', async () => {
    const live = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(live.body).toMatchObject({ status: 'ok', service: 'chat-agent' });

    const ready = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(ready.body.checks.llm).toBe('rule-based');
    // 如实报告真正在用的存储：默认 memory；CHAT_AGENT_DB=sqlite 时是 sqlite。
    expect(['memory', 'sqlite']).toContain(ready.body.checks.sessionStore);
  });

  it('POST /api/v1/chat：自然语言 → FormCard', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/chat')
      .set('x-user-id', 'user-e2e')
      .set('x-space-id', 'sh-med')
      .send({ message: '我想做单臂试验的外部对照' })
      .expect(201);

    expect(response.body.sessionId).toBeTruthy();
    expect(response.body.cards[0]).toMatchObject({ type: 'form', scenario: 'external-control' });
  });

  it('POST /api/v1/chat：卡片提交 → 任务 ID 状态卡', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/chat')
      .set('x-user-id', 'user-e2e')
      .send({ message: '我想做单臂试验的外部对照' })
      .expect(201);

    const envelope = `[card:submit] ${JSON.stringify({
      kind: 'card-submit',
      cardType: 'form',
      title: '外部对照配置',
      scenario: 'external-control',
      values: {
        trial: 'p-sponsor',
        trialDataProduct: 'dp-trial',
        controls: 'p-hosp-a',
        controlsDataProduct: 'dp-controls',
        strataKeys: '<40|M, 40+|F',
      },
    })}`;

    const second = await request(app.getHttpServer())
      .post('/api/v1/chat')
      .set('x-user-id', 'user-e2e')
      .send({ message: envelope, sessionId: first.body.sessionId })
      .expect(201);

    expect(second.body.sessionId).toBe(first.body.sessionId);
    expect(api.submissions.length).toBeGreaterThan(0);
    const status = second.body.cards.find((card: { type: string }) => card.type === 'status');
    expect(status.data.jobId).toBe('job-fake-1');
  });

  it('POST /api/v1/chat：空消息返回 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat')
      .set('x-user-id', 'user-e2e')
      .send({ message: '' })
      .expect(400);
  });

  it('会话 CRUD', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/chat')
      .set('x-user-id', 'user-crud')
      .send({ message: '你好' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/api/v1/chat/sessions')
      .set('x-user-id', 'user-crud')
      .expect(200);
    expect(list.body.map((session: { id: string }) => session.id)).toContain(created.body.sessionId);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/chat/sessions/${created.body.sessionId}`)
      .set('x-user-id', 'user-crud')
      .expect(200);
    expect(detail.body.messages.length).toBeGreaterThanOrEqual(2);

    await request(app.getHttpServer())
      .delete(`/api/v1/chat/sessions/${created.body.sessionId}`)
      .set('x-user-id', 'user-crud')
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/chat/sessions/${created.body.sessionId}`)
      .set('x-user-id', 'user-crud')
      .expect(404);
  });

  for (const scenario of SCENARIOS) {
    it(`六场景端到端：${scenario.id} 出卡 → 回灌提交 → 拿到任务 ID`, async () => {
      const prompt = SCENARIO_PROMPTS[scenario.id];
      const values = CANONICAL_SCENARIO_VALUES[scenario.id];
      expect(prompt).toBeTruthy();
      expect(values).toBeTruthy();

      const opened = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', `user-${scenario.id}`)
        .set('x-space-id', 'sh-med')
        .send({ message: prompt })
        .expect(201);

      const card = opened.body.cards[0];
      expect(card).toMatchObject({ type: 'form', scenario: scenario.id });

      const envelope = `[card:submit] ${JSON.stringify({
        kind: 'card-submit',
        cardType: 'form',
        title: card.title,
        scenario: card.scenario,
        values,
      })}`;

      const submitted = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', `user-${scenario.id}`)
        .set('x-space-id', 'sh-med')
        .send({ message: envelope, sessionId: opened.body.sessionId })
        .expect(201);

      const status = submitted.body.cards.find(
        (item: { type: string }) => item.type === 'status',
      );
      expect(status?.tone).toBe('success');
      expect(status?.data?.jobId).toBe('job-fake-1');
    });
  }

  it('他人会话返回 403', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/chat')
      .set('x-user-id', 'user-a')
      .send({ message: '你好' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/chat/sessions/${created.body.sessionId}`)
      .set('x-user-id', 'user-b')
      .expect(403);
  });

  it('事件流：POST /api/v1/chat/stream 推送 start/card/done（4.1.1）', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/chat/stream')
      .set('x-user-id', 'user-stream')
      .set('x-space-id', 'sh-med')
      .send({ message: '我想做单臂试验的外部对照' })
      .expect(201);

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('event: start');
    expect(response.text).toContain('event: card');
    expect(response.text).toContain('event: done');
    expect(response.text).toContain('"scenario":"external-control"');
  });

  it('事件流：提交时先推 tool 事件，done 里带 jobId（4.1.1）', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/chat/stream')
      .set('x-user-id', 'user-stream-submit')
      .set('x-space-id', 'sh-med')
      .send({ message: submitExternalControlMessage() })
      .expect(201);

    expect(response.text).toContain('event: tool');
    expect(response.text).toContain('submit_external_control');
    expect(response.text).toContain('job-fake-1');
  });

  it('事件流：参数错误在写响应头之前返回 400 JSON（不是 SSE error 帧）', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/chat/stream')
      .set('x-user-id', 'user-stream-bad')
      .send({ message: '   ' })
      .expect(400);
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('API 文档：/api/docs-json 产出 OpenAPI spec（4.5.3）', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const spec = response.body;

    expect(spec.info.title).toBe('MedTrust Chat Agent API');
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/chat',
        '/api/v1/chat/stream',
        '/api/v1/chat/sessions',
        '/api/v1/chat/sessions/{id}',
        '/api/v1/metrics',
      ]),
    );
    // 请求体来自 DTO 的 @ApiProperty，不是空壳
    const requestSchema = spec.paths['/api/v1/chat'].post.requestBody.content['application/json'].schema;
    expect(requestSchema).toBeDefined();
    // 流式端点声明了 201 与 4xx（含限流）
    expect(spec.paths['/api/v1/chat/stream'].post.responses['201']).toBeDefined();
    expect(spec.paths['/api/v1/chat/stream'].post.responses['429']).toBeDefined();
  });

  it('可观测性：/api/v1/metrics 暴露 Prometheus 文本（4.2.2）', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/metrics').expect(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('# TYPE chat_requests_total counter');
    expect(response.text).toContain('chat_requests_total{outcome="success"}');
    expect(response.text).toMatch(/chat_agent_uptime_seconds \d/);
  });

  it('输入边界：超长消息返回 413（4.3.2）', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat')
      .set('x-user-id', 'user-toolong')
      .send({ message: 'x'.repeat(4001) })
      .expect(413);
  });

  it('输入边界：非字符串 message 返回 400（4.3.2）', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat')
      .set('x-user-id', 'user-badtype')
      .send({ message: { evil: true } })
      .expect(400);
  });
});

describe('Chat API · 合规流程（e2e，Phase 1-4）', () => {
  // 这里**不手写信封**：审批卡是从上一步工具返回的 data.card 里取出来的，
  // 与真实前端「渲染卡片 → 用户点按钮 → 回灌 values」的链路同形。
  const buildApp = async (api: FakeApiClient) => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDTRUST_API_CLIENT)
      .useValue(api)
      .compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    return app;
  };

  // 带上 Authorization：没有调用者凭证时合规闸只能判 unknown（查询故障不拦），
  // 那是控制面兜底的语义，不是这里要测的路径。
  const AUTH = 'Bearer token-1';
  const externalControlValues = CANONICAL_SCENARIO_VALUES['external-control'];

  const submitEnvelope = (sessionId: string | undefined, values: Record<string, unknown>) => ({
    message: `[card:submit] ${JSON.stringify({
      kind: 'card-submit',
      cardType: 'form',
      title: '外部对照配置',
      scenario: 'external-control',
      values,
    })}`,
    ...(sessionId ? { sessionId } : {}),
  });

  const bundleRequestMessage = (
    card: {
      title: string;
      requirements: Array<{ request?: Record<string, unknown> }>;
    },
    index: number,
  ) =>
    `[card:submit] ${JSON.stringify({
      kind: 'card-submit',
      cardType: 'contract_bundle',
      title: card.title,
      values: card.requirements[index]?.request ?? {},
    })}`;

  it('有合约：任务提交成功，且结果卡带上授权用的 contractId', async () => {
    const api = new FakeApiClient();
    const app = await buildApp(api);
    try {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'user-has-contract')
        .set('x-space-id', 'sh-med')
        .set('authorization', AUTH)
        .send(submitEnvelope(undefined, externalControlValues))
        .expect(201);

      const status = response.body.cards.find((card: { type: string }) => card.type === 'status');
      expect(status?.tone).toBe('success');
      expect(status?.data?.jobId).toBe('job-fake-1');
      expect(api.submissions[0].submission.payload).toMatchObject({
        contracts: ['ct-fake-trial', 'ct-fake-1'],
      });

      const metrics = await request(app.getHttpServer()).get('/api/v1/metrics').expect(200);
      expect(metrics.text).toContain('compliance_decisions_total{scenario="external-control",verdict="ready"}');
    } finally {
      await app.close();
    }
  });

  it('无合约：提交被拦 + 出合约审批卡；提供方连接器为人工策略时走到"申请已提交（待签发）"', async () => {
    const api = new FakeApiClient({ contracts: [], autoOffer: 'offer-only' });
    const app = await buildApp(api);
    try {
      const blocked = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'user-no-contract')
        .set('x-space-id', 'sh-med')
        .set('authorization', AUTH)
        .send(submitEnvelope(undefined, externalControlValues))
        .expect(201);

      expect(api.submissions).toHaveLength(0);
      // 拦下来的具体原因在正文里（控制面的错误码照抄，不翻译成"失败了"）
      expect(blocked.body.message.content).toContain('E_CONTRACT_MISSING');

      const bundle = blocked.body.cards.find(
        (card: { type: string }) => card.type === 'contract_bundle',
      );
      expect(bundle).toBeTruthy();
      expect(bundle.requirements).toHaveLength(2);

      const confirmed = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'user-no-contract')
        .set('x-space-id', 'sh-med')
        .set('authorization', AUTH)
        .send({
          message: bundleRequestMessage(bundle, 0),
          sessionId: blocked.body.sessionId,
        })
        .expect(201);

      expect(api.contractRequests).toHaveLength(1);
      expect(api.contractRequests[0].input).toMatchObject({
        dataProductId: 'dp-trial',
        // 用途取自提交载荷（聊天侧的统一用途），不是模型临时编的文案
        purpose: '对话式任务配置（AI Chat Agent）',
        compositionId: 'comp-fake-1',
      });
      const pending = confirmed.body.cards.find((card: { type: string }) => card.type === 'status');
      expect(pending?.tone).toBe('pending');
      expect(pending?.data?.contractId).toBe('ct-requested-1');

      const metrics = await request(app.getHttpServer()).get('/api/v1/metrics').expect(200);
      expect(metrics.text).toContain('verdict="needs_contract"');
      expect(metrics.text).toContain('verdict="contract_requested"');
      // 审计链：拦下来的判定与真发出去的申请都落了条目（5.1）
      expect(api.auditEntries.map((item) => item.entry)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'READ',
            resource: 'compliance-gate',
            details: expect.objectContaining({ verdict: 'needs_contract', contractId: null }),
          }),
          expect.objectContaining({
            action: 'CREATE',
            resource: 'contract',
            details: expect.objectContaining({ contractId: 'ct-requested-1', status: 'draft' }),
          }),
        ]),
      );
      // 审计条目归属到**调用者**（不是 agent 自己）
      expect(api.auditEntries[0].ctx).toMatchObject({ userId: 'user-no-contract', token: 'token-1' });
      expect(metrics.text).toContain('compliance_audit_write_total{outcome="written"}');
    } finally {
      await app.close();
    }
  });

  it('Phase 3 自动创建：预授权 + 院内自动签 → 确认申请后合约即刻可用，随后一次提交即成功', async () => {
    // 缺省 FakeApiClient = 控制面接受预授权自动推进、且院内连接器按本地策略自动签
    const api = new FakeApiClient({ contracts: [] });
    const app = await buildApp(api);
    try {
      const blocked = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'user-auto')
        .set('x-space-id', 'sh-med')
        .set('authorization', AUTH)
        .send(submitEnvelope(undefined, externalControlValues))
        .expect(201);

      const bundle = blocked.body.cards.find(
        (card: { type: string }) => card.type === 'contract_bundle',
      );
      expect(bundle).toBeTruthy();

      // 用户确认 → 申请 + 自动推进 + 自动签（全程没有医院点按钮）
      const confirmed = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'user-auto')
        .set('x-space-id', 'sh-med')
        .set('authorization', AUTH)
        .send({
          message: bundleRequestMessage(bundle, 0),
          sessionId: blocked.body.sessionId,
        })
        .expect(201);

      const ready = confirmed.body.cards.find(
        (card: { type: string; tone?: string }) => card.type === 'status',
      );
      expect(ready).toMatchObject({ tone: 'success' });
      expect(ready?.title).toContain('自动生效');
      expect(ready?.data?.contractId).toBe('ct-requested-1');

      const confirmedSecond = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'user-auto')
        .set('x-space-id', 'sh-med')
        .set('authorization', AUTH)
        .send({
          message: bundleRequestMessage(bundle, 1),
          sessionId: blocked.body.sessionId,
        })
        .expect(201);
      expect(
        confirmedSecond.body.cards.find(
          (card: { type: string; tone?: string }) => card.type === 'status',
        )?.tone,
      ).toBe('success');
      expect(api.contractRequests).toHaveLength(2);

      // 合约已可用：同一次对话里直接提交成功，载荷带的就是这份新合约
      const submitted = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'user-auto')
        .set('x-space-id', 'sh-med')
        .set('authorization', AUTH)
        .send(submitEnvelope(blocked.body.sessionId, externalControlValues))
        .expect(201);

      const status = submitted.body.cards.find((card: { type: string }) => card.type === 'status');
      expect(status?.tone).toBe('success');
      expect(api.submissions[0].submission.payload).toMatchObject({
        contracts: ['ct-requested-1', 'ct-requested-2'],
      });
    } finally {
      await app.close();
    }
  });

  it('完整链路（4.5）：申请 → 提供方签发 → 再提交成功，且载荷用的是签发的那份合约', async () => {
    const api = new FakeApiClient({ contracts: [] });
    const app = await buildApp(api);
    try {
      const blocked = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'user-full-chain')
        .set('x-space-id', 'sh-med')
        .set('authorization', AUTH)
        .send(submitEnvelope(undefined, externalControlValues))
        .expect(201);

      const bundle = blocked.body.cards.find(
        (card: { type: string }) => card.type === 'contract_bundle',
      );
      const requested = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'user-full-chain')
        .set('x-space-id', 'sh-med')
        .set('authorization', AUTH)
        .send({
          message: bundleRequestMessage(bundle, 0),
          sessionId: blocked.body.sessionId,
        })
        .expect(201);
      expect(
        requested.body.cards.find((card: { type: string }) => card.type === 'status')?.data?.contractId,
      ).toBe('ct-requested-1');

      const requestedSecond = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'user-full-chain')
        .set('x-space-id', 'sh-med')
        .set('authorization', AUTH)
        .send({
          message: bundleRequestMessage(bundle, 1),
          sessionId: blocked.body.sessionId,
        })
        .expect(201);
      expect(
        requestedSecond.body.cards.find(
          (card: { type: string }) => card.type === 'status',
        )?.data?.contractId,
      ).toBe('ct-requested-2');

      // 数据提供方签发（真实系统里是医院连接器签 ContractAgree；agent 侧没有这条路径）
      api.issueContract('ct-requested-1', {
        providerId: 'p-sponsor',
        consumerId: 'pharma-demo',
        dataProductId: 'dp-trial',
      });
      api.issueContract('ct-requested-2', {
        providerId: 'p-hosp-a',
        consumerId: 'pharma-demo',
        dataProductId: 'dp-controls',
      });

      const submitted = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'user-full-chain')
        .set('x-space-id', 'sh-med')
        .set('authorization', AUTH)
        .send(submitEnvelope(blocked.body.sessionId, externalControlValues))
        .expect(201);

      const status = submitted.body.cards.find((card: { type: string }) => card.type === 'status');
      expect(status?.tone).toBe('success');
      expect(status?.data?.jobId).toBe('job-fake-1');
      // 提交载荷带的是**签发后**的那份合约，不是别的
      expect(api.submissions[0].submission.payload).toMatchObject({
        contracts: ['ct-requested-1', 'ct-requested-2'],
      });

      // 审计链：作业提交记 COMPUTE/rws-task 并带合约 id
      expect(api.auditEntries.map((item) => item.entry)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'COMPUTE',
            resource: 'rws-task',
            details: expect.objectContaining({ jobId: 'job-fake-1', contractId: 'ct-requested-1' }),
          }),
        ]),
      );

      const metrics = await request(app.getHttpServer()).get('/api/v1/metrics').expect(200);
      expect(metrics.text).toContain('job_submissions_total{contract="linked",outcome="submitted"}');
      expect(metrics.text).toContain('job_submissions_total{contract="unlinked",outcome="blocked"}');
    } finally {
      await app.close();
    }
  });

  it('审计链不可用：动作照常完成，但指标如实报失败（记录缺失不能被吞掉）', async () => {
    const api = new FakeApiClient({ auditFailWith: 'ECONNREFUSED' });
    const app = await buildApp(api);
    try {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'user-audit-down')
        .set('x-space-id', 'sh-med')
        .set('authorization', AUTH)
        .send(submitEnvelope(undefined, externalControlValues))
        .expect(201);

      const status = response.body.cards.find((card: { type: string }) => card.type === 'status');
      expect(status?.tone).toBe('success');
      expect(api.submissions).toHaveLength(1);

      const metrics = await request(app.getHttpServer()).get('/api/v1/metrics').expect(200);
      expect(metrics.text).toContain('compliance_audit_write_total{outcome="failed"}');
      expect(metrics.text).not.toContain('compliance_audit_write_total{outcome="written"}');
    } finally {
      await app.close();
    }
  });

  it('没有合规预审：合约申请被引导，不产生假申请', async () => {
    const api = new FakeApiClient({ contracts: [], compositions: [] });
    const app = await buildApp(api);
    try {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'user-no-prereview')
        .set('x-space-id', 'sh-med')
        .set('authorization', AUTH)
        .send({
          message: `[card:submit] ${JSON.stringify({
            kind: 'card-submit',
            cardType: 'contract_approval',
            title: '数据合约申请审批',
            values: {
              action: 'request_contract',
              dataProductId: 'dp-trial',
              purpose: '外部对照 RWS',
              retention: '阅后即焚',
              output: '仅聚合统计',
              validDays: 30,
            },
          })}`,
        })
        .expect(201);

      expect(api.contractRequests).toHaveLength(0);
      const guide = response.body.cards.find(
        (card: { type: string }) => card.type === 'contract_request',
      );
      expect(guide?.steps?.join()).toContain('合规预审');
    } finally {
      await app.close();
    }
  });

  it('产品级 ACL：未授权时被拦并给出"找提供方开权限"，授权后同一次提交通过', async () => {
    const api = new FakeApiClient({ dataAccess: {} });
    const app = await buildApp(api);
    try {
      const blocked = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'user-no-acl')
        .set('x-space-id', 'sh-med')
        .set('authorization', AUTH)
        .send(submitEnvelope(undefined, externalControlValues))
        .expect(201);

      expect(api.submissions).toHaveLength(0);
      const guide = blocked.body.cards.find(
        (card: { type: string }) => card.type === 'contract_request',
      );
      expect(guide?.title).toContain('访问授权');
      expect(guide?.steps?.join()).toContain('数据提供方');
      // 授权问题不该被说成合约问题
      expect(
        blocked.body.cards.some((card: { type: string }) => card.type === 'contract_approval'),
      ).toBe(false);

      const metrics = await request(app.getHttpServer()).get('/api/v1/metrics').expect(200);
      expect(metrics.text).toContain('verdict="needs_data_access"');

      // 数据提供方授予访问权（真实系统走 POST /data-access/grants）
      api.grantDataAccess('dp-trial');
      api.grantDataAccess('dp-controls');

      const submitted = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'user-no-acl')
        .set('x-space-id', 'sh-med')
        .set('authorization', AUTH)
        .send(submitEnvelope(undefined, externalControlValues))
        .expect(201);

      const status = submitted.body.cards.find((card: { type: string }) => card.type === 'status');
      expect(status?.tone).toBe('success');
      expect(api.submissions).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('不属于该空间：拦在权限上，且不误报成合约问题', async () => {
    const api = new FakeApiClient({
      mySpaces: { spaces: ['other'], memberships: [{ spaceId: 'other', role: 'member' }] },
    });
    const app = await buildApp(api);
    try {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'user-outsider')
        .set('x-space-id', 'sh-med')
        .set('authorization', AUTH)
        .send(submitEnvelope(undefined, externalControlValues))
        .expect(201);

      expect(api.submissions).toHaveLength(0);
      expect(
        response.body.cards.some(
          (card: { type: string }) =>
            card.type === 'contract_approval' || card.type === 'contract_request',
        ),
      ).toBe(false);
      const errorCard = response.body.cards.find((card: { type: string }) => card.type === 'status');
      expect(errorCard?.tone).toBe('error');
      expect(errorCard?.description).toContain('不属于空间');

      const metrics = await request(app.getHttpServer()).get('/api/v1/metrics').expect(200);
      expect(metrics.text).toContain('verdict="needs_permission"');
    } finally {
      await app.close();
    }
  });
});

describe('Chat API · 限流（e2e，4.3.1）', () => {
  let limited: INestApplication;

  beforeAll(async () => {
    const limitedConfig = buildChatConfig(
      {
        RATE_LIMIT_PER_USER_PER_MIN: '2',
        RATE_LIMIT_PER_IP_PER_MIN: '0',
        METRICS_ENABLED: 'false',
      },
      buildSystemPrompt(),
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDTRUST_API_CLIENT)
      .useValue(new FakeApiClient())
      .overrideProvider(AGENT_CONFIG)
      .useValue(limitedConfig)
      .compile();

    limited = moduleRef.createNestApplication();
    limited.setGlobalPrefix('api/v1');
    await limited.init();
  });

  afterAll(async () => {
    await limited?.close();
  });

  it('同一用户第 3 次请求被 429 拒绝并带 Retry-After', async () => {
    const send = () =>
      request(limited.getHttpServer())
        .post('/api/v1/chat')
        .set('x-user-id', 'limited-user')
        .send({ message: '你好' });

    await send().expect(201);
    await send().expect(201);

    const blocked = await send().expect(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.body.message).toContain('请求过于频繁');
  });

  it('另一用户不受影响（按用户维度计数）', async () => {
    await request(limited.getHttpServer())
      .post('/api/v1/chat')
      .set('x-user-id', 'other-user')
      .send({ message: '你好' })
      .expect(201);
  });

  it('METRICS_ENABLED=false 时指标端点自述关闭', async () => {
    const response = await request(limited.getHttpServer()).get('/api/v1/metrics').expect(200);
    expect(response.text).toBe('# metrics disabled\n');
  });
});
