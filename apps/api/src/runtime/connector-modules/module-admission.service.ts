// third-party-module-admission —— 控制面准入服务（D-CN-5 / P-CTL-7，task 6.1）。
//
// 一条源码提交在这里走完五道闸:
//   submitted →(闸 2 复现构建 + 平台签名)→ built →(闸 3 沙箱动态测试)→ tested
//            →(闸 4 影子发布)→ shadow → canary → active,任何一步可 rejected/revoked。
//
// 三条硬规矩:
//   · **源码不入库**:保密审查通道(design D6)下只存 sourceRef 与摘要;
//     对医院公开的只有「模块 SM3 + 平台审查背书」。
//   · **不设 Tier C**:SM3 必须由平台从源码复现产出 —— 复现不出即无法入册,
//     不透明二进制结构性地进不来,而不是靠一条政策拒绝。
//   · **不得跳闸**:晋级顺序由 canPromote 判定,影子不过不晋级。
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  ModuleAdmissionEntity,
  ModuleAdmissionStatus,
  ModuleRevocationEntity,
} from "@medtrust/database";
import {
  StaticGateError,
  canPromote,
  isAdmissionTier,
  isSourceLanguage,
  staticGate,
  type AdmissionTier,
  type RevocationList,
  type ReviewAttestation,
  type SourceLanguage,
} from "@medtrust/wasm-algorithms";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CaService } from "../participant-identity/ca.service";

const execFileAsync = promisify(execFile);

export interface SubmitModuleSourceRequest {
  analysisType: string;
  tier: AdmissionTier;
  language: SourceLanguage;
  submittedBy: string;
  /** 源码位置引用（保密提交下平台内部可达即可；源码不入库、不外发）。 */
  sourceRef: string;
  /** NDA 保密提交：源码不公开，对医院只公开 SM3 + 背书。 */
  confidential?: boolean;
}

/** 闸 2 构建结果（由 admit-cli 另起进程产出，API 只消费）。 */
export interface ReproducibleBuildResult {
  ok: boolean;
  sm3?: string;
  sizeBytes?: number;
  language?: SourceLanguage;
  toolchain?: Record<string, unknown>;
  staticGate?: Record<string, unknown>;
  reproducibleBuildRef?: string;
  reason?: string;
  error?: string;
}

/** 一个独立构建器交上来的产物（api 自己重算 SM3，不信任提交方声称的值）。 */
export interface SubmittedBuild {
  /** 构建器标识（哪台机器 / 哪个 CI job 产出的——用于追溯，不参与判定）。 */
  builderId: string;
  /** 产物字节（base64）。 */
  wasmBase64: string;
  /** 该构建器使用的工具链配方（留痕）。 */
  toolchain?: Record<string, unknown>;
  /** 闸 0 源码预检报告（构建环境在编译前跑的那一份）。 */
  sourceGate?: Record<string, unknown>;
}

/** 构建执行体的注入点（**仅本地开发/单机 demo**，见 localBuildAllowed）。 */
export interface ModuleBuilder {
  build(
    sourceRef: string,
    analysisType: string,
    language: SourceLanguage,
  ): Promise<ReproducibleBuildResult>;
}

export function wasmAlgorithmsRoot(): string {
  return (
    process.env.WASM_ALGORITHMS_ROOT?.trim() ||
    resolve(__dirname, "../../../../../packages/wasm-algorithms")
  );
}

/**
 * 是否允许 api 进程**自己**触发构建。缺省 **false**。
 *
 * 理由（信任边界）：`cargo build` 会执行第三方的 `build.rs` / proc-macro，是闸 1 与
 * 闸 3 都不覆盖的编译期执行点。让对外提供 HTTP 的控制面容器去跑它，等于把准入闸最
 * 薄弱的一环安在最不该安的地方；而「api 调 docker run 去隔离」更糟——挂 docker.sock
 * 等同把宿主 root 交给 api 容器。
 *
 * 生产路径因此是：构建在**独立构建环境**（有 docker 的运维/CI）里完成 → 把 ≥2 份
 * 独立构建器的产物字节提交给 api → **api 自己**重算 SM3、比对、过闸 1、签名。
 * api 不执行任何不可信代码，但所有判定都由 api 自己做（纯读字节，零风险）。
 */
export function localBuildAllowed(): boolean {
  return (
    (process.env.MODULE_LOCAL_BUILD_ALLOWED ?? "").trim().toLowerCase() ===
    "true"
  );
}

/** 本地构建器：另起进程跑 admit-cli（其内部再用隔离容器编译）。仅开发/单机 demo。 */
export class CliModuleBuilder implements ModuleBuilder {
  async build(
    sourceRef: string,
    analysisType: string,
    language: SourceLanguage,
  ): Promise<ReproducibleBuildResult> {
    const root = wasmAlgorithmsRoot();
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "scripts/admit-cli.mjs",
          "--source",
          sourceRef,
          "--analysis-type",
          analysisType,
          "--language",
          language,
        ],
        { cwd: root, maxBuffer: 8 * 1024 * 1024 },
      );
      return JSON.parse(stdout.trim().split("\n").pop() ?? "{}");
    } catch (err) {
      const e = err as { stdout?: string; message?: string };
      const last = e.stdout?.trim().split("\n").pop();
      if (last) {
        try {
          return JSON.parse(last);
        } catch {
          /* 落到下面的通用失败 */
        }
      }
      return { ok: false, reason: "build-failed", error: e.message };
    }
  }
}

@Injectable()
export class ModuleAdmissionService {
  private readonly logger = new Logger(ModuleAdmissionService.name);
  /** 吊销名单版本：每次吊销 +1，连接器只接受更高版本（防回放）。 */
  private builder: ModuleBuilder = new CliModuleBuilder();

  constructor(
    @InjectRepository(ModuleAdmissionEntity, "controlplane")
    private readonly admissions: Repository<ModuleAdmissionEntity>,
    @InjectRepository(ModuleRevocationEntity, "controlplane")
    private readonly revocations: Repository<ModuleRevocationEntity>,
    private readonly ca: CaService,
    private readonly gm: GMCryptoService,
  ) {}

  /** 测试/离线环境替换构建执行体。 */
  useBuilder(builder: ModuleBuilder): void {
    this.builder = builder;
  }

  // ── 提交（闸 0：语言白名单 + 层级校验，在编译之前就拒）────────────────────

  async submit(req: SubmitModuleSourceRequest): Promise<ModuleAdmissionEntity> {
    if (!req.analysisType?.trim()) {
      throw new BadRequestException("缺少 analysisType");
    }
    if (!isAdmissionTier(req.tier)) {
      throw new BadRequestException(
        "准入层级只允许 A（平台自研源码）/ B（第三方源码、平台构建）——不设 Tier C",
      );
    }
    if (!isSourceLanguage(req.language)) {
      throw new BadRequestException(
        "源码语言只支持 Rust / AssemblyScript；其它语言或产物在提交环节即拒（D-CN-5）",
      );
    }
    if (!req.sourceRef?.trim()) {
      throw new BadRequestException(
        "缺少源码引用 —— 只交二进制无法复现出 SM3，MUST 拒绝入册（不设 Tier C）",
      );
    }
    const row = this.admissions.create({
      admissionId: randomUUID(),
      analysisType: req.analysisType.trim(),
      tier: req.tier,
      language: req.language,
      submittedBy: req.submittedBy,
      sourceRef: req.sourceRef.trim(),
      confidential: req.confidential ?? false,
      status: "submitted",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await this.admissions.save(row);
    this.logger.log(
      `模块准入已受理 ${row.admissionId.slice(0, 8)} type=${row.analysisType} ` +
        `tier=${row.tier} lang=${row.language} confidential=${row.confidential}`,
    );
    return row;
  }

  // ── 闸 2：复现构建 + 平台 SM2 签名入册 ───────────────────────────────────

  /**
   * **生产路径**：接收独立构建环境交上来的 ≥2 份构建产物，由 **api 自己**判定。
   *
   * api 不信任提交方声称的 SM3：自己对字节重算 SM3 → 要求各份**全部相同**
   * （这就是「两个独立构建器复现一致」）→ 自己跑闸 1 静态白名单 → CA 签名。
   * 整条路径上 api 只读字节、不执行任何被提交的内容。
   */
  async attestBuild(
    admissionId: string,
    reviewer: string,
    builds: SubmittedBuild[],
  ): Promise<ModuleAdmissionEntity> {
    const row = await this.require(admissionId);
    if (row.status !== "submitted") {
      throw new BadRequestException(
        `只有 submitted 状态可入册构建产物，当前 ${row.status}`,
      );
    }
    if (!Array.isArray(builds) || builds.length < 2) {
      throw new BadRequestException(
        "复现构建需要**至少两份独立构建器**的产物（一份无法证明可复现）",
      );
    }
    const builderIds = new Set(builds.map((b) => (b.builderId ?? "").trim()));
    if (builderIds.has("") || builderIds.size !== builds.length) {
      throw new BadRequestException(
        "每份产物必须带**互不相同**的 builderId（同一构建器交两遍不构成复现）",
      );
    }

    // api 自算 SM3：不看提交方说什么。
    const digests: Array<{ builderId: string; sm3: string; bytes: Buffer }> =
      [];
    for (const b of builds) {
      let bytes: Buffer;
      try {
        bytes = Buffer.from(b.wasmBase64 ?? "", "base64");
      } catch {
        return this.reject(row, `构建产物 ${b.builderId} 的 base64 解码失败`);
      }
      if (bytes.length === 0) {
        return this.reject(row, `构建产物 ${b.builderId} 为空`);
      }
      digests.push({
        builderId: b.builderId,
        sm3: this.gm.sm3HashBytes(new Uint8Array(bytes)),
        bytes,
      });
    }
    const [head, ...rest] = digests;
    const mismatch = rest.find((d) => d.sm3 !== head.sm3);
    if (mismatch) {
      return this.reject(
        row,
        `不可复现构建：${head.builderId}=${head.sm3} ≠ ` +
          `${mismatch.builderId}=${mismatch.sm3} —— 拒绝入册，不予签名`,
      );
    }

    // 闸 1 由 api 自己跑（纯读字节）。
    let gate: ReturnType<typeof staticGate>;
    try {
      gate = staticGate(new Uint8Array(head.bytes));
    } catch (err) {
      const reason =
        err instanceof StaticGateError ? err.reason : "static-gate";
      return this.reject(
        row,
        `闸 1 静态白名单未通过[${reason}]：${(err as Error).message}`,
      );
    }

    row.sm3 = head.sm3;
    row.sizeBytes = head.bytes.length;
    row.toolchain = {
      ...(builds[0].toolchain ?? {}),
      builders: digests.map((d) => d.builderId),
    };
    row.staticGate = gate as unknown as Record<string, unknown>;
    row.reproducibleBuildRef = `repro:${row.language}:${digests.map((d) => d.builderId).join("+")}:${head.sm3}`;
    row.review = this.buildReview(row, reviewer) as unknown as Record<
      string,
      unknown
    >;
    this.logger.log(
      `构建产物已入册 ${row.admissionId.slice(0, 8)} sm3=${head.sm3.slice(0, 16)}… ` +
        `builders=${digests.map((d) => d.builderId).join(",")}`,
    );
    return this.advance(row, "built");
  }

  /** 平台审查背书（含 CA 对模块 SM3 的 SM2 签名）。 */
  private buildReview(
    row: ModuleAdmissionEntity,
    reviewer: string,
  ): ReviewAttestation {
    const sm3 = row.sm3 as string;
    return {
      reviewer,
      reviewedAt: new Date().toISOString(),
      reproducibleBuildRef: row.reproducibleBuildRef ?? `repro:${sm3}`,
      confidential: row.confidential,
      signature: this.ca.signModuleDigest(sm3),
    };
  }

  /**
   * **仅本地开发 / 单机 demo**：由 api 进程自己触发构建。
   * 缺省禁用（见 localBuildAllowed 的理由）；生产走 attestBuild。
   */
  async triggerBuild(
    admissionId: string,
    reviewer: string,
  ): Promise<ModuleAdmissionEntity> {
    if (!localBuildAllowed()) {
      throw new BadRequestException(
        "控制面不自行编译第三方代码（build.rs / proc-macro 是编译期执行点）。" +
          "请在独立构建环境跑 `node scripts/admit-cli.mjs` 后，用 " +
          "POST /module-admission/submissions/:id/attest-build 提交 ≥2 份产物；" +
          "本地开发可设 MODULE_LOCAL_BUILD_ALLOWED=true 启用本接口",
      );
    }
    const row = await this.require(admissionId);
    if (row.status !== "submitted") {
      throw new BadRequestException(
        `只有 submitted 状态可触发构建，当前 ${row.status}`,
      );
    }
    const result = await this.builder.build(
      row.sourceRef,
      row.analysisType,
      row.language,
    );
    if (!result.ok || !result.sm3) {
      return this.reject(
        row,
        `复现构建失败[${result.reason ?? "unknown"}]：${result.error ?? "无详情"}`,
      );
    }

    row.sm3 = result.sm3.toLowerCase();
    row.sizeBytes = result.sizeBytes ?? null;
    row.toolchain = (result.toolchain as Record<string, unknown>) ?? null;
    row.staticGate = (result.staticGate as Record<string, unknown>) ?? null;
    row.reproducibleBuildRef = result.reproducibleBuildRef ?? null;
    row.review = this.buildReview(row, reviewer) as unknown as Record<
      string,
      unknown
    >;
    return this.advance(row, "built");
  }

  // ── 闸 3 / 闸 4：动态测试与影子发布 ──────────────────────────────────────

  /** 记录闸 3 动态测试结果。任一子项不过即 rejected（不得跳闸）。 */
  async recordDynamicGate(
    admissionId: string,
    report: {
      consistency: boolean;
      determinism: boolean;
      resourceLimits: boolean;
      antiExfiltration: boolean;
      fuzz: boolean;
      detail?: Record<string, unknown>;
    },
  ): Promise<ModuleAdmissionEntity> {
    const row = await this.require(admissionId);
    if (row.status !== "built") {
      throw new BadRequestException(
        `只有 built 状态可记录动态测试，当前 ${row.status}`,
      );
    }
    row.dynamicGate = report as unknown as Record<string, unknown>;
    const failed = Object.entries(report)
      .filter(([k, v]) => k !== "detail" && v === false)
      .map(([k]) => k);
    if (failed.length > 0) {
      return this.reject(row, `闸 3 动态测试未通过：${failed.join(", ")}`);
    }
    return this.advance(row, "tested");
  }

  /** 进入影子发布（只算不发结果；首院 DPO 可查验）。 */
  async startShadow(
    admissionId: string,
    shadow: { providerId: string; startedAt?: string },
  ): Promise<ModuleAdmissionEntity> {
    const row = await this.require(admissionId);
    if (!canPromote(row.status, "shadow")) {
      throw new BadRequestException(
        `当前状态 ${row.status} 不得进入影子（不得跳闸）`,
      );
    }
    row.shadow = {
      providerId: shadow.providerId,
      startedAt: shadow.startedAt ?? new Date().toISOString(),
      clean: null,
    };
    return this.advance(row, "shadow");
  }

  /** 影子比对结论。干净才可晋级 canary；不干净即 rejected（不过不晋级）。 */
  async concludeShadow(
    admissionId: string,
    verdict: { clean: boolean; reviewedBy: string; detail?: string },
  ): Promise<ModuleAdmissionEntity> {
    const row = await this.require(admissionId);
    if (row.status !== "shadow") {
      throw new BadRequestException(
        `只有 shadow 状态可作影子结论，当前 ${row.status}`,
      );
    }
    row.shadow = {
      ...((row.shadow as Record<string, unknown>) ?? {}),
      clean: verdict.clean,
      reviewedBy: verdict.reviewedBy,
      concludedAt: new Date().toISOString(),
      ...(verdict.detail ? { detail: verdict.detail } : {}),
    };
    if (!verdict.clean) {
      return this.reject(
        row,
        `影子比对不干净（${verdict.detail ?? "与参考不一致或资源/输出异常"}），不予晋级`,
      );
    }
    return this.advance(row, "canary");
  }

  /** canary → 全量。 */
  async promoteToActive(admissionId: string): Promise<ModuleAdmissionEntity> {
    const row = await this.require(admissionId);
    if (!canPromote(row.status, "active")) {
      throw new BadRequestException(
        `当前状态 ${row.status} 不得直接全量（影子/灰度不过不晋级）`,
      );
    }
    return this.advance(row, "active");
  }

  // ── 闸 5：吊销 ──────────────────────────────────────────────────────────

  async revoke(
    sm3: string,
    input: { reason: string; revokedBy: string; detail?: string },
  ): Promise<ModuleRevocationEntity> {
    const key = (sm3 ?? "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      throw new BadRequestException("吊销需提供合法的模块 SM3（64 hex）");
    }
    const version = (await this.currentListVersion()) + 1;
    const row = this.revocations.create({
      sm3: key,
      reason: input.reason,
      revokedAt: new Date(),
      revokedBy: input.revokedBy,
      detail: input.detail ?? null,
      listVersion: version,
    });
    await this.revocations.save(row);
    // 同 SM3 的准入记录一并置 revoked（界面/接口口径一致）。
    const affected = await this.admissions.find({ where: { sm3: key } });
    for (const a of affected) {
      a.status = "revoked";
      a.rejectionReason = `已吊销：${input.reason}`;
      a.updatedAt = new Date();
    }
    if (affected.length) await this.admissions.save(affected);
    this.logger.warn(
      `模块已吊销 sm3=${key.slice(0, 16)}… reason=${input.reason} by=${input.revokedBy} listVersion=${version}`,
    );
    return row;
  }

  /** 下发给连接器的吊销名单（随长轮询批次带下去）。 */
  async revocationList(): Promise<RevocationList> {
    const rows = await this.revocations.find();
    const version = rows.reduce((max, r) => Math.max(max, r.listVersion), 0);
    return {
      version,
      issuedAt: new Date().toISOString(),
      revoked: rows.map((r) => ({
        sm3: r.sm3,
        reason: r.reason as RevocationList["revoked"][number]["reason"],
        revokedAt: r.revokedAt.toISOString(),
        revokedBy: r.revokedBy,
        ...(r.detail ? { detail: r.detail } : {}),
      })),
    };
  }

  async isRevoked(sm3: string): Promise<boolean> {
    const key = (sm3 ?? "").toLowerCase();
    return (await this.revocations.count({ where: { sm3: key } })) > 0;
  }

  // ── 查询 ────────────────────────────────────────────────────────────────

  async get(admissionId: string): Promise<ModuleAdmissionEntity> {
    return this.require(admissionId);
  }

  async list(filter?: {
    analysisType?: string;
    status?: ModuleAdmissionStatus;
  }): Promise<ModuleAdmissionEntity[]> {
    const where: Record<string, unknown> = {};
    if (filter?.analysisType) where.analysisType = filter.analysisType;
    if (filter?.status) where.status = filter.status;
    return this.admissions.find({
      where: Object.keys(where).length ? (where as never) : {},
    });
  }

  /** 按 SM3 取「已入册且可用」的准入记录（供合约固定条款校验）。 */
  async findBySm3(sm3: string): Promise<ModuleAdmissionEntity | null> {
    return this.admissions.findOne({
      where: { sm3: (sm3 ?? "").toLowerCase() },
    });
  }

  /**
   * 对医院公开的模块视图 —— **源码永不出现在这里**（design D6）。
   * 保密提交只公开 SM3 + 审查背书；sourceRef 是平台内部引用，不外发。
   */
  async publicView(sm3: string): Promise<{
    analysisType: string;
    sm3: string;
    tier: AdmissionTier;
    language: SourceLanguage;
    status: ModuleAdmissionStatus;
    review: Record<string, unknown> | null;
    confidential: boolean;
  } | null> {
    const row = await this.findBySm3(sm3);
    if (!row || !row.sm3) return null;
    return {
      analysisType: row.analysisType,
      sm3: row.sm3,
      tier: row.tier,
      language: row.language,
      status: row.status,
      review: row.review ?? null,
      confidential: row.confidential,
    };
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  private async require(admissionId: string): Promise<ModuleAdmissionEntity> {
    const row = await this.admissions.findOne({ where: { admissionId } });
    if (!row) throw new NotFoundException("准入记录不存在");
    return row;
  }

  private async advance(
    row: ModuleAdmissionEntity,
    to: ModuleAdmissionStatus,
  ): Promise<ModuleAdmissionEntity> {
    if (!canPromote(row.status, to)) {
      throw new BadRequestException(
        `不得从 ${row.status} 跳到 ${to}（准入不得跳闸）`,
      );
    }
    row.status = to;
    row.updatedAt = new Date();
    await this.admissions.save(row);
    this.logger.log(
      `模块准入晋级 ${row.admissionId.slice(0, 8)} → ${to} sm3=${row.sm3?.slice(0, 16) ?? "—"}`,
    );
    return row;
  }

  private async reject(
    row: ModuleAdmissionEntity,
    reason: string,
  ): Promise<ModuleAdmissionEntity> {
    row.status = "rejected";
    row.rejectionReason = reason;
    row.updatedAt = new Date();
    await this.admissions.save(row);
    this.logger.warn(`模块准入被拒 ${row.admissionId.slice(0, 8)}：${reason}`);
    return row;
  }

  private async currentListVersion(): Promise<number> {
    const rows = await this.revocations.find();
    return rows.reduce((max, r) => Math.max(max, r.listVersion), 0);
  }
}
