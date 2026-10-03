import {
  BadRequestException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { buildC3Facts, unsupportedNumbers } from "./c3-facts";
import {
  DRAFT_LABEL,
  ResultInterpreterService,
} from "./result-interpreter.service";

const PAIRED = {
  analysisType: "paired-cohort",
  cohortSize: 4420,
  exposed: 1240,
  outcome: 179,
  exposedWithOutcome: 37,
};

const ENV: Record<string, string> = {
  RESULT_INTERPRETER_LLM_BASE_URL: "http://127.0.0.1:18000/v3",
  RESULT_INTERPRETER_LLM_MODEL: "qwen3-1.7b",
};

function makeService(
  create: jest.Mock | null,
  env: Record<string, string> = ENV,
): ResultInterpreterService {
  const config = {
    get: jest.fn((key: string) => env[key]),
  } as unknown as ConfigService;
  const service = new ResultInterpreterService(config);
  if (create) {
    // Stub the OpenAI-compatible client (no network).
    (service as unknown as { client: unknown }).client = {
      chat: { completions: { create } },
    };
  }
  return service;
}

function replyWith(content: string): jest.Mock {
  return jest.fn().mockResolvedValue({ choices: [{ message: { content } }] });
}

describe("buildC3Facts", () => {
  it("computes rates and direction server-side for paired-cohort", () => {
    const facts = buildC3Facts(PAIRED as never);
    expect(facts).toContain("暴露者的结局发生率：3.0%");
    expect(facts).toContain("未暴露者的结局发生率：4.5%");
    expect(facts.join("\n")).toContain("低于未暴露者");
  });

  it("does not divide by zero when a group is empty", () => {
    const facts = buildC3Facts({ ...PAIRED, exposed: 0 } as never);
    expect(facts.join("\n")).toContain("无法比较");
  });

  it("skips suppressed buckets and ranks signals first", () => {
    const facts = buildC3Facts({
      analysisType: "disproportionality",
      cohortSize: 900,
      buckets: [
        { key: "皮疹", count: 12, prr: 1.1, signal: false },
        {
          key: "肝损伤",
          count: 30,
          prr: 2.5,
          prrCi95: [1.4, 3.8],
          signal: true,
        },
        { key: "小格", count: 0, suppressed: true },
      ],
    } as never);
    expect(facts.join("\n")).not.toContain("小格");
    expect(facts[2]).toContain("肝损伤");
    expect(facts[2]).toContain("PRR 2.50（95%CI 1.40–3.80）");
  });
});

describe("unsupportedNumbers", () => {
  it("accepts numbers present in the allowed text, comparing by value", () => {
    expect(unsupportedNumbers("发生率 3% 与 4.5%", "3.0% 4.5%")).toEqual([]);
  });

  it("flags numbers the model made up", () => {
    // 实测 Qwen3-1.7B 的错误：把 3.0% 写成 0.30
    expect(unsupportedNumbers("发生率为 0.30", "3.0% 4.5%")).toEqual(["0.30"]);
  });
});

describe("ResultInterpreterService", () => {
  it("returns a labelled draft with the facts and model identity", async () => {
    const create = replyWith(
      "<think>略</think>暴露者的结局发生率为 3.0%，低于未暴露者的 4.5%；这是粗率比较，需进一步研究确认。",
    );
    const out = await makeService(create).interpret("SGLT2 与心衰住院", PAIRED);

    expect(out.draft).not.toContain("<think>");
    expect(out.label).toBe(DRAFT_LABEL);
    expect(out.model).toBe("qwen3-1.7b");
    expect(out.vendor).toBe("self-hosted");
    expect(out.facts.length).toBeGreaterThan(0);
    const sent = create.mock.calls[0][0];
    expect(sent.messages[1].content).toContain("3.0%");
  });

  it("rejects non-C3 payloads without calling the model", async () => {
    const create = replyWith("不应被调用");
    const service = makeService(create);

    await expect(
      service.interpret("q", { ...PAIRED, rows: [{ patientId: "p1" }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.interpret("q", { analysisType: "row-dump" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it("throws 422 and withholds the draft when the model invents a number", async () => {
    const create = replyWith("暴露者发生率为 0.30，明显低于对照。");
    await expect(
      makeService(create).interpret("q", PAIRED),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("throws 503 when the endpoint fails, with no fallback call", async () => {
    const create = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      makeService(create).interpret("q", PAIRED),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("throws 503 when no endpoint is configured", async () => {
    await expect(
      makeService(null, {}).interpret("q", PAIRED),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("passes configured extra body through to the endpoint", async () => {
    const create = replyWith(
      "暴露者的结局发生率低于未暴露者，需进一步研究确认。",
    );
    await makeService(create, {
      ...ENV,
      RESULT_INTERPRETER_LLM_EXTRA_BODY:
        '{"chat_template_kwargs":{"enable_thinking":false}}',
    }).interpret("q", PAIRED);
    expect(create.mock.calls[0][0].chat_template_kwargs).toEqual({
      enable_thinking: false,
    });
  });
});
