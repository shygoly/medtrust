// deid-dictionary —— 脱敏词表的**摘要背书**（connector-agent-deidentification Phase 2）。
//
// 职责边界（与盐同向，D-CN-9）：
//   · 医院持有词表内容（姓名表/术语表），只把 `{id, version, sm3, byteSize}` 报给平台；
//   · 平台**不看内容**，只签「这份摘要就是我审查过的第 N 版」（registry 用途密钥）；
//   · 连接器验签随批次下发，agent 按 `dictionaryRef` 读本院文件并核对摘要，不符即 DENIED。
//
// 三条硬规矩：
//   1. 版本单调：同 dictionaryId 新签版本必须严格大于历史最大版本；
//   2. 同摘要不重复签发（换签名不产生新口径，只制造版本噪声）；
//   3. 摘要形态与体量先过 schema（64 hex、≤32 MB），越界在这里就拒。
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
  DeidSpecError,
  MAX_DICTIONARY_BYTES,
  deidDictionarySignaturePayload,
  dictionaryManifestRef,
  parseDeidDictionaryManifest,
  publicKeyKid,
  sm2Verify,
  type DeidDictionaryManifest,
} from "@medtrust/mdop";
import { DeidDictionaryEntity } from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CaService } from "../participant-identity/ca.service";

export const DEFAULT_DICTIONARY_VALID_DAYS = 365;
export const MAX_DICTIONARY_VALID_DAYS = 730;

export interface RegisterDeidDictionaryInput {
  dictionaryId: string;
  /** 词表文件的 SM3（64 hex）——由提交方在自己的环境里算好报上来。 */
  sm3: string;
  byteSize: number;
  submittedBy: string;
  approvedBy: string;
  validDays?: number;
}

export type SignedDeidDictionary = DeidDictionaryManifest;

@Injectable()
export class DeidDictionaryService {
  private readonly logger = new Logger(DeidDictionaryService.name);

  constructor(
    @InjectRepository(DeidDictionaryEntity, "controlplane")
    private readonly dictionaries: Repository<DeidDictionaryEntity>,
    private readonly ca: CaService,
    private readonly gm: GMCryptoService,
  ) {}

  /** 登记并签名词表清单：版本单调、同摘要不重复、形状先过 schema。 */
  async register(
    input: RegisterDeidDictionaryInput,
  ): Promise<SignedDeidDictionary> {
    const sm3 = (input.sm3 ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sm3))
      throw new BadRequestException("sm3 必须是 64 hex（词表文件内容摘要）");
    if (
      !Number.isInteger(input.byteSize) ||
      input.byteSize <= 0 ||
      input.byteSize > MAX_DICTIONARY_BYTES
    )
      throw new BadRequestException(
        `byteSize 必须在 1–${MAX_DICTIONARY_BYTES} 之间（词表不得变成数据通道）`,
      );
    const validDays = Math.floor(
      input.validDays ?? DEFAULT_DICTIONARY_VALID_DAYS,
    );
    if (
      !Number.isFinite(validDays) ||
      validDays <= 0 ||
      validDays > MAX_DICTIONARY_VALID_DAYS
    )
      throw new BadRequestException(
        `validDays 必须在 1–${MAX_DICTIONARY_VALID_DAYS} 之间`,
      );

    const previous = await this.dictionaries.find({
      where: { dictionaryId: input.dictionaryId },
      order: { version: "DESC" },
      take: 1,
    });
    const version = (previous[0]?.version ?? 0) + 1;
    const duplicate = await this.dictionaries.findOne({ where: { sm3 } });
    if (duplicate)
      throw new ConflictException(
        `该词表内容已登记过（${dictionaryManifestRef(duplicate)}）；改词表请改内容与版本`,
      );

    const issuedAt = new Date().toISOString();
    const notAfter = new Date(
      Date.parse(issuedAt) + validDays * 24 * 3600 * 1000,
    ).toISOString();
    const signature = this.ca.signWith(
      "registry",
      deidDictionarySignaturePayload(sm3),
    );
    const keyId = publicKeyKid(this.ca.publicKeyFor("registry"));

    const row = this.dictionaries.create({
      dictionaryId: input.dictionaryId,
      version,
      sm3,
      byteSize: input.byteSize,
      signature,
      keyId,
      issuedAt,
      notAfter,
      status: "active",
      submittedBy: input.submittedBy,
      approvedBy: input.approvedBy,
    });
    await this.dictionaries.save(row);
    this.logger.log(
      `登记脱敏词表 ${dictionaryManifestRef(row)} sm3=${sm3.slice(0, 16)}… bytes=${input.byteSize} by=${input.approvedBy}`,
    );
    return toManifest(row);
  }

  async revoke(
    dictionaryId: string,
    version: number,
    reason: string,
    revokedBy: string,
  ): Promise<DeidDictionaryEntity> {
    const row = await this.dictionaries.findOne({
      where: { dictionaryId, version },
    });
    if (!row)
      throw new NotFoundException(
        `脱敏词表不存在：${dictionaryId} v${version}`,
      );
    if (row.status === "revoked") return row;
    const trimmed = (reason ?? "").trim();
    if (!trimmed) throw new BadRequestException("吊销必须给出原因（审计用）");
    row.status = "revoked";
    row.revokeReason = trimmed;
    row.revokedBy = revokedBy;
    row.revokedAt = new Date().toISOString();
    await this.dictionaries.save(row);
    this.logger.warn(
      `吊销脱敏词表 ${dictionaryId} v${version} by=${revokedBy} reason=${trimmed}`,
    );
    return row;
  }

  async list(filter: { dictionaryId?: string } = {}) {
    return this.dictionaries.find({
      where: filter.dictionaryId ? { dictionaryId: filter.dictionaryId } : {},
      order: { dictionaryId: "ASC", version: "DESC" },
    });
  }

  /**
   * 下发给连接器的词表清单：每个 id 的**当前有效版本**，未过期、未吊销。
   * 已吊销/已过期的不下发 —— 连接器拿不到就无法证明摘要，引用它的规格随之 fail-closed。
   */
  async activeManifests(now = new Date()): Promise<SignedDeidDictionary[]> {
    const rows = await this.dictionaries.find({ where: { status: "active" } });
    const latest = new Map<string, DeidDictionaryEntity>();
    for (const row of rows) {
      const current = latest.get(row.dictionaryId);
      if (!current || row.version > current.version)
        latest.set(row.dictionaryId, row);
    }
    const manifests: SignedDeidDictionary[] = [];
    for (const row of latest.values()) {
      if (Date.parse(row.notAfter) <= now.getTime()) {
        this.logger.warn(
          `脱敏词表过期，不下发：${dictionaryManifestRef(row)} notAfter=${row.notAfter}`,
        );
        continue;
      }
      manifests.push(toManifest(row));
    }
    return manifests;
  }

  /** 吊销名单（版本 = 已吊销条数，只增不减）。 */
  async revocationList(): Promise<{
    version: number;
    issuedAt: string;
    revoked: Array<{
      dictionaryId: string;
      version: number;
      sm3: string;
      reason: string;
      revokedAt: string;
      revokedBy: string;
    }>;
  }> {
    const revoked = await this.dictionaries.find({
      where: { status: "revoked" },
      order: { revokedAt: "ASC" },
    });
    return {
      version: revoked.length,
      issuedAt: new Date().toISOString(),
      revoked: revoked.map((row) => ({
        dictionaryId: row.dictionaryId,
        version: row.version,
        sm3: row.sm3,
        reason: row.revokeReason ?? "",
        revokedAt: row.revokedAt ?? "",
        revokedBy: row.revokedBy ?? "",
      })),
    };
  }

  /** 自校验：用签发后的注册中心公钥重算并复验（防自己签错口径）。 */
  verifyManifest(manifest: unknown): boolean {
    let parsed: DeidDictionaryManifest;
    try {
      parsed = parseDeidDictionaryManifest(manifest);
    } catch (err) {
      if (err instanceof DeidSpecError) return false;
      throw err;
    }
    return sm2Verify(
      deidDictionarySignaturePayload(parsed.sm3),
      parsed.signature,
      this.ca.publicKeyFor("registry"),
    );
  }
}

function toManifest(row: DeidDictionaryEntity): SignedDeidDictionary {
  return {
    dictionaryId: row.dictionaryId,
    version: row.version,
    sm3: row.sm3,
    byteSize: row.byteSize,
    keyId: row.keyId,
    issuedAt: row.issuedAt,
    notAfter: row.notAfter,
    signature: row.signature,
    signaturePayload: deidDictionarySignaturePayload(row.sm3),
  };
}
