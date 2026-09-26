import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { MdopOperatorEntity, ModuleRevocationEntity } from "@medtrust/database";
import {
  canonicalize,
  operatorRefString,
  parseOperatorManifest,
  type OperatorManifest,
  type OperatorRef,
} from "@medtrust/mdop";
import { CaService } from "../runtime/participant-identity/ca.service";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { AlgorithmModuleRegistry } from "../runtime/connector-modules/algorithm-module.registry";

/**
 * MDOP 算子注册中心（D-MDOP-5 / 规格「算子清单」「算子类型」「wasm 算子准入来源」）。
 *
 * 登记时逐条校验（任一不过即拒，fail-closed）：
 *  - `kind` 与类别的约束（`system` 只许 source/declassify/merge；分析逻辑只许 wasm/oci）；
 *  - 非 `declassify` 算子的输出规则必须是 `inherit`；
 *  - `wasm` 算子必须带**可复现构建记录**（digest 来自第三方准入流程，D-CN-5）；
 *  - 除协同算子外 `security.network` 必须是 `none`。
 *
 * 清单由**注册中心密钥**签名（P-CTL-6 的专用算法签名密钥），连接器用部署固定的
 * 注册中心公钥验签后才使用。
 */

/** 算子清单的签名载荷口径（去掉 sig 的清单，JCS）。 */
export const MDOP_OPERATOR_SIGNATURE_PREFIX = "medtrust.mdop.operator.v1";

/** 本期登记的内置 system 算子（source / declassify / merge 三类机制）。 */
export const SYSTEM_OPERATORS: OperatorManifest[] = [
  {
    apiVersion: "mdop/v0.2",
    kind: "system",
    id: "source.dataset",
    version: "1.0.0",
    category: "source",
    digest: "component:connector-datasource@1",
    publisher: "urn:tds:platform",
    inputs: [],
    outputs: [
      { name: "dataset", schema: "mdop.table/1.0", label_rule: "inherit" },
    ],
    params: { uri: { type: "string" } },
    environments: ["plain"],
    security: { network: "none", writes: "artifact_store_only" },
    component: "connector-datasource@1.0.0",
  },
  {
    apiVersion: "mdop/v0.2",
    kind: "system",
    id: "declassify.small_cell",
    version: "1.0.0",
    category: "declassify",
    digest: "component:connector-output-gate@1",
    publisher: "urn:tds:platform",
    inputs: [
      { name: "table", schema: "mdop.table/1.0", accept_labels: ["C0"] },
    ],
    outputs: [{ name: "table", schema: "mdop.table/1.0", label_rule: "C3" }],
    params: { minCell: { type: "int", minimum: 5 } },
    environments: ["plain"],
    security: { network: "none" },
    component: "connector-output-gate@1.0.0",
  },
  {
    apiVersion: "mdop/v0.2",
    kind: "system",
    id: "merge.disproportionality",
    version: "1.0.0",
    category: "merge",
    digest: "component:platform-merge@1",
    publisher: "urn:tds:platform",
    inputs: [
      { name: "table", schema: "mdop.table/1.0", accept_labels: ["C3"] },
    ],
    outputs: [
      { name: "table", schema: "mdop.signals/1.0", label_rule: "inherit" },
    ],
    params: {},
    environments: ["plain"],
    security: { network: "none" },
    component: "platform-merge@1.0.0",
  },
];

export interface RegisterOperatorResult {
  ref: string;
  digest: string;
  signature: { alg: string; kid: string; value: string };
}

@Injectable()
export class MdopOperatorRegistryService implements OnModuleInit {
  private readonly logger = new Logger(MdopOperatorRegistryService.name);

  constructor(
    private readonly gm: GMCryptoService,
    private readonly ca: CaService,
    @InjectRepository(MdopOperatorEntity, "controlplane")
    private readonly operators: Repository<MdopOperatorEntity>,
    @InjectRepository(ModuleRevocationEntity, "controlplane")
    private readonly revocations: Repository<ModuleRevocationEntity>,
    private readonly algorithmModules: AlgorithmModuleRegistry,
  ) {}

  /** 幂等种子：3 个 system 机制算子 + 已入库的 L1.5 wasm 模块。 */
  async onModuleInit(): Promise<void> {
    for (const manifest of SYSTEM_OPERATORS) {
      await this.ensureRegistered(manifest, "seed");
    }
    for (const module of this.algorithmModules.list()) {
      // 现有 L1.5 模块（AssemblyScript / Rust 两份）登记为 wasm 算子；
      // digest 就是**平台复现构建**产出的模块 SM3（D-CN-5）。
      const manifest = this.buildWasmManifest(module);
      await this.ensureRegistered(manifest, "seed:wasm-algorithms");
    }
  }

  private buildWasmManifest(module: {
    analysisType: string;
    sm3: string;
    compiler?: { name: string; version: string };
    operator?: {
      id: string;
      version: string;
      category: string;
      environments: string[];
      inputs: Array<{ name: string; schema: string; accept_labels: string[] }>;
      outputs: Array<{ name: string; schema: string; label_rule: string }>;
    };
  }): OperatorManifest {
    // 有**声明形状**就按它登记（平台模块在构建清单里给出）；没有才退回默认形状
    // （历史/第三方准入模块的清单里没有这一段）。默认形状只适用于「连接器本地统计」，
    // 拿它去登记「节点内协同类算子」会让编译器把它放到医院侧——因此不能用默认兜住一切。
    const declared = module.operator;
    return parseOperatorManifest({
      apiVersion: "mdop/v0.2",
      kind: "wasm",
      id: declared?.id ?? `rws.${module.analysisType}`,
      version: declared?.version ?? "1.0.0",
      category: declared?.category ?? "local",
      digest: `sm3:${module.sm3.toLowerCase()}`,
      publisher: "urn:tds:platform",
      inputs: declared?.inputs ?? [
        { name: "dataset", schema: "mdop.table/1.0", accept_labels: ["C0"] },
      ],
      outputs: declared?.outputs ?? [
        { name: "table", schema: "mdop.table/1.0", label_rule: "inherit" },
      ],
      params: {},
      environments: declared?.environments ?? ["plain"],
      security: { network: "none", writes: "artifact_store_only" },
      // 复现构建记录：工具链锁定 + 可复现（复现不出的摘要进不了这里，见模块注册表装载校验）
      build: {
        source_digest: `sm3:${module.sm3.toLowerCase()}`,
        toolchain: `${module.compiler?.name ?? "unknown"}@${module.compiler?.version ?? "unknown"}`,
        reproducible: true,
      },
    });
  }

  private async ensureRegistered(
    manifest: OperatorManifest,
    by: string,
  ): Promise<RegisterOperatorResult> {
    const ref = operatorRefString({
      id: manifest.id,
      version: manifest.version,
    });
    const existing = await this.operators.findOne({ where: { ref } });
    // 已经登记且摘要一致 → 不动（幂等种子；改摘要必须新版本）
    if (existing && existing.digest === manifest.digest) {
      return { ref, digest: existing.digest, signature: existing.signature };
    }
    if (existing) {
      this.logger.warn(
        `算子 ${ref} 摘要变化（${existing.digest} → ${manifest.digest}）：须发新版本，已跳过重登记`,
      );
      return { ref, digest: existing.digest, signature: existing.signature };
    }
    return this.register(manifest, by);
  }

  /**
   * 登记一份算子清单。清单结构与规则由 `packages/mdop` 的严格解析器强制
   * （缺字段/未定义字段/规则不符一律拒）。
   */
  async register(
    input: unknown,
    by = "unknown",
  ): Promise<RegisterOperatorResult> {
    let manifest: OperatorManifest;
    try {
      manifest = parseOperatorManifest(input);
    } catch (err) {
      throw new BadRequestException(`算子清单非法：${(err as Error).message}`);
    }

    if (manifest.kind === "wasm") {
      // wasm 摘要必须来自复现构建（结构与可复现标记由解析器保证；这里再审「是不是已知的入库摘要」）
      const known = this.algorithmModules
        .list()
        .some(
          (m) =>
            m.sm3.toLowerCase() ===
            manifest.digest.replace(/^sm3:/, "").toLowerCase(),
        );
      if (!known) {
        throw new BadRequestException(
          "wasm 算子的摘要不在平台复现构建产物里：拒绝登记（D-CN-5，复现不出的摘要不得入册）",
        );
      }
    }
    if (manifest.kind === "oci") {
      // 本期不启用：登记也允许入库，但编译期会以 E_CAPABILITY_MISMATCH 拒绝引用。
      this.logger.warn(
        `登记 oci 算子 ${manifest.id}@${manifest.version}（本期编译期不使用）`,
      );
    }

    const ref = operatorRefString({
      id: manifest.id,
      version: manifest.version,
    });
    const signature = this.signManifest(manifest);
    await this.operators.save(
      this.operators.create({
        ref,
        opId: manifest.id,
        version: manifest.version,
        kind: manifest.kind,
        category: manifest.category,
        digest: manifest.digest,
        manifest: manifest as unknown as Record<string, unknown>,
        signature,
        registeredBy: by,
      }),
    );
    return { ref, digest: manifest.digest, signature };
  }

  /**
   * 注册中心密钥签名（连接器用注册中心公钥验）。签名内容是**清单对象本身**
   * （实现内部做 JCS + SM3）——与信封、凭证、吊销名单同一口径。
   */
  signManifest(manifest: OperatorManifest) {
    return this.ca.signObjectWith("registry", manifest);
  }

  /** 与本服务同一套签名/验签口径（供测试与连接器侧对拍）。 */
  verifyManifest(manifest: OperatorManifest, signature: unknown): boolean {
    return this.ca.verifyObjectWith("registry", manifest, signature);
  }

  list(): Promise<MdopOperatorEntity[]> {
    return this.operators.find({ order: { ref: "ASC" } });
  }

  async find(ref: OperatorRef): Promise<MdopOperatorEntity | null> {
    return this.operators.findOne({
      where: { ref: operatorRefString(ref) },
    });
  }

  /** 随长轮询下发的清单集合（连接器复核/执行时用本地白名单 + 这里的清单核验）。 */
  async manifestPayload(): Promise<
    Array<{
      ref: string;
      digest: string;
      manifest: Record<string, unknown>;
      signature: { alg: string; kid: string; value: string };
    }>
  > {
    const rows = await this.list();
    return rows.map((r) => ({
      ref: r.ref,
      digest: r.digest,
      manifest: r.manifest,
      signature: r.signature,
    }));
  }

  /**
   * 当前吊销名单的版本与摘要集（供签名后随长轮询下发）。
   * 版本取 `cp_module_revocation.listVersion` 的最大值：吊销动作不变，签署密钥改成平台节点密钥。
   */
  async revocationSnapshot(): Promise<{
    version: number;
    revoked_digests: string[];
  }> {
    const rows = await this.revocations.find();
    const version = rows.reduce(
      (max, r) => Math.max(max, r.listVersion ?? 1),
      0,
    );
    return {
      version,
      revoked_digests: rows.map((r) => `sm3:${r.sm3.toLowerCase()}`),
    };
  }
}
