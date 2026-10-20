import type { LLMClient, LLMMessage, LLMResponse, Tool } from '@medtrust/pi-agent';
import { isCardMessage, parseCardSubmission, type CardMessage } from '@medtrust/chat-cards';
import { bestScenario, matchScenarios } from '../scenario-matcher';
import { findScenario, type ScenarioBuildContext } from '../scenarios';
import { registrationToolFromValues } from '../tools/registration.tools';
import {
  buildErrorCard,
  buildResultCard,
  buildScenarioFormCard,
  buildScenarioListCard,
  buildStatusCard,
  renderCardFence,
} from '../../cards/card-builder';

const LIST_PARTICIPANTS_TOOL = 'list_participants';

export interface RuleBasedClientOptions {
  ctx: ScenarioBuildContext;
  assistantIntent?: string;
}

interface ToolEnvelope {
  success?: boolean;
  data?: unknown;
  error?: string;
}

/**
 * 确定性回退 LLM 客户端（无外部供应商）。
 *
 * 不是「假数据」：它复用了同一套场景表、同一套卡片构造、同一套工具调用协议，
 * 因此无 key 也能端到端跑通「识别 → 出卡 → 提交 → 回报」。
 * 有 key 时换 AnthropicClient，提示词与工具协议不变。
 */
export class RuleBasedLlmClient implements LLMClient {
  constructor(private readonly options: RuleBasedClientOptions) {}

  async complete(messages: LLMMessage[], tools: Tool[]): Promise<LLMResponse> {
    const last = messages[messages.length - 1];

    // 1) 工具刚执行完 → 回报结果
    if (last?.role === 'tool') {
      const envelope = this.parseEnvelope(last.content);

      // 1a) 工具自带卡（合规闸的判定卡、合约申请回执）→ **原样**输出。
      // 卡片内容由工具按事实生成，模型不参与创作；无 key 也能把合规流程走完整。
      const toolCard = this.toolCard(envelope);
      if (toolCard) {
        const lead =
          envelope?.success === false
            ? envelope.error ?? '这一步没有通过，按卡片里的说明继续。'
            : '已按当前状况生成下一步。';
        return { content: `${lead}\n${renderCardFence(toolCard)}` };
      }

      if (envelope?.success) {
        const data = (envelope.data ?? {}) as Record<string, unknown>;
        const jobId = typeof data.jobId === 'string' ? data.jobId : undefined;
        const title = typeof data.title === 'string' ? data.title : undefined;
        const card = buildStatusCard(
          `任务已提交${title ? `：${title}` : ''}`,
          'success',
          {
            ...(jobId ? { jobId } : {}),
            status: String(data.status ?? 'submitted'),
            ...(data.template ? { template: String(data.template) } : {}),
            ...(data.stages !== undefined ? { stages: String(data.stages) } : {}),
            // 这次作业用的哪份授权要看得见（合规集成：任务与合约在用户眼前对齐）
            ...(typeof data.contractId === 'string' && data.contractId
              ? { contractId: data.contractId }
              : {}),
          },
        );
        return {
          content: `任务已提交${jobId ? `，任务 ID：${jobId}` : ''}。\n${renderCardFence(card)}`,
        };
      }
      const failure = (envelope?.data ?? {}) as Record<string, unknown>;
      const failedScenarioId = typeof failure.scenario === 'string' ? failure.scenario : undefined;
      const failedValues =
        typeof failure.values === 'object' && failure.values !== null
          ? (failure.values as Record<string, unknown>)
          : undefined;

      const card = buildErrorCard('提交失败', envelope?.error ?? '工具执行失败，请稍后重试。', [
        failedScenarioId ? '已按你填过的值重新出卡，改完直接提交。' : '修改参数后重新提交。',
      ]);

      // 错误恢复（tasks 3.4.3）：能定位到场景就把填过的值放回卡片，
      // 而不是让用户从头再描述一遍需求。
      const retryCard =
        failedScenarioId && failedValues
          ? buildScenarioFormCard({
              scenarioId: failedScenarioId,
              ctx: this.options.ctx,
              title: '修改后重新提交',
              defaultValues: failedValues,
            })
          : null;

      const fences = [card, ...(retryCard ? [retryCard] : [])].map(renderCardFence).join('\n');
      return { content: `提交没有成功。\n${fences}` };
    }

    // 2) 表单提交信封 → 调 submit 工具
    const submission = parseCardSubmission(last?.content ?? '');
    if (submission) {
      const nextRegistrationTool = registrationToolFromValues(submission.values);
      if (nextRegistrationTool) {
        const hasTool = tools.some((tool) => tool.name === nextRegistrationTool);
        if (!hasTool) {
          return {
            content: renderCardFence(
              buildErrorCard(
                '注册研究流程暂不可用',
                `工具 ${nextRegistrationTool} 未注册。`,
              ),
            ),
          };
        }
        return {
          content: '正在执行已确认的注册研究步骤…',
          toolCalls: [
            {
              id: `call-${nextRegistrationTool}-${Date.now()}`,
              name: nextRegistrationTool,
              parameters:
                nextRegistrationTool === 'get_registration_job'
                  ? { jobId: String(submission.values.jobId ?? '') }
                  : nextRegistrationTool === 'download_registration_report'
                    ? {
                        jobId: String(submission.values.jobId ?? ''),
                        syntheticOnly: submission.values.syntheticOnly === true,
                      }
                    : nextRegistrationTool === 'build_registration_report'
                      ? {
                          jobId: String(submission.values.jobId ?? ''),
                          reportInput:
                            typeof submission.values.reportInput === 'object' &&
                            submission.values.reportInput !== null
                              ? submission.values.reportInput
                              : {},
                        }
                      : { values: submission.values },
            },
          ],
        };
      }

      // 2a) 合约申请卡 → request_contract（卡片值即工具入参，一路不加工）
      if (
        submission.cardType === 'contract_approval' ||
        submission.cardType === 'contract_apply' ||
        submission.cardType === 'contract_bundle'
      ) {
        const prepare = submission.values.action === 'prepare_contract_apply';
        const toolName = prepare ? 'prepare_contract_apply' : 'request_contract';
        const hasTool = tools.some((tool) => tool.name === toolName);
        if (!hasTool) {
          const card = buildErrorCard('合约申请暂不可用', '本实例没有注册合约申请工具。');
          return { content: renderCardFence(card) };
        }
        return {
          content: prepare ? '好的，正在准备合约申请单…' : '好的，正在提交合约申请…',
          toolCalls: [
            {
              id: `call-contract-${Date.now()}`,
              name: toolName,
              parameters: prepare ? submission.values : { values: submission.values },
            },
          ],
        };
      }

      const scenario = findScenario(submission.scenario ?? '');
      if (!scenario) {
        const card = buildErrorCard('无法识别场景', '这张卡片没有场景标识，请重新描述需求。');
        return { content: renderCardFence(card) };
      }
      if (
        scenario.id === 'external-control-registration' &&
        submission.cardType === 'form'
      ) {
        const hasTool = tools.some(
          (tool) => tool.name === 'validate_registration_profile',
        );
        if (!hasTool) {
          return {
            content: renderCardFence(
              buildErrorCard(
                '注册研究流程暂不可用',
                'validate_registration_profile 工具未注册。',
              ),
            ),
          };
        }
        return {
          content: '正在校验注册研究 profile 与 P0/SAP…',
          toolCalls: [
            {
              id: `call-validate-registration-${Date.now()}`,
              name: 'validate_registration_profile',
              parameters: { values: submission.values },
            },
          ],
        };
      }
      const hasTool = tools.some((tool) => tool.name === scenario.toolName);
      if (!hasTool) {
        const card = buildErrorCard('场景暂未开放', `${scenario.title} 的提交工具未注册。`);
        return { content: renderCardFence(card) };
      }
      return {
        content: `好的，正在提交「${scenario.title}」…`,
        toolCalls: [
          {
            id: `call-${scenario.id}-${Date.now()}`,
            name: scenario.toolName,
            parameters: { values: submission.values },
          },
        ],
      };
    }

    // 3) 自然语言 → 场景识别
    const userText = this.lastUserText(messages);
    const latestJobId = this.latestRegistrationJobId(messages);
    if (latestJobId) {
      if (/状态|进度|执行到哪|查询.*作业/.test(userText)) {
        const tool = tools.find((candidate) => candidate.name === 'get_registration_job');
        if (tool) {
          return {
            content: '正在从控制面查询注册研究作业状态…',
            toolCalls: [
              {
                id: `call-registration-status-${Date.now()}`,
                name: tool.name,
                parameters: { jobId: latestJobId },
              },
            ],
          };
        }
      }
      if (/生成.*报告|构建.*报告|报告.*生成/.test(userText)) {
        const tool = tools.find(
          (candidate) => candidate.name === 'build_registration_report',
        );
        if (tool) {
          return {
            content: '正在由控制面从作业证据构建注册研究报告…',
            toolCalls: [
              {
                id: `call-registration-report-${Date.now()}`,
                name: tool.name,
                parameters: { jobId: latestJobId, reportInput: {} },
              },
            ],
          };
        }
      }
      if (/下载.*报告|下载.*证据包|报告.*下载/.test(userText)) {
        const tool = tools.find(
          (candidate) => candidate.name === 'download_registration_report',
        );
        if (tool) {
          return {
            content: '正在生成注册研究报告下载卡…',
            toolCalls: [
              {
                id: `call-registration-download-${Date.now()}`,
                name: tool.name,
                parameters: {
                  jobId: latestJobId,
                  syntheticOnly: /模拟|合成/.test(userText),
                },
              },
            ],
          };
        }
      }
    }
    const match = bestScenario(userText);

    if (match) {
      if (match.scenario.id === 'external-control-registration') {
        const tool = tools.find((candidate) => candidate.name === 'draft_registration_study');
        if (tool) {
          return {
            content: '正在创建注册研究草稿卡…',
            toolCalls: [
              {
                id: `call-draft-registration-${Date.now()}`,
                name: tool.name,
                parameters: { values: {} },
              },
            ],
          };
        }
      }
      const card = buildScenarioFormCard({
        scenarioId: match.scenario.id,
        ctx: this.options.ctx,
      });
      if (card) {
        const response = `好的，${match.scenario.title} 适合这个需求。${this.directoryHint()}\n${renderCardFence(card)}`;
        return { content: response };
      }
    }

    // 3b) 有候选但不唯一 → 列候选，让用户选（不猜）
    const candidates = matchScenarios(userText, 3);
    if (candidates.length > 1) {
      const card = buildResultCard(
        '这几个场景可能都合适',
        Object.fromEntries(
          candidates.map((candidate) => [candidate.scenario.title, candidate.scenario.description]),
        ),
      );
      return {
        content: `我识别到多个可能合适的场景，请告诉我要用哪一个（或直接说出场景名）。\n${renderCardFence(card)}`,
      };
    }

    // 4) 兜底：列场景
    const card = buildScenarioListCard();
    return {
      content: `我可以帮你配置这些计算场景。用一句话描述你的数据与目标即可。\n${renderCardFence(card)}`,
    };
  }

  private directoryHint(): string {
    const { participants, dataProducts } = this.options.ctx.directory;
    if (participants.length === 0 && dataProducts.length === 0) return '';
    return `（已从目录载入 ${participants.length} 个参与方、${dataProducts.length} 个数据产品）`;
  }

  private lastUserText(messages: LLMMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role !== 'user') continue;
      const submission = parseCardSubmission(message.content);
      if (submission) continue;
      return message.content;
    }
    return '';
  }

  private parseEnvelope(content: string): ToolEnvelope | null {
    try {
      const parsed = JSON.parse(content) as ToolEnvelope;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return null;
    }
    return null;
  }

  private latestRegistrationJobId(messages: LLMMessage[]): string | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== 'tool') continue;
      const envelope = this.parseEnvelope(message.content);
      const data = (envelope?.data ?? {}) as Record<string, unknown>;
      const direct = data.jobId;
      if (typeof direct === 'string' && direct.trim()) return direct;
      const job = data.job;
      if (
        typeof job === 'object' &&
        job !== null &&
        typeof (job as { jobId?: unknown }).jobId === 'string'
      )
        return String((job as { jobId: string }).jobId);
      const report = data.report;
      if (
        typeof report === 'object' &&
        report !== null &&
        typeof (report as { jobId?: unknown }).jobId === 'string'
      )
        return String((report as { jobId: string }).jobId);
    }
    return null;
  }

  /** 工具结果里的 `data.card`（结构非法就当没有，别把坏卡发给前端）。 */
  private toolCard(envelope: ToolEnvelope | null): CardMessage | null {
    const data = envelope?.data;
    if (typeof data !== 'object' || data === null) return null;
    const card = (data as { card?: unknown }).card;
    return isCardMessage(card) ? (card as CardMessage) : null;
  }
}

export { LIST_PARTICIPANTS_TOOL };
