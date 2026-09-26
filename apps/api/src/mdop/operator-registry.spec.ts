import { BadRequestException } from "@nestjs/common";
import {
  generateSm2KeyPair,
  parseOperatorManifest,
  signRevocationList,
  verifyRevocationList,
} from "@medtrust/mdop";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { CaService } from "../runtime/participant-identity/ca.service";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import { AlgorithmModuleRegistry } from "../runtime/connector-modules/algorithm-module.registry";
import {
  MdopOperatorRegistryService,
  SYSTEM_OPERATORS,
} from "./operator-registry.service";
import { MdopRevocationService } from "./revocation.service";

const WASM_SM3 = "b".repeat(64);

/** 假的模块注册表：只提供一条已入库的 L1.5 模块（复现构建产物的替身）。 */
function fakeAlgorithmModules(): AlgorithmModuleRegistry {
  return {
    list: () => [
      {
        analysisType: "disproportionality",
        file: "disproportionality.wasm",
        abiVersion: 1,
        sm3: WASM_SM3,
        compiler: { name: "assemblyscript", version: "0.27.37" },
      },
    ],
  } as unknown as AlgorithmModuleRegistry;
}

describe("MDOP 算子注册中心（D-MDOP-5 / 任务 6.1-6.2、6.4）", () => {
  let gm: GMCryptoService;
  let ca: CaService;
  let operators: ReturnType<typeof mockRepo>;
  let revocations: ReturnType<typeof mockRepo>;
  let svc: MdopOperatorRegistryService;
  let revocationSvc: MdopRevocationService;

  beforeEach(async () => {
    delete process.env.NODE_ENV;
    delete process.env.PLATFORM_KEK;
    gm = new GMCryptoService();
    ca = new CaService(gm, mockRepo(), mockRepo(), "sh-med");
    await ca.onModuleInit();
    operators = mockRepo();
    revocations = mockRepo();
    svc = new MdopOperatorRegistryService(
      gm,
      ca,
      operators,
      revocations,
      fakeAlgorithmModules(),
    );
    revocationSvc = new MdopRevocationService(ca, svc);
  });

  it("种子：3 个 system 机制算子 + 已入库的 L1.5 wasm 模块", async () => {
    await svc.onModuleInit();
    const rows = await svc.list();
    const refs = rows.map((r: { ref: string }) => r.ref).sort();
    expect(refs).toEqual([
      "declassify.small_cell@1.0.0",
      "merge.disproportionality@1.0.0",
      "rws.disproportionality@1.0.0",
      "source.dataset@1.0.0",
    ]);
    const wasm = rows.find(
      (r: { ref: string }) => r.ref === "rws.disproportionality@1.0.0",
    );
    expect(wasm.kind).toBe("wasm");
    expect(wasm.digest).toBe(`sm3:${WASM_SM3}`);
    // 清单签名可用注册中心公钥验过，且**不能**用平台节点公钥或 CA 根钥验（用途互斥）
    // 库里存的是清单原文，取回来按清单对象验签
    const manifest = parseOperatorManifest(wasm.manifest);
    expect(svc.verifyManifest(manifest, wasm.signature)).toBe(true);
    expect(ca.verifyObjectWith("platform-node", manifest, wasm.signature)).toBe(
      false,
    );
    expect(ca.verifyObjectWith("certificate", manifest, wasm.signature)).toBe(
      false,
    );
  });

  it("模块**声明形状**优先于默认形状：节点内协同算子不得被冒充成本地统计算子", async () => {
    const declared = {
      analysisType: "paired-cohort",
      file: "paired-cohort.wasm",
      abiVersion: 1,
      sm3: "c".repeat(64),
      compiler: { name: "assemblyscript", version: "0.27.37" },
      operator: {
        id: "rws.paired-cohort",
        version: "1.0.0",
        category: "collab",
        environments: ["tee"],
        inputs: [
          {
            name: "left",
            schema: "mdop.projection/1.0",
            accept_labels: ["C2"],
          },
          {
            name: "right",
            schema: "mdop.projection/1.0",
            accept_labels: ["C2"],
          },
        ],
        outputs: [
          {
            name: "paired",
            schema: "rws.paired-cohort/1.0",
            label_rule: "inherit",
          },
        ],
      },
    };
    const legacy = {
      analysisType: "legacy-scan",
      file: "legacy-scan.wasm",
      abiVersion: 1,
      sm3: "d".repeat(64),
      compiler: { name: "assemblyscript", version: "0.27.37" },
    };
    const svc2 = new MdopOperatorRegistryService(
      gm,
      ca,
      mockRepo(),
      mockRepo(),
      {
        list: () => [declared, legacy],
      } as unknown as AlgorithmModuleRegistry,
    );
    await svc2.onModuleInit();
    const rows = await svc2.list();

    const paired = rows.find(
      (r: { ref: string }) => r.ref === "rws.paired-cohort@1.0.0",
    );
    expect(paired).toBeDefined();
    const pairedManifest = parseOperatorManifest(paired.manifest);
    expect(pairedManifest.category).toBe("collab");
    expect(pairedManifest.environments).toEqual(["tee"]);
    expect(pairedManifest.inputs.map((i) => i.accept_labels).flat()).toEqual([
      "C2",
      "C2",
    ]);

    // 没有声明形状的模块（历史/第三方准入）仍走默认：连接器本地统计
    const fallback = rows.find(
      (r: { ref: string }) => r.ref === "rws.legacy-scan@1.0.0",
    );
    const fallbackManifest = parseOperatorManifest(fallback.manifest);
    expect(fallbackManifest.category).toBe("local");
    expect(fallbackManifest.environments).toEqual(["plain"]);
  });

  it("登记被拒：非降密算子声明固定输出等级 / system 算子当分析算子用 / network 不是 none", async () => {
    const base = {
      apiVersion: "mdop/v0.2",
      kind: "system",
      id: "x",
      version: "1.0.0",
      category: "source",
      digest: "component:x@1",
      publisher: "urn:tds:platform",
      inputs: [],
      outputs: [{ name: "o", schema: "s", label_rule: "inherit" }],
      params: {},
      environments: ["plain"],
      security: { network: "none" },
      component: "x@1.0.0",
    };
    await expect(
      svc.register({
        ...base,
        outputs: [{ name: "o", schema: "s", label_rule: "C3" }],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(svc.register({ ...base, category: "local" })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      svc.register({ ...base, security: { network: "egress" } }),
    ).rejects.toThrow(BadRequestException);
  });

  it("登记被拒：wasm 摘要不在复现构建产物里（D-CN-5）", async () => {
    const manifest = parseOperatorManifest({
      apiVersion: "mdop/v0.2",
      kind: "wasm",
      id: "rws.unknown",
      version: "1.0.0",
      category: "local",
      digest: `sm3:${"c".repeat(64)}`,
      publisher: "urn:tds:platform",
      inputs: [],
      outputs: [{ name: "o", schema: "s", label_rule: "inherit" }],
      params: {},
      environments: ["plain"],
      security: { network: "none" },
      build: {
        source_digest: `sm3:${"c".repeat(64)}`,
        toolchain: "asc@0.27.37",
        reproducible: true,
      },
    });
    await expect(svc.register(manifest)).rejects.toThrow(/复现构建/);
  });

  it("登记通过：已入库摘要的 wasm 算子可登记，且带复现构建记录", async () => {
    const manifest = parseOperatorManifest({
      apiVersion: "mdop/v0.2",
      kind: "wasm",
      id: "rws.disproportionality",
      version: "2.0.0",
      category: "local",
      digest: `sm3:${WASM_SM3}`,
      publisher: "urn:tds:platform",
      inputs: [],
      outputs: [{ name: "o", schema: "s", label_rule: "inherit" }],
      params: {},
      environments: ["plain"],
      security: { network: "none" },
      build: {
        source_digest: `sm3:${"d".repeat(64)}`,
        toolchain: "asc@0.27.37",
        reproducible: true,
      },
    });
    const out = await svc.register(manifest, "reviewer zhang");
    expect(out.ref).toBe("rws.disproportionality@2.0.0");
    expect(svc.verifyManifest(manifest, out.signature)).toBe(true);
  });

  it("吊销名单：平台节点密钥签、版本单调、可被连接器侧同一实现验过", async () => {
    await revocations.save(
      revocations.create({
        sm3: WASM_SM3,
        reason: "误报",
        revokedAt: new Date(),
        revokedBy: "ops",
        listVersion: 2,
      }),
    );
    const list = await revocationSvc.signedList();
    expect(list).toBeDefined();
    expect(list!.version).toBe(2);
    expect(list!.revoked_digests).toEqual([`sm3:${WASM_SM3}`]);
    // 平台节点公钥验得过（连接器侧用的是同一份 packages/mdop 实现）
    expect(verifyRevocationList(list!, ca.platformNodePublicKey)).toBe(true);
    expect(revocationSvc.verify(list!)).toBe(true);
    // 用注册中心公钥 / CA 根钥验不过
    expect(verifyRevocationList(list!, ca.registryPublicKey)).toBe(false);
    expect(verifyRevocationList(list!, ca.caPublicKey)).toBe(false);
  });

  it("吊销名单签名不能用别的密钥伪造", () => {
    const other = generateSm2KeyPair();
    const forged = signRevocationList(
      { version: 9, issued_at: new Date().toISOString(), revoked_digests: [] },
      other.privateKey,
      other.publicKey,
    );
    expect(verifyRevocationList(forged, ca.platformNodePublicKey)).toBe(false);
  });

  it("system 算子清单里携带组件构建版本（系统机制也有可追溯标识）", () => {
    const declassify = SYSTEM_OPERATORS.find(
      (o) => o.id === "declassify.small_cell",
    )!;
    expect(declassify.component).toBeTruthy();
    expect(declassify.outputs[0].label_rule).toBe("C3");
    expect(declassify.category).toBe("declassify");
  });
});
