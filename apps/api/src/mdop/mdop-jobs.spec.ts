import { BadRequestException } from "@nestjs/common";
import {
  computePlanHash,
  fragmentHash,
  sm2Sign,
  validateEdge,
  type NodeCapability,
} from "@medtrust/mdop";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { CaService } from "../runtime/participant-identity/ca.service";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import { AlgorithmModuleRegistry } from "../runtime/connector-modules/algorithm-module.registry";
import { MdopContractService } from "../runtime/digital-contract/mdop-contract.service";
import { MdopOperatorRegistryService } from "./operator-registry.service";
import {
  MdopJobsService,
  PLATFORM_NODE,
  type SubmitJobInput,
} from "./mdop-jobs.service";
import { MdopAttestationService } from "./mdop-attestation.service";
import { MdopTicketService } from "./mdop-ticket.service";
import { buildPlanWithInputMapping } from "./template-registry";
import {
  DEDUP_INCIDENCE_TEMPLATE_ID,
  VE_TND_TEMPLATE_ID,
} from "./plan-templates";

const WASM_SM3 = "b".repeat(64);
const HOSP_A = "urn:tds:sh-med:participant:p-demohospa";
const HOSP_B = "urn:tds:sh-med:participant:p-demohospb";
const TEE_NODE = "urn:tds:sh-med:participant:tee-1";
const CONTRACT = "ctr-mdop-jobs";
const TEE_MEASUREMENT = "sm3:" + "e".repeat(64);

function capability(
  node: string,
  over: Partial<NodeCapability> = {},
): NodeCapability {
  return {
    node,
    runtime: ["native", "wasm"],
    system_ops: ["source.dataset@1.0.0", "declassify.small_cell@1.0.0"],
    whitelist_digests: [`sm3:${WASM_SM3}`],
    tee: null,
    protocols: [],
    ...over,
  };
}

describe("MDOP 作业提交与编译（任务 7.3 / 7.4）", () => {
  let gm: GMCryptoService;
  let ca: CaService;
  let jobsRepo: ReturnType<typeof mockRepo>;
  let stagesRepo: ReturnType<typeof mockRepo>;
  let fragmentsRepo: ReturnType<typeof mockRepo>;
  let operators: MdopOperatorRegistryService;
  let contracts: MdopContractService;
  let jobs: MdopJobsService;
  let contractsRepo: ReturnType<typeof mockRepo>;
  let certsRepo: ReturnType<typeof mockRepo>;
  let outboxRepo: ReturnType<typeof mockRepo>;
  let providerKeys: { publicKey: string; privateKey: string };

  const capabilities = () =>
    new Map<string, NodeCapability>([
      [HOSP_A, capability(HOSP_A)],
      [HOSP_B, capability(HOSP_B)],
      [
        PLATFORM_NODE,
        capability(PLATFORM_NODE, {
          system_ops: ["merge.disproportionality@1.0.0"],
        }),
      ],
    ]);

  /** 一份「两院 L1.5 → 平台合并」的逻辑计划。 */
  const l15Plan = (over: Partial<SubmitJobInput> = {}): SubmitJobInput => ({
    purpose: "RWS.EFFECTIVENESS",
    applicant: { org: "sponsor", project: "t2dm" },
    contracts: [CONTRACT],
    stages: [
      // 数据源句柄是「输入」：以 ds://<节点>/… 为输入的阶段放在该节点（数据就近）
      {
        id: "srcA",
        op: "source.dataset@1.0.0",
        inputs: [{ from: "ds://p-demohospa/dp-1" }],
        params: {},
      },
      {
        id: "l15A",
        op: "rws.disproportionality@1.0.0",
        inputs: [{ from: "srcA" }],
        params: {},
      },
      {
        id: "decA",
        op: "declassify.small_cell@1.0.0",
        inputs: [{ from: "l15A" }],
        params: { minCell: 10 },
      },
      {
        id: "srcB",
        op: "source.dataset@1.0.0",
        inputs: [{ from: "ds://p-demohospb/dp-2" }],
        params: {},
      },
      {
        id: "l15B",
        op: "rws.disproportionality@1.0.0",
        inputs: [{ from: "srcB" }],
        params: {},
      },
      {
        id: "decB",
        op: "declassify.small_cell@1.0.0",
        inputs: [{ from: "l15B" }],
        params: { minCell: 10 },
      },
      {
        id: "merge",
        op: "merge.disproportionality@1.0.0",
        inputs: [{ from: "decA" }, { from: "decB" }],
        params: {},
      },
    ],
    not_before: "2026-09-24T00:00:00.000Z",
    not_after: "2026-10-24T00:00:00.000Z",
    ...over,
  });

  beforeEach(async () => {
    gm = new GMCryptoService();
    ca = new CaService(gm, mockRepo(), mockRepo(), "sh-med");
    await ca.onModuleInit();
    jobsRepo = mockRepo();
    stagesRepo = mockRepo();
    fragmentsRepo = mockRepo();
    contractsRepo = mockRepo();
    certsRepo = mockRepo();
    outboxRepo = mockRepo();
    operators = new MdopOperatorRegistryService(
      gm,
      ca,
      mockRepo(),
      mockRepo(),
      {
        list: () => [
          {
            analysisType: "ve-tnd",
            file: "ve-tnd.wasm",
            abiVersion: 1,
            sm3: WASM_SM3,
            compiler: { name: "assemblyscript", version: "0.27.37" },
          },
          {
            analysisType: "dedup-incidence",
            file: "dedup-incidence.wasm",
            abiVersion: 1,
            sm3: WASM_SM3,
            compiler: { name: "assemblyscript", version: "0.27.37" },
          },
          {
            analysisType: "disproportionality",
            file: "disproportionality.wasm",
            abiVersion: 1,
            sm3: WASM_SM3,
            compiler: { name: "assemblyscript", version: "0.27.37" },
          },
        ],
      } as unknown as AlgorithmModuleRegistry,
    );
    await operators.onModuleInit();
    contracts = new MdopContractService(
      gm,
      ca,
      contractsRepo,
      certsRepo,
      mockRepo(),
      "sh-med",
    );
    jobs = new MdopJobsService(
      jobsRepo,
      stagesRepo,
      fragmentsRepo,
      operators,
      contracts,
    );

    // 提供方（示范甲的连接器）已注册；合约走完整要约→接受流程，拿到 active 的持签合约
    providerKeys = gm.generateSM2KeyPair();
    await certsRepo.save(
      certsRepo.create({
        sm2Fingerprint: "SM2:HS",
        participantId: "p-demohospa",
        connectorId: "c-demohospa",
        spaceId: "sh-med",
        subjectPublicKey: providerKeys.publicKey,
        validUntil: new Date("2027-09-24T00:00:00.000Z"),
        revoked: false,
      }),
    );
    await contractsRepo.save(
      contractsRepo.create({
        id: CONTRACT,
        dataProductId: "dp-1",
        providerId: "p-demohospa",
        consumerId: "p-meddata",
        purpose: "RWS.EFFECTIVENESS",
        retention: "阅后即焚",
        output: "仅聚合统计",
        outputPolicy: { preset: "aggregate-only", minCell: 10 },
        validUntil: "2027-09-24T00:00:00.000Z",
        status: "active",
        pinnedModules: { disproportionality: { sm3: WASM_SM3, tier: "A" } },
        createdAt: new Date("2026-09-24T00:00:00.000Z"),
        mdopStatus: "unsigned",
      }),
    );
    const offer = await contracts.offer(CONTRACT, {
      extraRecipients: [{ party: HOSP_A, role: "final", jurisdiction: "CN" }],
    });
    await contracts.agree({
      contractId: CONTRACT,
      canonical: offer.canonical,
      holderSignature: sm2Sign(offer.canonical, providerKeys.privateKey, {
        publicKey: providerKeys.publicKey,
      }),
    });
  });

  describe("提交（任务 7.3）", () => {
    it("合法计划 → SUBMITTED", async () => {
      const job = await jobs.submit(l15Plan());
      expect(job.status).toBe("SUBMITTED");
      expect(job.id).toMatch(/^job-/);
    });

    it("场景专属（3.3）：ve-tnd / dedup 的模板计划经注册表可直接提交为作业（带阶段计划）", async () => {
      // 走端点同一条构建路径；purpose 与合约一致（否则合约资格校验会拒）
      const vePlan = buildPlanWithInputMapping(
        VE_TND_TEMPLATE_ID,
        {
          purpose: "RWS.EFFECTIVENESS",
          applicant: { org: "p-meddata", project: "ve-tnd" },
          contracts: [CONTRACT],
          registry: { participantId: "p-cdc-demo", dataProductId: "dp-ve-tnd-immunization-cdc" },
          tests: { participantId: "p-demohospa", dataProductId: "dp-ve-tnd-tests-demohospa" },
          teeNode: "urn:tds:sh-med:participant:tee-node-a",
          vaccineCodes: ["208"],
          pathogenCodes: ["J10.1"],
          notBefore: "2026-09-24T00:00:00.000Z",
          notAfter: "2026-10-24T00:00:00.000Z",
        },
        "sh-med",
      );
      const veJob = await jobs.submit({
        purpose: vePlan.purpose,
        applicant: vePlan.applicant,
        contracts: vePlan.contracts,
        stages: vePlan.stages,
        not_before: vePlan.not_before,
        not_after: vePlan.not_after,
      });
      expect(veJob.status).toBe("SUBMITTED");
      expect((veJob.logicalPlan as { stages: unknown[] }).stages.length).toBe(
        vePlan.stages.length,
      );

      const dedupPlan = buildPlanWithInputMapping(
        DEDUP_INCIDENCE_TEMPLATE_ID,
        {
          purpose: "RWS.EFFECTIVENESS",
          applicant: { org: "p-meddata", project: "dedup" },
          contracts: [CONTRACT],
          hospitals: [
            { participantId: "p-demohospa", dataProductId: "dp-dedup-cohort-demohospa" },
            { participantId: "p-demohospb", dataProductId: "dp-dedup-cohort-demohospb" },
          ],
          teeNode: "urn:tds:sh-med:participant:tee-node-a",
          eventCodes: ["I21.9"],
          rareCodes: ["E76.0"],
          minCell: 5,
          minCellRare: 10,
          notBefore: "2026-09-24T00:00:00.000Z",
          notAfter: "2026-10-24T00:00:00.000Z",
        },
        "sh-med",
      );
      const dedupJob = await jobs.submit({
        purpose: dedupPlan.purpose,
        applicant: dedupPlan.applicant,
        contracts: dedupPlan.contracts,
        stages: dedupPlan.stages,
        not_before: dedupPlan.not_before,
        not_after: dedupPlan.not_after,
      });
      expect(dedupJob.status).toBe("SUBMITTED");
      expect((dedupJob.logicalPlan as { stages: unknown[] }).stages.length).toBe(
        dedupPlan.stages.length,
      );
    });
    it("缺用途编码 / 引用未注册算子 / 合约无持有方签名 → 拒", async () => {
      await expect(jobs.submit(l15Plan({ purpose: "" }))).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        jobs.submit(
          l15Plan({
            stages: [
              { id: "x", op: "unknown.op@1.0.0", inputs: [], params: {} },
            ],
          }),
        ),
      ).rejects.toThrow(/未注册的算子/);

      // 把合约退回「无持有方签名」状态 → E_CONTRACT_UNSIGNED
      await contractsRepo.update(
        { id: CONTRACT },
        { mdopStatus: "unsigned", holderSignature: null },
      );
      await expect(jobs.submit(l15Plan())).rejects.toMatchObject({
        code: "E_CONTRACT_UNSIGNED",
      });
    });
  });

  describe("编译（任务 7.4）", () => {
    it("数据就近放置 + 多节点依赖落平台合并 + 片段切分与 plan_hash", async () => {
      const job = await jobs.submit(l15Plan());
      const { fragments, planHash } = await jobs.compile({
        jobId: job.id,
        capabilities: capabilities(),
        jobNotBefore: "2026-09-24T00:00:00.000Z",
        jobNotAfter: "2026-10-24T00:00:00.000Z",
      });

      const byNode = new Map(fragments.map((f) => [f.node, f]));
      expect([...byNode.keys()].sort()).toEqual(
        [HOSP_A, HOSP_B, PLATFORM_NODE].sort(),
      );
      // 数据就近：以 ds://p-demohospa 为输入的阶段在示范甲
      expect(
        byNode
          .get(HOSP_A)!
          .stages.map((s) => s.id)
          .sort(),
      ).toEqual(["decA", "l15A", "srcA"]);
      // 多节点依赖 → 平台合并
      expect(byNode.get(PLATFORM_NODE)!.stages.map((s) => s.id)).toEqual([
        "merge",
      ]);

      // 节点看不到他院片段内容；只看得到边界边
      const hospA = byNode.get(HOSP_A)!;
      expect(hospA.stages.some((s) => s.id === "srcB")).toBe(false);
      expect(hospA.edges.some((e) => e.from_stage === "decB")).toBe(false);
      expect(hospA.edges.some((e) => e.to_stage === "merge")).toBe(true);

      // plan_hash 可被节点独立重算
      const hashes = Object.fromEntries(
        fragments.map((f) => [f.node, fragmentHash(f)]),
      );
      const recomputed = computePlanHash({
        job: {
          job_id: job.id,
          purpose: "RWS.EFFECTIVENESS",
          applicant: { org: "sponsor", project: "t2dm" },
          contracts: [CONTRACT],
          not_before: "2026-09-24T00:00:00.000Z",
          not_after: "2026-10-24T00:00:00.000Z",
        },
        fragments: hashes,
      });
      expect(recomputed).toBe(planHash);
      const stored = await jobsRepo.findOne({ where: { id: job.id } });
      expect(stored.status).toBe("COMPILED");
      expect(stored.planHash).toBe(planHash);
    });

    it("非降密算子不得声明降级（标签传播规则）", async () => {
      // 把 L1.5 wasm 算子的输出规则改成固定 C3 → 注册时就会被拒（规则在解析器里）
      await expect(
        operators.register({
          apiVersion: "mdop/v0.2",
          kind: "wasm",
          id: "rws.disproportionality",
          version: "9.0.0",
          category: "local",
          digest: `sm3:${WASM_SM3}`,
          publisher: "urn:tds:platform",
          inputs: [],
          outputs: [{ name: "o", schema: "s", label_rule: "C3" }],
          params: {},
          environments: ["plain"],
          security: { network: "none" },
          build: {
            source_digest: `sm3:${WASM_SM3}`,
            toolchain: "asc@0.27.37",
            reproducible: true,
          },
        }),
      ).rejects.toThrow(/inherit/);
    });

    it("显式放置越过数据边界 → E_LABEL_VIOLATION 并指出边", async () => {
      const job = await jobs.submit(
        l15Plan({
          stages: [
            {
              id: "srcA",
              op: "source.dataset@1.0.0",
              // 数据在示范甲，却被显式指定放到示范乙 —— 编译期必须拒
              inputs: [{ from: "ds://p-demohospa/dp-1" }],
              params: {},
              at: HOSP_B,
            },
          ],
        }),
      );
      await expect(
        jobs.compile({
          jobId: job.id,
          capabilities: capabilities(),
          jobNotBefore: "2026-09-24T00:00:00.000Z",
          jobNotAfter: "2026-10-24T00:00:00.000Z",
        }),
      ).rejects.toMatchObject({ code: "E_LABEL_VIOLATION" });
      const stored = await jobsRepo.findOne({ where: { id: job.id } });
      expect(stored.status).toBe("REJECTED");
      expect(stored.rejectReason).toMatch(/E_LABEL_VIOLATION/);
    });

    it("降密参数弱于合约发布条件 → E_LABEL_VIOLATION", async () => {
      const plan = l15Plan();
      plan.stages = plan.stages.map((s) =>
        s.id === "decA" ? { ...s, params: { minCell: 3 } } : s,
      );
      const job = await jobs.submit(plan);
      await expect(
        jobs.compile({
          jobId: job.id,
          capabilities: capabilities(),
          jobNotBefore: "2026-09-24T00:00:00.000Z",
          jobNotAfter: "2026-10-24T00:00:00.000Z",
        }),
      ).rejects.toMatchObject({ code: "E_LABEL_VIOLATION" });
    });

    it("节点未通告能力 → E_CAPABILITY_MISMATCH", async () => {
      const job = await jobs.submit(l15Plan());
      const caps = capabilities();
      caps.set(HOSP_A, capability(HOSP_A, { runtime: ["native"] })); // 没有 wasm 运行时
      await expect(
        jobs.compile({
          jobId: job.id,
          capabilities: caps,
          jobNotBefore: "2026-09-24T00:00:00.000Z",
          jobNotAfter: "2026-10-24T00:00:00.000Z",
        }),
      ).rejects.toMatchObject({ code: "E_CAPABILITY_MISMATCH" });
    });

    it("C1/C2 边本期一律 E_CAPABILITY_MISMATCH（节点未通告 TEE/协同协议）", async () => {
      // 用 declassify 之外的路径拿不到 C1/C2，所以直接构造一条 C2 边校验
      expect(() =>
        validateEdge(
          {
            from_stage: "a",
            to_stage: "b",
            label: "C2",
            from_node: HOSP_A,
            to_node: PLATFORM_NODE,
          },
          {
            contract_recipients: [HOSP_A, HOSP_B, PLATFORM_NODE],
            capabilities: capabilities(),
          },
        ),
      ).toThrow(expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }));
    });
  });

  describe("C2 在编译期的放置（任务 5.2）", () => {
    const sealManifest = {
      apiVersion: "mdop/v0.2",
      kind: "system",
      id: "seal.envelope",
      version: "1.0.0",
      category: "seal",
      digest: "component:seal@1",
      publisher: "urn:tds:platform",
      inputs: [
        { name: "data", schema: "mdop.dataset/1.0", accept_labels: ["C0"] },
      ],
      outputs: [{ name: "envelope", schema: "mdop.env/1.0", label_rule: "C2" }],
      params: {},
      environments: ["plain"],
      security: { network: "none" },
      component: "seal@1.0.0",
    };

    /** 带 TEE 节点的能力通告：节点声明链型，并通告封装与降密两个 system 算子。 */
    const capabilitiesWithTee = () =>
      new Map<string, NodeCapability>([
        [
          HOSP_A,
          capability(HOSP_A, {
            system_ops: ["source.dataset@1.0.0", "seal.envelope@1.0.0"],
          }),
        ],
        [HOSP_B, capability(HOSP_B)],
        [
          TEE_NODE,
          capability(TEE_NODE, {
            system_ops: ["declassify.small_cell@1.0.0"],
            tee: { kind: "tdx", min_tcb: "3.1.0" },
          }),
        ],
        [
          PLATFORM_NODE,
          capability(PLATFORM_NODE, {
            system_ops: ["merge.disproportionality@1.0.0"],
          }),
        ],
      ]);

    /** 封存（C0→C2，留在示范甲）→ 在可信空间节点内降密（C2→C3）。 */
    const c2Plan = (): SubmitJobInput => ({
      purpose: "RWS.EFFECTIVENESS",
      applicant: { org: "sponsor", project: "t2dm" },
      contracts: [CONTRACT],
      stages: [
        {
          id: "sealA",
          op: "seal.envelope@1.0.0",
          inputs: [{ from: "ds://p-demohospa/dp-1" }],
          params: {},
        },
        {
          id: "decTee",
          op: "declassify.small_cell@1.0.0",
          inputs: [{ from: "sealA" }],
          params: { minCell: 10 },
          at: TEE_NODE,
        },
      ],
      not_before: "2026-09-24T00:00:00.000Z",
      not_after: "2026-10-24T00:00:00.000Z",
    });

    /** 重新要约一份带证明策略的合约（改条款需重新签署，口径与线上一致）。 */
    const offerWithPolicy = async (
      tee: string[],
      minTcb: Record<string, string>,
    ) => {
      const offer = await contracts.offer(CONTRACT, {
        extraRecipients: [{ party: HOSP_A, role: "final", jurisdiction: "CN" }],
        attestationPolicy: { tee, minTcb },
      });
      await contracts.agree({
        contractId: CONTRACT,
        canonical: offer.canonical,
        holderSignature: sm2Sign(offer.canonical, providerKeys.privateKey, {
          publicKey: providerKeys.publicKey,
        }),
      });
    };

    const attestationService = (withRegistration: boolean) => {
      const svc = new MdopAttestationService(mockRepo() as never, {
        trustedVerifiers: ["kms-1"],
        registryMeasurements: [TEE_MEASUREMENT],
        verifyWarrant: () => true,
      });
      if (withRegistration) {
        void svc.register({
          node: TEE_NODE,
          kind: "tdx",
          measurement: TEE_MEASUREMENT,
          tcb: "3.1.2",
          quoteDigest: "sm3:" + "f".repeat(64),
          verifiedBy: "kms-1",
          verifiedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        });
      }
      return svc;
    };

    it("合约未声明证明策略 → C2 计划编译即拒（E_ATTESTATION_FAILED，作业 REJECTED）", async () => {
      await operators.register(sealManifest, "test");
      const job = await jobs.submit(c2Plan());
      await expect(
        jobs.compile({
          jobId: job.id,
          capabilities: capabilitiesWithTee(),
          jobNotBefore: "2026-09-24T00:00:00.000Z",
          jobNotAfter: "2026-10-24T00:00:00.000Z",
        }),
      ).rejects.toMatchObject({ code: "E_ATTESTATION_FAILED" });
      expect((await jobsRepo.findOne({ where: { id: job.id } })).status).toBe(
        "REJECTED",
      );
    });

    it("合约声明策略但目标节点未登记证明 → 拒（不得「稍后补证明」放行）", async () => {
      await operators.register(sealManifest, "test");
      await offerWithPolicy(["tdx"], { tdx: "3.1.0" });
      const job = await jobs.submit(c2Plan());
      const withAttestation = new MdopJobsService(
        jobsRepo,
        stagesRepo,
        fragmentsRepo,
        operators,
        contracts,
        attestationService(false),
      );
      await expect(
        withAttestation.compile({
          jobId: job.id,
          capabilities: capabilitiesWithTee(),
          jobNotBefore: "2026-09-24T00:00:00.000Z",
          jobNotAfter: "2026-10-24T00:00:00.000Z",
        }),
      ).rejects.toMatchObject({ code: "E_ATTESTATION_FAILED" });
    });

    it("未接入证明登记服务 → C2 一律拒（fail-closed）", async () => {
      await operators.register(sealManifest, "test");
      await offerWithPolicy(["tdx"], { tdx: "3.1.0" });
      const job = await jobs.submit(c2Plan());
      await expect(
        jobs.compile({
          jobId: job.id,
          capabilities: capabilitiesWithTee(),
          jobNotBefore: "2026-09-24T00:00:00.000Z",
          jobNotAfter: "2026-10-24T00:00:00.000Z",
        }),
      ).rejects.toMatchObject({ code: "E_ATTESTATION_FAILED" });
    });

    it("合约策略 + 有效证明登记 → 编译通过，C2 边落在可信空间节点上", async () => {
      await operators.register(sealManifest, "test");
      await offerWithPolicy(["tdx"], { tdx: "3.1.0" });
      const job = await jobs.submit(c2Plan());
      const withAttestation = new MdopJobsService(
        jobsRepo,
        stagesRepo,
        fragmentsRepo,
        operators,
        contracts,
        attestationService(true),
      );
      const compiled = await withAttestation.compile({
        jobId: job.id,
        capabilities: capabilitiesWithTee(),
        jobNotBefore: "2026-09-24T00:00:00.000Z",
        jobNotAfter: "2026-10-24T00:00:00.000Z",
      });
      expect(compiled.job.status).toBe("COMPILED");
      const nodes = compiled.fragments.map((f) => f.node).sort();
      expect(nodes).toContain(TEE_NODE);
      // 目标节点的能力通告里必须有链型（协议 §4.3：C2 目标须声明 TEE 能力）
      const teeFragment = compiled.fragments.find((f) => f.node === TEE_NODE)!;
      expect(teeFragment.stages.some((s) => s.id === "decTee")).toBe(true);
    });

    it("凭证签发：把该节点的执行环境期望冻进核心（各院签的就是「批准在这份代码下执行」）", async () => {
      await operators.register(sealManifest, "test");
      await offerWithPolicy(["tdx"], { tdx: "3.1.0" });
      const attestations = attestationService(true);
      const job = await jobs.submit(c2Plan());
      const withAttestation = new MdopJobsService(
        jobsRepo,
        stagesRepo,
        fragmentsRepo,
        operators,
        contracts,
        attestations,
      );
      const compiled = await withAttestation.compile({
        jobId: job.id,
        capabilities: capabilitiesWithTee(),
        jobNotBefore: "2026-09-24T00:00:00.000Z",
        jobNotAfter: "2026-10-24T00:00:00.000Z",
      });
      expect(compiled.job.status).toBe("COMPILED");

      const tickets = new MdopTicketService(
        gm,
        ca,
        jobsRepo,
        fragmentsRepo,
        stagesRepo,
        mockRepo(),
        mockRepo(),
        outboxRepo,
        certsRepo,
        contracts,
        attestations,
      );
      const offered = await tickets.offerTickets({
        jobId: job.id,
        notBefore: "2026-09-24T00:00:00.000Z",
        notAfter: "2026-10-24T00:00:00.000Z",
      });

      expect(offered.offeredNodes).toContain(TEE_NODE);
      // 期望 = 登记里的链型与度量 + 合约的按链下限
      expect(offered.core.attestation?.[TEE_NODE]).toEqual({
        tee: "tdx",
        measurement: TEE_MEASUREMENT,
        min_tcb: "3.1.0",
      });
      // 没有接收 C2 的节点不写期望（否则会把非 C2 片段拖进 C2 语义）
      expect(Object.keys(offered.core.attestation ?? {})).toEqual([TEE_NODE]);
      // 要约随附**已双签的合约副本**：可信空间节点拿不到 ContractOffer，
      // 缺它就等于让复核去信平台口径（复核必须用自己验过的本地副本）
      const offers = await outboxRepo.find({
        where: { msg_type: "PlanFragmentOffer" },
      });
      expect(offers.length).toBeGreaterThan(0);
      const body = offers[0].body as {
        contracts?: Array<Record<string, unknown>>;
      };
      expect(body.contracts?.[0]?.contract_id).toBe(CONTRACT);
      expect(String(body.contracts?.[0]?.canonical ?? "")).toContain(CONTRACT);
      expect(String(body.contracts?.[0]?.holder_signature ?? "")).not.toBe("");
      expect(
        String(body.contracts?.[0]?.platform_countersignature ?? ""),
      ).not.toBe("");
    });

    it("非 C2 作业的凭证核心不带期望（向后兼容，各院签名口径不变）", async () => {
      const job = await jobs.submit(l15Plan());
      const compiled = await jobs.compile({
        jobId: job.id,
        capabilities: capabilities(),
        jobNotBefore: "2026-09-24T00:00:00.000Z",
        jobNotAfter: "2026-10-24T00:00:00.000Z",
      });
      expect(compiled.job.status).toBe("COMPILED");
      const tickets = new MdopTicketService(
        gm,
        ca,
        jobsRepo,
        fragmentsRepo,
        stagesRepo,
        mockRepo(),
        mockRepo(),
        mockRepo(),
        certsRepo,
        contracts,
        attestationService(true),
      );
      const offered = await tickets.offerTickets({
        jobId: job.id,
        notBefore: "2026-09-24T00:00:00.000Z",
        notAfter: "2026-10-24T00:00:00.000Z",
      });
      expect(offered.core.attestation).toBeUndefined();
    });
  });
});
