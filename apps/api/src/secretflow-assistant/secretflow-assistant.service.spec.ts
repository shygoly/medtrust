import {
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SecretFlowAssistantService } from "./secretflow-assistant.service";
import { isSecretFlowTaskSpec } from "../compute-task/dto/secretflow-task-spec";

const VALID_SPEC = {
  parties: [
    { participantId: "hospital-demohospa", role: "provider" },
    { participantId: "pharma-demo", role: "consumer" },
  ],
  modalities: [{ type: "structured_ehr" }],
  llmBackbone: { modelType: "llama", modelNameOrPath: "meditron-7b" },
  peftStrategy: {
    type: "lora",
    r: 8,
    alpha: 16,
    targetModules: ["q_proj", "v_proj"],
  },
  privacy: { teeRequired: true, heuEnabled: true },
  outputPolicy: { allowedArtifacts: ["aggregate_metrics", "lora_delta_hash"] },
};

function makeService(createImpl: jest.Mock): SecretFlowAssistantService {
  const config = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;
  const service = new SecretFlowAssistantService(config);
  // Inject a stub OpenAI-compatible client (no network, no key needed).
  (service as unknown as { client: unknown }).client = {
    chat: { completions: { create: createImpl } },
  };
  (service as unknown as { model: string }).model = "deepseek-v4-pro";
  return service;
}

function completionWith(payload: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(payload) } }],
  });
}

describe("SecretFlowAssistantService", () => {
  it("returns a YAML + spec that passes isSecretFlowTaskSpec", async () => {
    const create = completionWith({
      spec: VALID_SPEC,
      rationale: { parties: "两家医院作为数据提供方，药企作为使用方。" },
      warnings: [],
      assumptions: ["医院 id 为推断，请核对"],
    });
    const service = makeService(create);

    const out = await service.draft(
      "创新药企联合示范甲医院，基于 eGFR/UACR 做 CKD 进展预测",
    );

    expect(isSecretFlowTaskSpec(out.spec)).toBe(true);
    expect(out.yaml).toContain("parties");
    expect(out.assumptions).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("throws 422 when the generated spec is invalid (empty parties)", async () => {
    const create = completionWith({
      spec: { ...VALID_SPEC, parties: [] },
      rationale: {},
      warnings: [],
      assumptions: [],
    });
    const service = makeService(create);

    await expect(service.draft("随便做点什么")).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it("throws 422 when the model returns non-JSON", async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: "抱歉，我无法生成。" } }],
    });
    const service = makeService(create);

    await expect(service.draft("x")).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it("throws 503 when no API key is configured", async () => {
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const service = new SecretFlowAssistantService(config);

    await expect(service.draft("x")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
