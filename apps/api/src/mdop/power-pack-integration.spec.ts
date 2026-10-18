/**
 * 电力包平台侧集成（任务 7.5）：模板 / 收集器 / 通道 / 合并算子归属。
 */
import {
  buildDemandResponsePlan,
  buildLoadForecastPlan,
  buildTheftDetectionPlan,
  powerAggregationCollectors,
  powerTemplates,
  POWER_OPERATORS,
  registerPowerCollectors,
  registerPowerTemplates,
} from "@medtrust/domain-power";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import { CaService } from "../runtime/participant-identity/ca.service";
import { AlgorithmModuleRegistry } from "../runtime/connector-modules/algorithm-module.registry";
import { MdopJobsService } from "./mdop-jobs.service";
import { MdopMergeService, sinkStageParams } from "./mdop-merge.service";
import { MdopOperatorRegistryService } from "./operator-registry.service";
import { MdopPurgeService } from "./mdop-purge.service";

import { kernelCollectorRegistry } from "./operators/collector-registry";
import { kernelTemplateRegistry } from "./template-registry";
import {
  keyForPlanOps,
  keyForTemplate,
  resolveChannel,
} from "../runtime/orchestration/orchestration.channels";
import {
  seededSystemOperators,
  SYSTEM_OPERATORS,
} from "./operator-registry.service";
import {
  kernelPlatformOperatorRegistry,
  registerPlatformOperator,
} from "./operators/platform-operator-registry";
import {
  registerPowerPlatformOperators,
  POWER_PLATFORM_OPERATORS,
} from "@medtrust/domain-power";

beforeAll(() => registerPowerPlatformOperators(kernelPlatformOperatorRegistry));

describe("电力包平台集成（§7）", () => {
  it("三个计划模板可注册且通道可解析", () => {
    const ids = powerTemplates().map((t) => t.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "power.load-forecast",
        "power.demand-response",
        "power.theft-detection",
      ]),
    );
    for (const id of ids) {
      expect(keyForTemplate(id)).toBe(id);
      expect(resolveChannel(id)).toBe("mdop");
    }
  });

  it("收集器含负荷预测、需求响应与窃电检测", () => {
    const types = powerAggregationCollectors().map((c) => c.analysisType);
    expect(types).toEqual(
      expect.arrayContaining([
        "power.load-forecast",
        "power.demand-response",
        "power.theft-detection",
      ]),
    );
    expect(types).toHaveLength(3);
  });

  it("合并算子可推导台账 key", () => {
    expect(keyForPlanOps(["power.load-forecast-merge@1.0.0"])).toBe(
      "power.load-forecast",
    );
    expect(keyForPlanOps(["power.dr-optimize@1.0.0"])).toBe(
      "power.demand-response",
    );
    expect(keyForPlanOps(["power.theft-merge@1.0.0"])).toBe(
      "power.theft-detection",
    );
  });

  it("电力平台合并算子由包在组装根注册，不内置在基座 SYSTEM_OPERATORS", () => {
    const POWER_MERGES = [
      "power.load-forecast-merge",
      "power.dr-optimize",
      "power.theft-merge",
    ];
    expect(
      SYSTEM_OPERATORS.map((o) => o.id).filter((id) => id.startsWith("power.")),
    ).toEqual([]);
    expect(seededSystemOperators().map((o) => o.id)).toEqual(
      expect.arrayContaining(POWER_MERGES),
    );
  });

  it("行业包只能注册 system/merge；改成 declassify 即拒", () => {
    const bad = {
      ...POWER_PLATFORM_OPERATORS[0]!,
      id: "power.bad-declassify",
      category: "declassify",
    };
    expect(() => registerPlatformOperator(bad)).toThrow(/system\/merge/);
  });

  it("POWER_OPERATORS 清单为 6 个", () => {
    expect(POWER_OPERATORS).toHaveLength(6);
  });

  it("kernel 注册表可挂载电力模板与收集器（幂等，不抛错）", () => {
    expect(() => {
      registerPowerTemplates(kernelTemplateRegistry);
      registerPowerCollectors(kernelCollectorRegistry);
      registerPowerTemplates(kernelTemplateRegistry);
      registerPowerCollectors(kernelCollectorRegistry);
    }).not.toThrow();
  });
});

const WINDOW = {
  notBefore: "2026-10-15T00:00:00.000Z",
  notAfter: "2026-11-15T00:00:00.000Z",
};
const APPLICANT = { org: "p-grid", project: "power" };
const DR_SPEC = {
  targetLoad: Array.from({ length: 24 }, (_, h) =>
    h >= 17 && h < 21 ? 50 : 0,
  ),
  incentiveBudget: 10_000,
  timeWindow: [0, 24] as [number, number],
};

const planOf = {
  "load-forecast": () =>
    buildLoadForecastPlan({
      purpose: "区域负荷预测",
      applicant: APPLICANT,
      contracts: ["c-power"],
      participants: [
        { participantId: "p-grida", dataProductId: "dp-meter-a", role: "grid" },
        { participantId: "p-gridb", dataProductId: "dp-meter-b", role: "grid" },
      ],
      spec: { forecastHorizon: 24, features: ["load"], model: "baseline" },
      ...WINDOW,
    }),
  "demand-response": () =>
    buildDemandResponsePlan({
      purpose: "削峰需求响应",
      applicant: APPLICANT,
      contracts: ["c-power"],
      participants: [
        { participantId: "p-grida", dataProductId: "dp-meter-a" },
        {
          participantId: "p-gridb",
          dataProductId: "dp-meter-b",
          userType: "commercial",
        },
      ],
      spec: DR_SPEC,
      ...WINDOW,
    }),
  "theft-detection": () =>
    buildTheftDetectionPlan({
      purpose: "窃电稽查",
      applicant: APPLICANT,
      contracts: ["c-power"],
      participants: [
        { participantId: "p-grida", dataProductId: "dp-meter-a" },
        { participantId: "p-gridb", dataProductId: "dp-meter-b" },
      ],
      spec: { detectionPeriod: 30, anomalyThreshold: 0.3, topK: 10 },
      ...WINDOW,
    }),
};

async function realOperators() {
  const gm = new GMCryptoService();
  const ca = new CaService(gm, mockRepo(), mockRepo(), "sh-med");
  await ca.onModuleInit();
  const modules = new AlgorithmModuleRegistry(gm, ca);
  modules.onModuleInit();
  const operators = new MdopOperatorRegistryService(
    gm,
    ca,
    mockRepo(),
    mockRepo(),
    modules,
  );
  await operators.onModuleInit();
  return operators;
}

describe("电力计划经真实算子注册表编译（§6/§7 闭环）", () => {
  it("三个节点分析算子由 wasm manifest 自动登记为 kind=wasm", async () => {
    const operators = await realOperators();
    for (const id of [
      "power.feature-extraction",
      "power.dr-potential",
      "power.anomaly-detection",
    ]) {
      const op = await operators.find({ id, version: "1.0.0" });
      expect(op?.kind).toBe("wasm");
    }
  });

  it.each(Object.keys(planOf) as Array<keyof typeof planOf>)(
    "%s 计划可提交（算子均已登记、阶段可放置）",
    async (name) => {
      const jobs = new MdopJobsService(
        mockRepo(),
        mockRepo(),
        mockRepo(),
        await realOperators(),
        { assertUsableForJob: async () => true } as never,
      );
      const job = await jobs.submit(planOf[name]());
      expect(job.id).toBeTruthy();
    },
  );

  it("sinkStageParams 取唯一汇点（平台合并阶段）的参数；汇点不唯一时不猜", () => {
    expect(sinkStageParams(planOf["demand-response"]())).toEqual({
      spec: DR_SPEC,
    });
    expect(
      sinkStageParams({
        stages: [
          { id: "a", params: { x: 1 } },
          { id: "b", params: { y: 2 } },
        ],
      }),
    ).toBeUndefined();
    expect(sinkStageParams(null)).toBeUndefined();
  });

  it("需求响应合并：申请方 spec 经汇点参数透传到收集器（不再由平台编造目标）", async () => {
    registerPowerCollectors(kernelCollectorRegistry);
    const JOB = "job-power-dr";
    const PLATFORM = "urn:tds:sh-med:participant:platform";
    const nodes = [
      "urn:tds:sh-med:participant:p-grida",
      "urn:tds:sh-med:participant:p-gridb",
    ];
    const jobsRepo = mockRepo();
    const deliveriesRepo = mockRepo();
    const fragmentsRepo = mockRepo();
    const stagesRepo = mockRepo();
    await jobsRepo.save(
      jobsRepo.create({
        id: JOB,
        status: "RUNNING",
        contracts: [],
        logicalPlan: planOf["demand-response"](),
      }),
    );
    for (const node of nodes) {
      await fragmentsRepo.save(
        fragmentsRepo.create({ jobId: JOB, node, stages: [] }),
      );
      await stagesRepo.save(
        stagesRepo.create({ jobId: JOB, node, outputLabel: "C3" }),
      );
      await deliveriesRepo.save(
        deliveriesRepo.create({
          id: node + ":delivery",
          jobId: JOB,
          node,
          handle: `art://${node}/${JOB}/dec/table`,
          label: "C3",
          digest: "sm3:" + "0".repeat(64),
          accepted: true,
          payload: {
            analysisType: "power.demand-response",
            entityId: node,
            nMeters: 6,
            baselineCurve: Array.from({ length: 24 }, (_, h) =>
              h >= 17 && h < 21 ? 160 : 80,
            ),
            peakReduction: Array.from({ length: 24 }, (_, h) => [h, 20, 0.5]),
            valleyShift: [],
            constraints: {},
          },
        }),
      );
    }
    const merge = new MdopMergeService(
      jobsRepo,
      deliveriesRepo,
      fragmentsRepo,
      stagesRepo,
      new MdopPurgeService(jobsRepo, fragmentsRepo, mockRepo(), mockRepo()),
    );
    await merge.mergeIfReady(JOB, { type: "power.demand-response" } as never);
    const rows = (await deliveriesRepo.find()) as Array<{
      node?: string;
      payload?: Record<string, unknown>;
    }>;
    const platform = rows.find((r) => r.node === PLATFORM)?.payload;
    expect(platform?.analysisType).toBe("power.demand-response");
    expect(platform?.nParticipants).toBe(2);
  });
});
