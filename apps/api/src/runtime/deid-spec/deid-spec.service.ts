// deid-spec —— 平台签发脱敏规格（openspec/changes/connector-agent-deidentification 任务 3）。
// 决策：D-CN-9 / 控制点：TRUST.md CTL-32。
//
// 职责边界（design §2）：
//   · 平台：签发 DeidSpec（注册中心用途密钥 SM2）、版本单调、吊销、随任务下发；
//   · 平台**不**接触数据、不持盐、不持密钥材料之外的任何执行权；
//   · 连接器：取规格 → 验签 → 版本/时效/吊销 → 降级检测 → 调院内 agent。
//
// 三条硬规矩：
//   1. **规格先过 schema**（`parseDeidSpec`，封闭算子 + 参数上界 + 强制字段），
//      越界/未知算子在这里就拒，不进库；
//   2. **版本单调**：同一 specId 新签版本必须严格大于历史最大版本；
//   3. **签名口径单一**：`medtrust.deid-spec.v1:<sm3>`，与连接器验签同一前缀
//      （`@medtrust/mdop` 的 `deidSpecSignaturePayload`）。
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  DEID_SPEC_VERSION,
  DeidSpecError,
  deidSpecSignaturePayload,
  parseDeidSpec,
  publicKeyKid,
  sm2Verify,
  type DeidSpec,
} from "@medtrust/mdop";
import { DeidSpecEntity, type DeidSpecStatus } from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CaService } from "../participant-identity/ca.service";
import { stableStringify } from "../../common/canonical-json";

/** 平台签发出去的规格包（下发给连接器的最小完备集）。 */
export interface SignedDeidSpec {
  specId: string;
  version: number;
  /** 规范化 JSON 字符串（连接器按同一口径重算 SM3，逐字节比对）。 */
  specJson: string;
  specSm3: string;
  signature: string;
  /** 签名公钥 kid（注册中心用途密钥的公钥 SM3）。 */
  keyId: string;
  issuedAt: string;
  notAfter: string;
  /** 签名载荷口径标识，便于换口径时审计。 */
  signaturePayload: string;
}

/** 随长轮询批次下发的吊销名单（版本单调；连接器只接受更高版本）。 */
export interface DeidSpecRevocationList {
  version: number;
  issuedAt: string;
  revoked: Array<{
    specSm3: string;
    specId: string;
    version: number;
    reason: string;
    revokedAt: string;
    revokedBy: string;
  }>;
}

export interface IssueDeidSpecInput {
  /** 完整规格（未签名）；`version` 必须是 1，spec 版本升级走 code review。 */
  spec: unknown;
  issuedBy: string;
  /** 有效期（天）。缺省 180；上限 365（防"永不过期"的规格长期滞留）。 */
  validDays?: number;
}

export const DEFAULT_DEID_SPEC_VALID_DAYS = 180;
export const MAX_DEID_SPEC_VALID_DAYS = 365;

@Injectable()
export class DeidSpecService {
  private readonly logger = new Logger(DeidSpecService.name);

  constructor(
    @InjectRepository(DeidSpecEntity, "controlplane")
    private readonly specs: Repository<DeidSpecEntity>,
    private readonly ca: CaService,
    private readonly gm: GMCryptoService,
  ) {}

  /** 签发一份规格：schema → 规范化 → SM3 → 注册中心密钥签名 → 落库。 */
  async issue(input: IssueDeidSpecInput): Promise<SignedDeidSpec> {
    let spec: DeidSpec;
    try {
      spec = parseDeidSpec(input.spec);
    } catch (err) {
      if (err instanceof DeidSpecError)
        throw new BadRequestException(`脱敏规格非法(${err.code})：${err.message}`);
      throw err;
    }
    const validDays = Math.floor(
      input.validDays ?? DEFAULT_DEID_SPEC_VALID_DAYS,
    );
    if (!Number.isFinite(validDays) || validDays <= 0 || validDays > MAX_DEID_SPEC_VALID_DAYS) {
      throw new BadRequestException(
        `validDays 必须在 1–${MAX_DEID_SPEC_VALID_DAYS} 之间`,
      );
    }

    // 规范化后的原像：连接器用同一函数重算摘要，任何键序差异都会验签失败。
    const specJson = stableStringify(spec);
    const specSm3 = this.gm.sm3Hash(specJson);

    const previous = await this.specs.find({
      where: { specId: spec.id },
      order: { version: "DESC" },
      take: 1,
    });
    const previousMax = previous[0]?.version ?? 0;
    const version = previousMax + 1;
    // 同摘要重复签发直接拒：换签名不产生新口径，只会制造版本噪声。
    const duplicate = await this.specs.findOne({ where: { specSm3 } });
    if (duplicate) {
      throw new ConflictException(
        `该规格内容已签发过（specSm3=${specSm3.slice(0, 16)}… v${duplicate.version}）；` +
          `改口径请改内容与版本`,
      );
    }

    const issuedAt = new Date().toISOString();
    const notAfter = new Date(
      Date.parse(issuedAt) + validDays * 24 * 3600 * 1000,
    ).toISOString();
    const signature = this.ca.signWith(
      "registry",
      deidSpecSignaturePayload(specSm3),
    );
    const keyId = publicKeyKid(this.ca.publicKeyFor("registry"));

    const row = this.specs.create({
      specId: spec.id,
      version,
      specJson,
      specSm3,
      signature,
      keyId,
      scopeProduct: spec.scope.product,
      scopeLevel: spec.scope.level,
      issuedAt,
      notAfter,
      status: "active",
      issuedBy: input.issuedBy,
    });
    await this.specs.save(row);
    this.logger.log(
      `签发脱敏规格 ${spec.id} v${version} sm3=${specSm3.slice(0, 16)}… by=${input.issuedBy}`,
    );
    return {
      specId: spec.id,
      version,
      specJson,
      specSm3,
      signature,
      keyId,
      issuedAt,
      notAfter,
      signaturePayload: deidSpecSignaturePayload(specSm3),
    };
  }

  /** 吊销一个具体版本（不可恢复；需要新口径就新签一版）。 */
  async revoke(
    specId: string,
    version: number,
    reason: string,
    revokedBy: string,
  ): Promise<DeidSpecEntity> {
    const row = await this.specs.findOne({ where: { specId, version } });
    if (!row) throw new NotFoundException(`脱敏规格不存在：${specId} v${version}`);
    if (row.status === "revoked") return row;
    const trimmed = (reason ?? "").trim();
    if (!trimmed) throw new BadRequestException("吊销必须给出原因（审计用）");
    row.status = "revoked";
    row.revokeReason = trimmed;
    row.revokedBy = revokedBy;
    row.revokedAt = new Date().toISOString();
    await this.specs.save(row);
    this.logger.warn(
      `吊销脱敏规格 ${specId} v${version} by=${revokedBy} reason=${trimmed}`,
    );
    return row;
  }

  /** 某 specId 的版本历史（按版本降序）。 */
  async history(specId: string): Promise<DeidSpecEntity[]> {
    return this.specs.find({ where: { specId }, order: { version: "DESC" } });
  }

  /** 全量列表（管理面，按 specId / 状态过滤）。 */
  async list(filter: { specId?: string; status?: DeidSpecStatus } = {}) {
    const where: Record<string, unknown> = {};
    if (filter.specId) where.specId = filter.specId;
    if (filter.status) where.status = filter.status;
    return this.specs.find({
      where,
      order: { specId: "ASC", version: "DESC" },
    });
  }

  /**
   * 每个 specId 的**当前有效版本**（status=active 的最高版本）。
   * 已吊销/已过期的不下发 —— 连接器拿不到就无法执行，比"下发后拒跑"更早一步。
   */
  async activePackages(now = new Date()): Promise<SignedDeidSpec[]> {
    const rows = await this.specs.find({
      where: { status: "active" },
      order: { specId: "ASC", version: "DESC" },
    });
    // 显式按版本取最大：不依赖数据库返回顺序（SQLite/PG 与 mock 都可能不同）。
    const latest = new Map<string, DeidSpecEntity>();
    for (const row of rows) {
      const current = latest.get(row.specId);
      if (!current || row.version > current.version) latest.set(row.specId, row);
    }
    const packages: SignedDeidSpec[] = [];
    for (const row of latest.values()) {
      if (Date.parse(row.notAfter) <= now.getTime()) {
        this.logger.warn(
          `脱敏规格过期，不下发：${row.specId} v${row.version} notAfter=${row.notAfter}`,
        );
        continue;
      }
      packages.push(toPackage(row));
    }
    return packages;
  }

  /** 吊销名单：版本 = 已吊销条数（只增不减，连接器只接受更高版本）。 */
  async revocationList(): Promise<DeidSpecRevocationList> {
    const revoked = await this.specs.find({
      where: { status: "revoked" },
      order: { revokedAt: "ASC" },
    });
    const list = revoked.map((row) => ({
      specSm3: row.specSm3,
      specId: row.specId,
      version: row.version,
      reason: row.revokeReason ?? "",
      revokedAt: row.revokedAt ?? "",
      revokedBy: row.revokedBy ?? "",
    }));
    return {
      version: list.length,
      issuedAt: new Date().toISOString(),
      revoked: list,
    };
  }

  /** 随长轮询批次下发的载荷（规格 + 吊销名单，一次给全）。 */
  async connectorBatchPayload(): Promise<{
    deidSpecs: SignedDeidSpec[];
    deidRevocations: DeidSpecRevocationList;
  }> {
    const [deidSpecs, deidRevocations] = await Promise.all([
      this.activePackages(),
      this.revocationList(),
    ]);
    return { deidSpecs, deidRevocations };
  }

  /**
   * 自校验：用**部署固定**的注册中心公钥重算并验签（签发后自查，防止自己签错口径）。
   * 生产路径上连接器做同一份校验；这里只是让接口能立刻发现口径漂移。
   */
  verifyPackage(pkg: SignedDeidSpec): boolean {
    const digest = this.gm.sm3Hash(pkg.specJson);
    if (digest !== pkg.specSm3) return false;
    return sm2Verify(
      deidSpecSignaturePayload(pkg.specSm3),
      pkg.signature,
      this.ca.publicKeyFor("registry"),
    );
  }

  /** 规格 schema 版本（下发给连接器做兼容性判断）。 */
  get specSchemaVersion(): number {
    return DEID_SPEC_VERSION;
  }
}

function toPackage(row: DeidSpecEntity): SignedDeidSpec {
  return {
    specId: row.specId,
    version: row.version,
    specJson: row.specJson,
    specSm3: row.specSm3,
    signature: row.signature,
    keyId: row.keyId,
    issuedAt: row.issuedAt,
    notAfter: row.notAfter,
    signaturePayload: deidSpecSignaturePayload(row.specSm3),
  };
}
