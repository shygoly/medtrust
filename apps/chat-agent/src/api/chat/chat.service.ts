import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { LLMMessage } from '@medtrust/pi-agent';
import {
  extractCardMessages,
  parseCardSubmission,
  type CardMessage,
} from '@medtrust/chat-cards';
import { AGENT_CONFIG, type MedTrustChatConfig } from '../../config/agent.config';
import { createMedTrustAgent } from '../../agent/agent.factory';
import { EMPTY_DIRECTORY, type SpaceDirectory } from '../../agent/directory';
import {
  findScenario,
  findScenarioByToolName,
  inferPacksFromSpaceId,
  startersForPacks,
  type ScenarioDefaults,
} from '../../agent/scenarios';
import { buildErrorCard, renderCardFence } from '../../cards/card-builder';
import { buildScenarioFormCard } from '../../cards/card-builder';
import { bestScenario } from '../../agent/scenario-matcher';
import {
  MEDTRUST_API_CLIENT,
  type AuditEntryInput,
  type MedTrustApiClient,
} from '../../agent/tools/api-client';
import { MetricsService } from '../../observability/metrics.service';
import { pseudonymize } from '../../observability/json.logger';
import { withSpan } from '../../observability/tracing';
import { normalizeUserMessage } from '../../common/input';
import { DirectoryCache } from '../../cache/directory-cache.service';
import {
  SESSION_REPOSITORY,
  type ChatMessage,
  type ChatSession,
  type SessionRepository,
} from '../../session/session.types';
import { contextWindow } from './context-window';
import { complianceAudit } from './compliance-audit';
import type { ChatEvent } from './chat.events';
import type { ChatIdentity, ChatRequestDto, ChatResponseDto } from './chat.types';
import {
  ASSISTANT_INTENTS,
  buildIntentSelectionCard,
  routeAssistantIntent,
  type AssistantIntent,
} from '../../agent/assistant-intent';
import {
  attachDraftContext,
  buildScenarioDraft,
  updateScenarioDraftStatus,
  type ScenarioDraft,
} from '../../agent/scenario-draft';

const PURPOSE = '对话式任务配置（AI Chat Agent）';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(AGENT_CONFIG) private readonly config: MedTrustChatConfig,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(MEDTRUST_API_CLIENT) private readonly api: MedTrustApiClient,
    private readonly metrics: MetricsService,
    private readonly directoryCache: DirectoryCache,
  ) {}

  /**
   * 请求校验（4.3.2）。**在打开 SSE 之前**调用：只有这时才能给出正确的 4xx JSON，
   * 一旦写出 `text/event-stream` 响应头，状态码就改不了了。
   */
  validateRequest(dto: ChatRequestDto): string {
    const normalized = normalizeUserMessage(dto?.message, this.config.maxMessageChars);
    if (!normalized.ok) {
      this.metrics.increment('chat_requests_total', { outcome: 'rejected' });
      throw normalized.status === HttpStatus.PAYLOAD_TOO_LARGE
        ? new PayloadTooLargeException(normalized.reason)
        : new BadRequestException(normalized.reason);
    }
    return normalized.text;
  }

  /** 一次性返回（`POST /chat`）：内部消费同一条事件流，保证两条路径行为一致。 */
  async chat(dto: ChatRequestDto, identity: ChatIdentity): Promise<ChatResponseDto> {
    let result: ChatResponseDto | undefined;
    for await (const event of this.chatStream(dto, identity)) {
      if (event.type === 'done') result = event.response;
    }
    if (!result) throw new InternalServerErrorException('对话未产出结果');
    return result;
  }

  /**
   * 事件流（`POST /chat/stream`）。
   *
   * 工具循环是**回调**驱动的（PiAgent hooks），而生成器只能在自己被 `next()` 时 yield，
   * 所以用一个队列 + "唤醒"回调把回调事件接进生成器：队列非空就 yield，
   * 处理未结束就挂起等待，直到 finally 里置位 finished。
   */
  async *chatStream(dto: ChatRequestDto, identity: ChatIdentity): AsyncGenerator<ChatEvent> {
    const message = this.validateRequest(dto);
    const startedAt = Date.now();

    const spaceId = dto.spaceId?.trim() || identity.spaceId;
    const session = await this.resolveSession(dto.sessionId, identity, spaceId);
    const role = await this.resolveRole(identity);
    const submission = parseCardSubmission(message);
    const submittedIntent =
      submission?.cardType === 'assistant_intent' &&
      typeof submission.values.assistantIntent === 'string' &&
      (ASSISTANT_INTENTS as readonly string[]).includes(submission.values.assistantIntent)
        ? (submission.values.assistantIntent as AssistantIntent)
        : undefined;
    const explicitIntent =
      submittedIntent ??
      (typeof dto.assistantIntent === 'string' &&
      (ASSISTANT_INTENTS as readonly string[]).includes(dto.assistantIntent)
        ? (dto.assistantIntent as AssistantIntent)
        : undefined);
    const intentRoute = routeAssistantIntent({
      message,
      ...(role ? { role } : {}),
      ...(dto.page ? { page: dto.page } : {}),
      ...(session.scenarioDraft?.assistantIntent
        ? { draftIntent: session.scenarioDraft.assistantIntent }
        : {}),
      ...(explicitIntent ? { explicitIntent } : {}),
    });
    let draft: ScenarioDraft | undefined = session.scenarioDraft;
    if (
      dto.context?.objectType &&
      dto.context.objectId
    ) {
      draft = attachDraftContext(draft, intentRoute.primary, {
        objectType: dto.context.objectType,
        objectId: dto.context.objectId,
        page: dto.context.page ?? dto.page ?? '/space/assistant',
        ...(dto.context.status ? { status: dto.context.status } : {}),
      });
      await this.sessions.setScenarioDraft(session.id, draft);
    }
    if (submission?.cardType === 'form' && submission.scenario) {
      const scenario = findScenario(submission.scenario);
      if (scenario) {
        draft = buildScenarioDraft(scenario, intentRoute.primary, submission.values);
        await this.sessions.setScenarioDraft(session.id, draft);
      }
    }
    const agentMessage =
      submission?.cardType === 'assistant_intent'
        ? '请列出当前可以配置的场景，等待我选择。'
        : message;

    const userMessage = await this.sessions.appendMessage(session.id, {
      role: 'user',
      content: message,
    });
    const history = ((await this.sessions.get(session.id))?.messages ?? []).filter(
      (item) => item.id !== userMessage?.id,
    );

    const directory = await this.loadDirectory(spaceId);
    const defaults = this.buildDefaults(identity, spaceId);

    yield { type: 'start', sessionId: session.id, spaceId };

    const queue: ChatEvent[] = [];
    let wake: (() => void) | null = null;
    let finished = false;
    const push = (event: ChatEvent): void => {
      queue.push(event);
      if (wake) {
        const resume = wake;
        wake = null;
        resume();
      }
    };
    const release = (): void => {
      finished = true;
      if (wake) {
        const resume = wake;
        wake = null;
        resume();
      }
    };

    let text = '';
    let cards: CardMessage[] = [];
    let usage: ChatResponseDto['usage'];
    const toolsCalled: string[] = [];

    const running = (async () => {
      try {
        if (intentRoute.requiresSelection && submission?.cardType !== 'assistant_intent') {
          const card = buildIntentSelectionCard(intentRoute, role);
          cards = [card];
          text =
            intentRoute.candidates.length > 0
              ? '这个请求可能对应多个助手，请先确认要进入哪一个。'
              : '当前描述还不足以确定助手，请选择一个方向。选择后会在同一会话中保留已有草稿。';
          this.metrics.increment('chat_requests_total', { outcome: 'success' });
          push({ type: 'card', card });
          return;
        }
        // 场景一旦可由封闭规则命中，首轮先返回确定性参数卡。
        // 不允许模型在用户尚未选择参与方/数据产品时先猜用途并发起合约查询。
        const scenarioHit =
          !submission && !session.scenarioDraft && intentRoute.primary === 'access-contract'
            ? bestScenario(message)?.scenario
            : undefined;
        if (scenarioHit) {
          const card = buildScenarioFormCard({
            scenarioId: scenarioHit.id,
            ctx: {
              spaceId,
              userId: identity.userId,
              directory,
              defaults,
            },
          });
          if (card) {
            draft = buildScenarioDraft(scenarioHit, intentRoute.primary, {});
            await this.sessions.setScenarioDraft(session.id, draft);
            text = `${scenarioHit.title}适合这个需求。请先填写参与方、数据产品和场景参数；合约会在参数确认后按逐数据源依赖检查。`;
            cards = [card];
            await withSpan(
              'chat.turn',
              {
                'chat.space_id': spaceId,
                'chat.session_id': session.id,
                'chat.user_ref': pseudonymize(identity.userId) ?? 'anonymous',
                'chat.context_window': this.config.contextMaxMessages,
                'llm.mode': this.config.llmMode,
                'chat.outcome': 'success',
                'chat.cards': 1,
                'chat.tools': 0,
              },
              async () => undefined,
            );
            this.metrics.increment('chat_requests_total', { outcome: 'success' });
            push({ type: 'card', card });
            return;
          }
        }
        const { agent } = createMedTrustAgent({
          config: this.config,
          spaceId,
          userId: identity.userId,
          directory,
          defaults,
          apiClient: this.api,
          assistantIntent: intentRoute.primary,
          ...(draft ? { draft } : {}),
          ...(role ? { role } : {}),
        });
        agent.setHooks({
          onToolStart: (call) => {
            push({ type: 'tool', phase: 'start', name: call.name });
          },
          // async：合规动作的审计要在这里落到控制面审计链（runHook 会 await 它，
          // 且钩子抛错不影响对话——观察者不是主流程）。
          onToolEnd: async (event) => {
            const scenario = findScenarioByToolName(event.call.name)?.id ?? 'other';
            this.metrics.increment('tool_calls_total', {
              tool: event.call.name,
              scenario,
              outcome: event.ok ? 'success' : 'error',
            });
            const compliance = complianceAudit(event.call.name, scenario, event.result, session.id);
            if (compliance) {
              compliance.entry.details = {
                ...(compliance.entry.details ?? {}),
                assistantIntent: intentRoute.primary,
                routingReason: intentRoute.reason,
                llmProvider: this.config.llmMode,
                llmModel: this.config.llmModelEffective,
                humanConfirmation:
                  event.call.name === 'request_contract' ||
                  event.call.name.startsWith('submit_')
                    ? 'user-submitted-card'
                    : 'not-required',
              };
              // 5.2 指标：按判定分类（拦下来的原因分得开，才能看出是权限问题还是合约问题）
              this.metrics.increment('compliance_decisions_total', {
                verdict: compliance.verdict,
                scenario: compliance.scenario,
              });
              // 5.2 指标：合约创建成功率（自动推进路径分项）
              if (compliance.action === 'contract_request' && compliance.autoOffer) {
                this.metrics.increment('contract_auto_offer_total', {
                  result: compliance.autoOffer,
                });
              }
              // 5.2 指标：任务提交成功率（按是否关联合约分类）
              if (compliance.action === 'job_submit') {
                this.metrics.increment('job_submissions_total', {
                  outcome: event.ok ? 'submitted' : 'blocked',
                  contract: compliance.contractId ? 'linked' : 'unlinked',
                });
              }
              // 5.1 审计：只记可对账的标识与判定，**不记**用户原话与载荷取值
              this.logger.log({
                event: 'compliance_audit',
                ...compliance,
                spaceId,
                sessionId: session.id,
                userRef: pseudonymize(identity.userId),
              });
              // 5.1 审计链：把这条动作写进**控制面**的审计日志（SM3 链 + 按时间段导出）。
              // 这里**等**它写完：动作已经发生，记录就该在回话之前落地；
              // 写入失败只告警并计指标，不把用户的动作变成失败（强制点在控制面）。
              await this.writeAudit(compliance.entry, identity, spaceId);
            }
            if (draft) {
              const data =
                event.result?.data &&
                typeof event.result.data === 'object' &&
                !Array.isArray(event.result.data)
                  ? (event.result.data as Record<string, unknown>)
                  : {};
              const complianceData =
                data.compliance &&
                typeof data.compliance === 'object' &&
                !Array.isArray(data.compliance)
                  ? (data.compliance as Record<string, unknown>)
                  : {};
              const bundle =
                data.contractBundle &&
                typeof data.contractBundle === 'object' &&
                !Array.isArray(data.contractBundle)
                  ? (data.contractBundle as Record<string, unknown>)
                  : undefined;
              const submitTool = event.call.name.startsWith('submit_');
              const checkTool = event.call.name === 'check_contract_status';
              if (submitTool || checkTool) {
                const gateStatus =
                  event.call.name === 'check_contract_status'
                    ? String(data.status ?? 'unknown')
                    : String(complianceData.status ?? (event.ok ? 'ready' : 'failed'));
                const status: ScenarioDraft['status'] = event.ok
                  ? submitTool
                    ? 'submitted'
                    : gateStatus === 'usable'
                      ? 'ready'
                      : 'checking'
                  : gateStatus === 'missing'
                    ? 'needs_contract'
                    : gateStatus === 'not-usable'
                      ? 'needs_contract'
                      : 'failed';
                draft = updateScenarioDraftStatus(draft, {
                  status,
                  ...(bundle
                    ? {
                        contractBundle: {
                          status:
                            gateStatus === 'usable'
                              ? 'ready'
                              : gateStatus === 'missing'
                                ? 'needs_contract'
                                : 'unknown',
                          contractIds: Array.isArray(complianceData.contractIds)
                            ? complianceData.contractIds.filter(
                                (id): id is string => typeof id === 'string',
                              )
                            : [],
                          ...(typeof bundle.bundleId === 'string'
                            ? { bundleId: bundle.bundleId }
                            : {}),
                          ...(typeof bundle.version === 'string'
                            ? { bundleVersion: bundle.version }
                            : {}),
                          updatedAt: new Date().toISOString(),
                        },
                      }
                    : {}),
                });
                await this.sessions.setScenarioDraft(session.id, draft);
              }
            }
            toolsCalled.push(event.call.name);
            push({
              type: 'tool',
              phase: 'end',
              name: event.call.name,
              ok: event.ok,
              durationMs: event.durationMs,
            });
          },
        });
        agent.setContext({
          userId: identity.userId,
          spaceId,
          sessionId: session.id,
          ...(identity.accessToken ? { accessToken: identity.accessToken } : {}),
          directory,
          defaults,
          assistantIntent: intentRoute.primary,
          ...(draft ? { draft } : {}),
          ...(draft?.scenarioId && findScenario(draft.scenarioId)
            ? { scenario: findScenario(draft.scenarioId) }
            : {}),
        });

        // 一次对话 = 一个 span；工具 span / 控制面 span 会作为子 span 挂上来。
        // 属性里只有空间、场景、计数与假名——没有用户原话（trace 后端保留久、权限松）。
        await withSpan(
          'chat.turn',
          {
            'chat.space_id': spaceId,
            'chat.session_id': session.id,
            'chat.user_ref': pseudonymize(identity.userId) ?? 'anonymous',
            'chat.context_window': this.config.contextMaxMessages,
            'llm.mode': this.config.llmMode,
          },
          // 结果属性必须在**回调内部**设置：span 一旦结束，`trace.getSpan(context.active())`
          // 就取不到了（第一版把 annotateSpan 放在 withSpan 之后，属性静默丢失）。
          async (span) => {
            try {
              const response = await agent.chat(agentMessage, this.toLlmMessages(history));
              const extracted = extractCardMessages(response.content);
              text = extracted.text || response.content;
              cards = extracted.cards;
              const formCard = cards.find(
                (card) => card.type === 'form' && typeof card.scenario === 'string',
              );
              const selectedScenario = formCard?.scenario
                ? findScenario(formCard.scenario)
                : undefined;
              if (selectedScenario) {
                const defaultsFromCard = Object.fromEntries(
                  (formCard?.fields ?? [])
                    .filter((field) => field.defaultValue !== undefined)
                    .map((field) => [field.name, field.defaultValue]),
                );
                draft = buildScenarioDraft(
                  selectedScenario,
                  intentRoute.primary,
                  { ...(draft?.values ?? {}), ...defaultsFromCard },
                );
                await this.sessions.setScenarioDraft(session.id, draft);
              }
              usage = response.usage;
              if (extracted.invalid.length > 0) {
                this.logger.warn(`丢弃 ${extracted.invalid.length} 张结构非法的卡片`);
              }
              span?.setAttribute('chat.outcome', 'success');
              span?.setAttribute('chat.cards', cards.length);
              span?.setAttribute('chat.tools', toolsCalled.length);
              return response;
            } catch (error) {
              // 标错并向上抛：withSpan 会把 span 置为 error 并记录异常类型
              span?.setAttribute('chat.outcome', 'error');
              throw error;
            }
          },
        );
        if (usage) {
          this.metrics.increment('llm_tokens_total', { direction: 'input' }, usage.inputTokens);
          this.metrics.increment('llm_tokens_total', { direction: 'output' }, usage.outputTokens);
        }
        this.metrics.increment('chat_requests_total', { outcome: 'success' });
        for (const card of cards) push({ type: 'card', card });
      } catch (error) {
        const detail = error instanceof Error ? error.message : '未知错误';
        this.logger.error(`对话失败：${detail}`);
        this.metrics.increment('chat_requests_total', { outcome: 'error' });
        const card = buildErrorCard('助手暂时不可用', '对话处理失败，请稍后重试。', [
          '如果问题持续，请联系空间管理员检查 LLM 配置。',
        ]);
        text = '对话处理失败，请稍后重试。';
        cards = [card];
        push({ type: 'card', card });
      } finally {
        release();
      }
    })();

    while (!finished || queue.length > 0) {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) yield next;
      }
      if (finished) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    await running;

    const durationSeconds = (Date.now() - startedAt) / 1000;
    this.metrics.observe('chat_duration_seconds', durationSeconds);

    const assistant = await this.sessions.appendMessage(session.id, {
      role: 'assistant',
      content: text,
      cards,
    });

    // 结构化日志（4.2.1 / 4.3.3）：**只有**可对账的计数与标识，没有用户原话、没有令牌。
    this.logger.log({
      event: 'chat_completed',
      sessionId: session.id,
      spaceId,
      userRef: pseudonymize(identity.userId),
      durationMs: Math.round(durationSeconds * 1000),
      contextWindow: this.config.contextMaxMessages,
      cards: cards.length,
      tools: toolsCalled.length,
      ...(usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : {}),
    });

    const suggestions = this.suggest(cards, spaceId);
    const response: ChatResponseDto = {
      sessionId: session.id,
      message: assistant as ChatMessage,
      cards,
      suggestions,
      ...(usage ? { usage } : {}),
      assistantIntent: intentRoute.primary,
      ...(draft ? { draft } : {}),
    };
    yield { type: 'done', response, suggestions };
  }

  async listSessions(identity: ChatIdentity, spaceId?: string): Promise<ChatSession[]> {
    const sessions = await this.sessions.list(identity.userId, spaceId || identity.spaceId);
    return sessions.map((session) => ({ ...session, messages: [] }));
  }

  async getSession(id: string, identity: ChatIdentity): Promise<ChatSession> {
    const session = await this.sessions.get(id);
    if (!session) throw new NotFoundException('会话不存在或已过期');
    if (session.userId !== identity.userId) throw new ForbiddenException('无权访问该会话');
    return session;
  }

  async deleteSession(id: string, identity: ChatIdentity): Promise<{ success: boolean }> {
    const session = await this.sessions.get(id);
    if (!session) return { success: true };
    if (session.userId !== identity.userId) throw new ForbiddenException('无权删除该会话');
    await this.sessions.delete(id, identity.userId);
    return { success: true };
  }

  private async resolveSession(
    sessionId: string | undefined,
    identity: ChatIdentity,
    spaceId: string,
  ): Promise<ChatSession> {
    if (sessionId) {
      const existing = await this.sessions.get(sessionId);
      if (existing && existing.userId === identity.userId) return existing;
    }
    return this.sessions.create(identity.userId, spaceId);
  }

  /**
   * 把合规动作写进控制面的审计日志（`POST /audit`）。
   *
   * 用**调用者** token 落条目：审计的意义是"这是谁的动作"（控制面按 JWT 归属用户与租户），
   * 借 agent 自有凭证写进去归属就错了。
   *
   * 失败策略：告警 + 指标，**不让用户的动作失败**。审计是记录、不是闸门；
   * 反过来说，静默失败也是不可接受的（会让"审计覆盖率 100%"变成假绿），所以必须有指标。
   */
  private async writeAudit(
    entry: AuditEntryInput,
    identity: ChatIdentity,
    spaceId: string,
  ): Promise<void> {
    if (!identity.accessToken) {
      this.metrics.increment('compliance_audit_write_total', { outcome: 'skipped_no_token' });
      return;
    }
    try {
      await this.api.recordAudit(entry, {
        userId: identity.userId,
        spaceId,
        token: identity.accessToken,
      });
      this.metrics.increment('compliance_audit_write_total', { outcome: 'written' });
    } catch (error) {
      this.metrics.increment('compliance_audit_write_total', { outcome: 'failed' });
      this.logger.warn(
        `审计写入失败（动作已完成，记录缺失）：${error instanceof Error ? error.message : '未知错误'}`,
      );
    }
  }

  /**
   * 读目录（4.1.2）：先查缓存，未命中再打控制面并写回。
   *
   * 目录是元数据、变化慢，而每次对话都要读一次——缓存把它从"每轮一次往返"
   * 降到"每 TTL 一次"。未配置 Redis 时缓存恒不命中，语义与之前完全一致。
   */
  private async loadDirectory(spaceId: string): Promise<SpaceDirectory> {
    const cached = await this.directoryCache.get(spaceId);
    if (cached) return cached;

    try {
      const directory = await this.api.listDirectory(spaceId);
      await this.directoryCache.set(spaceId, directory);
      return directory;
    } catch (error) {
      this.logger.warn(
        `目录加载失败，退化为空目录：${error instanceof Error ? error.message : '未知错误'}`,
      );
      return EMPTY_DIRECTORY;
    }
  }

  /**
   * 路由角色从控制面重新读取；x-user-role 只作为无 token 时的展示提示。
   * 即使前端伪造 role，也只是路由候选变化，工具与控制面权限仍由真实身份判定。
   */
  private async resolveRole(identity: ChatIdentity): Promise<string | undefined> {
    if (!identity.accessToken) return identity.role;
    try {
      const mine = await this.api.listMySpaces(identity.accessToken);
      return (
        mine.memberships.find((membership) => membership.spaceId === identity.spaceId)?.role ??
        identity.role
      );
    } catch {
      return identity.role;
    }
  }

  private buildDefaults(identity: ChatIdentity, spaceId: string): ScenarioDefaults {
    const now = new Date();
    return {
      purpose: PURPOSE,
      applicant: { org: identity.userId, project: spaceId },
      contracts: this.config.defaultContracts,
      notBefore: now.toISOString(),
      notAfter: new Date(now.getTime() + this.config.defaultWindowDays * 86_400_000).toISOString(),
      minCell: this.config.defaultMinCell,
      teeNode: `urn:tds:${spaceId}:participant:tee-node-a`,
    };
  }

  /** 滑动窗口：只把最近 N 条历史送进模型（4.1.4 / Token 控制）。 */
  private toLlmMessages(messages: ChatMessage[]): LLMMessage[] {
    return contextWindow(messages, this.config.contextMaxMessages).map((message) => ({
      role: message.role,
      content: message.cards?.length
        ? [message.content, ...message.cards.map(renderCardFence)].filter(Boolean).join('\n')
        : message.content,
    }));
  }

  private suggest(cards: CardMessage[], spaceId?: string): string[] {
    const submitted = cards.find(
      (card) => card.type === 'status' && card.data && 'jobId' in card.data,
    );
    if (submitted) return ['去任务列表查看执行状态', '再配置一个任务'];

    const form = cards.find((card) => card.type === 'form');
    if (form) return ['按提示填写后提交', '想换场景可以直接说'];

    const approval = cards.find((card) => card.type === 'contract_approval');
    if (approval) return ['同意并提交合约申请', '换一个已有合约的场景'];

    const request = cards.find((card) => card.type === 'contract_request');
    if (request) return ['先去「合规预审」页创建组合', '联系空间管理员协助签发合约'];

    const packs = inferPacksFromSpaceId(spaceId);
    const starters = startersForPacks(packs);
    const list = cards.find((card) => card.type === 'result');
    if (list) return ['说说你的数据和目标', ...(starters.slice(0, 1))];

    return starters.slice(0, 3);
  }
}
