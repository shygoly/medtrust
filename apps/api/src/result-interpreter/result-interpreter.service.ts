import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import { parseStandardWeights } from "./standardization";
import {
  buildC3Facts,
  c3ResultSchema,
  contradictedVerdicts,
  unsupportedNumbers,
} from "./c3-facts";

export interface InterpretationResult {
  /** 模型生成的解读草稿（已通过数字回查）。 */
  draft: string;
  /** 送给模型的事实清单（确定性计算，可与草稿逐条对照）。 */
  facts: string[];
  vendor: string;
  model: string;
  label: string;
  generatedAt: string;
}

export const DRAFT_LABEL = "模型生成的草稿，待研究者确认";

const SYSTEM_PROMPT = `你是医学研究助手。下面是一次多中心联合分析已发布的聚合结果「事实清单」（合成数据）。
请用 2 到 3 句中文写一段谨慎的解读，面向临床研究者。
规则：
- 只能引用事实清单里原样出现的数字，不得计算或写出任何新数字；
- 不得改变清单给出的方向与结论，不得下因果结论；
- 提醒这是粗结果、需要进一步研究确认；
- 只输出一段话，不要标题、不要列表、不要编号。`;

/**
 * C3 结果解读（AGT-04）：把已发布的聚合结果转成研究性文字草稿。
 *
 * 推理端点是**自托管**的 OpenAI 兼容服务（OpenVINO Model Server，经隧道访问），
 * 不出控制面信任边界（DECISIONS D-AI-2；FLOW-AI-04 `crosses: none`）。
 * 端点不可用即 503——**不回落到任何外部供应商**，聚合结果不得越过 CTL-11 的出域闸。
 */
@Injectable()
export class ResultInterpreterService {
  private readonly logger = new Logger(ResultInterpreterService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;
  private readonly vendor: string;
  private readonly extraBody: Record<string, unknown>;

  constructor(private readonly config: ConfigService) {
    const baseURL = this.config.get<string>("RESULT_INTERPRETER_LLM_BASE_URL");
    this.model = this.config.get<string>("RESULT_INTERPRETER_LLM_MODEL") ?? "";
    this.vendor =
      this.config.get<string>("RESULT_INTERPRETER_LLM_VENDOR") ?? "self-hosted";
    this.extraBody = parseExtraBody(
      this.config.get<string>("RESULT_INTERPRETER_LLM_EXTRA_BODY"),
    );
    this.client =
      baseURL && this.model
        ? new OpenAI({
            baseURL,
            // 自托管端点不鉴权；SDK 要求非空字符串
            apiKey:
              this.config.get<string>("RESULT_INTERPRETER_LLM_API_KEY") ||
              "none",
            timeout: 120_000,
            maxRetries: 0,
          })
        : null;
    if (!this.client) {
      this.logger.warn(
        "RESULT_INTERPRETER_LLM_BASE_URL / _MODEL 未配置，/result-interpreter/interpret 将返回 503。",
      );
    }
  }

  async interpret(
    question: string,
    rawResult: unknown,
  ): Promise<InterpretationResult> {
    // 先验入参再看端点：非 C3 载荷在任何情况下都不该走到模型
    const parsed = c3ResultSchema.safeParse(rawResult);
    if (!parsed.success) {
      throw new BadRequestException(
        "只接受已发布的聚合结果（C3）字段，请求含未知或非聚合字段",
      );
    }
    if (!this.client) {
      throw new ServiceUnavailableException(
        "结果解读未配置：缺少自托管推理端点",
      );
    }

    // 直接标准化率的标准人口权重是**部署参数**（不进节点）；未配置就不出现这一行。
    const standardWeights = parseStandardWeights(
      this.config.get<string>("DEDUP_STANDARD_WEIGHTS"),
    );
    const facts = buildC3Facts(parsed.data, { standardWeights });
    const userPrompt = `研究问题：${question.trim()}\n\n事实清单：\n${facts.map((f) => `- ${f}`).join("\n")}`;

    let content: string;
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        max_tokens: 300,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        ...this.extraBody,
      });
      content = completion.choices[0]?.message?.content ?? "";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`推理端点调用失败（${this.vendor}）: ${message}`);
      throw new ServiceUnavailableException("结果解读服务暂不可用，请稍后重试");
    }

    const draft = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!draft) {
      throw new UnprocessableEntityException("模型未返回解读内容，请重试");
    }
    const unverified = unsupportedNumbers(draft, userPrompt);
    if (unverified.length > 0) {
      this.logger.warn(
        `解读含未经核实的数字，已拒绝：${unverified.join(", ")}`,
      );
      throw new UnprocessableEntityException(
        "模型输出含事实清单之外的数字，已拒绝展示，请重试",
      );
    }
    const contradictions = contradictedVerdicts(draft, parsed.data);
    if (contradictions.length > 0) {
      this.logger.warn(
        `解读与结论不一致，已拒绝：${contradictions.join("；")}`,
      );
      throw new UnprocessableEntityException(
        "模型输出与事实清单的结论不一致，已拒绝展示，请重试",
      );
    }

    return {
      draft,
      facts,
      vendor: this.vendor,
      model: this.model,
      label: DRAFT_LABEL,
      generatedAt: new Date().toISOString(),
    };
  }
}

function parseExtraBody(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("RESULT_INTERPRETER_LLM_EXTRA_BODY 必须是 JSON 对象");
  return parsed as Record<string, unknown>;
}
