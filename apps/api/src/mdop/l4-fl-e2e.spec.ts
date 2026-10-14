import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ckdEsrdRiskFlPredictionSpec } from "../compute-task/dto/fl-prediction-task-spec";
import {
  buildMockFlPartyRunResult,
  mergeFlPartyResults,
} from "../compute-task/dto/fl-run-result";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import { CaService } from "../runtime/participant-identity/ca.service";
import { AlgorithmModuleRegistry } from "../runtime/connector-modules/algorithm-module.registry";
import { MdopJobsService } from "./mdop-jobs.service";
import { MdopMergeService } from "./mdop-merge.service";
import { MdopOperatorRegistryService } from "./operator-registry.service";
import { MdopPurgeService } from "./mdop-purge.service";
import { buildL4Plan } from "./plan-templates";

/**
 * 批次 1A（mdop-fl-migration）：L4 的 **平台链路端到端**证明（用测试替身当参与方结果）。
 *
 * 钉两件事：
 * ① 合并分派必须**按计划里的 merge.fedavg 阶段**优先于 analysisType 三元 —— L4 的 per-node
 *    payload 是 FlPartyRunResult（没有 analysisType），否则会错落到 L1.5 的 mergeProportionality；
 * ② wasm 模块未落地前的**已知边界**：L4 计划会在提交期被"引用了未注册的算子"拒（见 change design D1b）。
 */

const PLATFORM = "urn:tds:sh-med:participant:platform";
const NODE_A = "urn:tds:sh-med:participant:p-demohospa";
const NODE_B = "urn:tds:sh-med:participant:p-demohospb";
const JOB = "job-l4-fl";

const spec = {
  ...ckdEsrdRiskFlPredictionSpec(),
  modelType: "logistic_regression" as const,
  aggregation: "fedavg" as const,
};

const L4_STAGES = [
  {
    id: "l4_a",
    op: "rws.l4-train@1.0.0",
    inputs: [{ from: "src_a" }],
    params: { spec },
  },
  {
    id: "merge",
    op: "merge.fedavg@1.0.0",
    inputs: [{ from: "dec_a" }, { from: "dec_b" }],
    params: { spec },
  },
];

async function harness(
  planStages: unknown[],
  payloads: Record<string, unknown>,
) {
  const jobsRepo = mockRepo();
  const deliveriesRepo = mockRepo();
  const fragmentsRepo = mockRepo();
  const stagesRepo = mockRepo();
  await jobsRepo.save(
    jobsRepo.create({
      id: JOB,
      status: "RUNNING",
      contracts: [],
      logicalPlan: { stages: planStages },
    }),
  );
  for (const node of [NODE_A, NODE_B]) {
    await fragmentsRepo.save(
      fragmentsRepo.create({ jobId: JOB, node, stages: [] }),
    );
    await stagesRepo.save(
      stagesRepo.create({ jobId: JOB, node, outputLabel: "C3" }),
    );
  }
  for (const node of [NODE_A, NODE_B]) {
    const payload = payloads[node];
    await deliveriesRepo.save(
      deliveriesRepo.create({
        id: node + ":delivery",
        jobId: JOB,
        node,
        handle: "art://" + node + "/" + JOB + "/dec/table",
        label: "C3",
        digest: "sm3:" + "0".repeat(64),
        accepted: true,
        payload,
      }),
    );
  }
  const purge = new MdopPurgeService(
    jobsRepo,
    fragmentsRepo,
    mockRepo(),
    mockRepo(),
  );
  const merge = new MdopMergeService(
    jobsRepo,
    deliveriesRepo,
    fragmentsRepo,
    stagesRepo,
    purge,
  );
  return { merge, deliveriesRepo };
}

describe("L4 联邦预测的 MDOP 平台链路（批次 1A）", () => {
  const a = buildMockFlPartyRunResult("fl-1", "p-demohospa", 300, 2);
  const b = buildMockFlPartyRunResult("fl-1", "p-demohospb", 100, 2);

  it("merge.fedavg 分派优先于 analysisType：平台交付物 = 旧链同一函数的合并结果", async () => {
    const { merge, deliveriesRepo } = await harness(L4_STAGES, {
      [NODE_A]: a,
      [NODE_B]: b,
    });
    // 故意传 **L1.5 形态**的 analysis（消息控制器就是这么传的）：L4 分支必须压过它
    await merge.mergeIfReady(JOB, {
      type: "disproportionality",
      level: "L1.5",
    } as never);
    const rows = (await deliveriesRepo.find()) as Array<{
      node?: string;
      payload?: unknown;
    }>;
    const platform = rows.find((r) => r.node === PLATFORM);
    expect(platform?.payload).toEqual(
      mergeFlPartyResults([a, b], spec, { runtime: "connector-ml" }),
    );
  });

  it("L1.5 计划（无 merge.fedavg 阶段）仍走失衡合并——分派不误伤", async () => {
    const table = {
      analysisType: "disproportionality",
      cohortSize: 4,
      buckets: [{ key: "x", count: 2, rate: 0.5, b: 1, c: 1, d: 0 }],
    };
    const { merge, deliveriesRepo } = await harness(
      [
        {
          id: "l15_a",
          op: "rws.disproportionality@1.0.0",
          inputs: [],
          params: { drug: "MEM" },
        },
        {
          id: "merge",
          op: "merge.disproportionality@1.0.0",
          inputs: [],
          params: { drug: "MEM" },
        },
      ],
      { [NODE_A]: table, [NODE_B]: table },
    );
    await merge.mergeIfReady(JOB, {
      type: "disproportionality",
      level: "L1.5",
      drug: "MEM",
    } as never);
    const rows = (await deliveriesRepo.find()) as Array<{
      node?: string;
      payload?: Record<string, unknown>;
    }>;
    const platform = rows.find((r) => r.node === PLATFORM);
    // 失衡合并会**重建**载荷（不是把两院表原样拼起来）：有 buckets、没有 modelHash
    expect(platform?.payload?.cohortSize).toBe(8);
    expect(platform?.payload?.modelHash).toBeUndefined();
  });

  it("wasm 模块落地后（3.0 完成）：真实 manifest 注册出 rws.l4-train，L4 计划**可提交**", async () => {
    const gm = new GMCryptoService();
    const ca = new CaService(gm, mockRepo(), mockRepo(), "sh-med");
    await ca.onModuleInit();
    // 真实模块注册表：读 packages/wasm-algorithms/build/manifest.json（提交进版本库的产物）
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
    const l4 = await operators.find({ id: "rws.l4-train", version: "1.0.0" });
    expect(l4).toBeTruthy();
    expect(l4?.kind).toBe("wasm");

    const jobs = new MdopJobsService(
      mockRepo(),
      mockRepo(),
      mockRepo(),
      operators,
      { assertUsableForJob: async () => true } as never,
    );
    const job = await jobs.submit(
      buildL4Plan({
        purpose: "L4 演示",
        applicant: { org: "p-meddata", project: "ckd-esrd" },
        contracts: ["c1"],
        hospitals: [
          {
            participantId: "p-demohospa",
            dataProductId: "dp-insulin-panc-demohospa",
          },
        ],
        spec,
        notBefore: "2026-10-13T00:00:00.000Z",
        notAfter: "2026-11-13T00:00:00.000Z",
      }),
    );
    expect(job.id).toBeTruthy();
  });

  it("跨节点夹具：平台 merge.fedavg 能消费连接器产出的**真实** C3", async () => {
    // 夹具由连接器侧用真 wasm 模块 + 真沙箱产出（apps/connector/.../l4-cross-node.spec.ts 钉住可复现）
    const fixturePath = resolve(
      __dirname,
      "../../../../openspec/changes/mdop-fl-migration/evidence/l4-equivalence/c3-payloads.json",
    );
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      parties: Array<Record<string, unknown>>;
    };
    expect(fixture.parties).toHaveLength(2);
    const { merge, deliveriesRepo } = await harness(L4_STAGES, {
      [NODE_A]: fixture.parties[0],
      [NODE_B]: fixture.parties[1],
    });
    await merge.mergeIfReady(JOB, {
      type: "disproportionality",
      level: "L1.5",
    } as never);
    const rows = (await deliveriesRepo.find()) as Array<{
      node?: string;
      payload?: unknown;
    }>;
    const platform = rows.find((r) => r.node === PLATFORM);
    // 平台合并结果 = 旧链共享函数对该夹具的结果（样本量加权）；证明平台能消费连接器的真实字节
    expect(platform?.payload).toEqual(
      mergeFlPartyResults(fixture.parties as never, spec, {
        runtime: "connector-ml",
      }),
    );
  });

  it("已知边界（回归保留）：无 wasm 模块时，L4 计划在提交期被「未注册的算子」拒", async () => {
    const gm = new GMCryptoService();
    const ca = new CaService(gm, mockRepo(), mockRepo(), "sh-med");
    await ca.onModuleInit();
    const operators = new MdopOperatorRegistryService(
      gm,
      ca,
      mockRepo(),
      mockRepo(),
      { list: () => [] } as unknown as AlgorithmModuleRegistry,
    );
    await operators.onModuleInit(); // 只种 5 个 system 算子（含 merge.fedavg），**没有** rws.l4-train
    const jobs = new MdopJobsService(
      mockRepo(),
      mockRepo(),
      mockRepo(),
      operators,
      { assertUsableForJob: async () => true } as never,
    );
    await expect(
      jobs.submit(
        buildL4Plan({
          purpose: "L4 演示",
          applicant: { org: "p-meddata", project: "ckd-esrd" },
          contracts: ["c1"],
          hospitals: [
            {
              participantId: "p-demohospa",
              dataProductId: "dp-insulin-panc-demohospa",
            },
          ],
          spec,
          notBefore: "2026-10-13T00:00:00.000Z",
          notAfter: "2026-11-13T00:00:00.000Z",
        }),
      ),
    ).rejects.toThrow(/未注册的算子 rws\.l4-train@1\.0\.0/);
  });
});
