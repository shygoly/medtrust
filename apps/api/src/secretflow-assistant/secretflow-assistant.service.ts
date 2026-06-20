import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import * as yaml from 'js-yaml';
import {
  SecretFlowTaskSpec,
  isSecretFlowTaskSpec,
} from '../compute-task/dto/secretflow-task-spec';
import { draftSchema } from './secretflow-spec.schema';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt';

export interface SecretFlowDraftResult {
  spec: SecretFlowTaskSpec;
  /** YAML rendering of `spec`, ready to feed the existing /secretflow/preview + /tasks flow. */
  yaml: string;
  rationale: Record<string, string | undefined>;
  warnings: string[];
  assumptions: string[];
}

/**
 * LLM task-design assistant for SecretFlow orchestration.
 *
 * Decoupled from the execution layer: it only produces a draft spec. Provider
 * is DeepSeek via its OpenAI-compatible API (`openai` SDK pointed at
 * DEEPSEEK_BASE_URL). The draft is validated against secretFlowSpecSchema and
 * the existing isSecretFlowTaskSpec() guard before it is returned.
 */
@Injectable()
export class SecretFlowAssistantService {
  private readonly logger = new Logger(SecretFlowAssistantService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('DEEPSEEK_API_KEY');
    const baseURL =
      this.config.get<string>('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com';
    this.model = this.config.get<string>('DEEPSEEK_MODEL') || 'deepseek-v4-pro';
    this.client = apiKey ? new OpenAI({ apiKey, baseURL }) : null;
    if (!this.client) {
      this.logger.warn(
        'DEEPSEEK_API_KEY 未配置，/secretflow/assistant/draft 将返回 503。',
      );
    }
  }

  async draft(description: string, purpose?: string): Promise<SecretFlowDraftResult> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'LLM 任务设计助手未配置：缺少 DEEPSEEK_API_KEY',
      );
    }

    let content: string;
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(description, purpose) },
        ],
      });
      content = completion.choices[0]?.message?.content ?? '';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`DeepSeek 调用失败: ${message}`);
      throw new ServiceUnavailableException('LLM 助手调用失败，请稍后重试');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new UnprocessableEntityException(
        'LLM 返回的内容不是合法 JSON，请把研究意图描述得更具体后重试',
      );
    }

    const result = draftSchema.safeParse(parsed);
    if (!result.success) {
      this.logger.warn(`草稿不符合 schema: ${result.error.message}`);
      throw new UnprocessableEntityException(
        '生成的配置不完整，请补充研究目的、数据类型与参与医院后重试',
      );
    }

    const draft = result.data;
    // Belt-and-suspenders: reuse the orchestrator's own runtime guard.
    if (!isSecretFlowTaskSpec(draft.spec)) {
      throw new UnprocessableEntityException(
        '生成的 SecretFlow 声明未通过校验，请补充描述后重试',
      );
    }

    return {
      spec: draft.spec as SecretFlowTaskSpec,
      yaml: yaml.dump(draft.spec, { lineWidth: 100 }),
      rationale: draft.rationale,
      warnings: draft.warnings,
      assumptions: draft.assumptions,
    };
  }
}
