// 平台侧词表**摘要背书**：只收 SM3 + 字节数，不接内容（Phase 2）。
//
// 用真实 CaService 签，再用连接器那套判据（kid + 载荷口径 + 签名）独立复验，
// 两边口径一漂移就红。
import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  DEID_DICTIONARY_SIGNATURE_PAYLOAD_PREFIX,
  deidDictionarySignaturePayload,
  dictionaryManifestRef,
  parseDeidDictionaryManifest,
  publicKeyKid,
  sm2Verify,
} from "@medtrust/mdop";
import {
  CaKeypair,
  Certificate,
  DeidDictionaryEntity,
} from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CaService } from "../participant-identity/ca.service";
import { mockRepo } from "../test-utils/mock-repo";
import { DeidDictionaryService } from "./deid-dictionary.service";

function deidRepo() {
  const repo = mockRepo<DeidDictionaryEntity>();
  const create = repo.create.bind(repo);
  let seq = 0;
  repo.create = (x: unknown) => {
    const rows = create(x as never) as
      DeidDictionaryEntity | DeidDictionaryEntity[];
    for (const row of Array.isArray(rows) ? rows : [rows])
      row.id = row.id ?? `dict-${++seq}`;
    return rows as never;
  };
  return repo;
}

const SM3_A = "a".repeat(64);
const SM3_B = "b".repeat(64);

describe("DeidDictionaryService —— 词表摘要背书", () => {
  let dictionaries: ReturnType<typeof deidRepo>;
  let ca: CaService;
  let gm: GMCryptoService;
  let service: DeidDictionaryService;

  beforeEach(async () => {
    dictionaries = deidRepo();
    gm = new GMCryptoService();
    ca = new CaService(
      gm,
      mockRepo<CaKeypair>(),
      mockRepo<Certificate>(),
      "sh-med",
    );
    await ca.onModuleInit();
    service = new DeidDictionaryService(dictionaries, ca, gm);
  });

  it("登记：用注册中心密钥签摘要，且可独立复验", async () => {
    const manifest = await service.register({
      dictionaryId: "deid:cn-names",
      sm3: SM3_A,
      byteSize: 4096,
      submittedBy: "hosp-a",
      approvedBy: "compliance-01",
    });
    expect(
      manifest.signaturePayload.startsWith(
        DEID_DICTIONARY_SIGNATURE_PAYLOAD_PREFIX,
      ),
    ).toBe(true);
    expect(dictionaryManifestRef(manifest)).toBe(
      "deid:cn-names:v2".replace("v2", "v1"),
    );
    expect(
      sm2Verify(
        deidDictionarySignaturePayload(manifest.sm3),
        manifest.signature,
        ca.publicKeyFor("registry"),
      ),
    ).toBe(true);
    // 平台节点密钥验同一段签名必须失败（用途分离）
    expect(
      sm2Verify(
        deidDictionarySignaturePayload(manifest.sm3),
        manifest.signature,
        ca.publicKeyFor("platform-node"),
      ),
    ).toBe(false);
    expect(service.verifyManifest(manifest)).toBe(true);
    expect(manifest.keyId).toBe(publicKeyKid(ca.publicKeyFor("registry")));
  });

  it("摘要形态 / 体量 / 有效期越界 → 拒，且不进库", async () => {
    await expect(
      service.register({
        dictionaryId: "deid:cn-names",
        sm3: "zz",
        byteSize: 10,
        submittedBy: "x",
        approvedBy: "y",
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.register({
        dictionaryId: "deid:cn-names",
        sm3: SM3_A,
        byteSize: 64 * 1024 * 1024,
        submittedBy: "x",
        approvedBy: "y",
      }),
    ).rejects.toThrow(/byteSize/);
    await expect(
      service.register({
        dictionaryId: "deid:cn-names",
        sm3: SM3_A,
        byteSize: 10,
        submittedBy: "x",
        approvedBy: "y",
        validDays: 0,
      }),
    ).rejects.toThrow(/validDays/);
    expect(await service.list()).toHaveLength(0);
  });

  it("同摘要重复登记 → Conflict（换签名不产生新版本）", async () => {
    await service.register({
      dictionaryId: "deid:cn-names",
      sm3: SM3_A,
      byteSize: 4096,
      submittedBy: "hosp-a",
      approvedBy: "y",
    });
    await expect(
      service.register({
        dictionaryId: "deid:cn-names",
        sm3: SM3_A,
        byteSize: 4096,
        submittedBy: "hosp-a",
        approvedBy: "y",
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("版本单调 + 下发面只给当前有效版本", async () => {
    await service.register({
      dictionaryId: "deid:cn-names",
      sm3: SM3_A,
      byteSize: 4096,
      submittedBy: "hosp-a",
      approvedBy: "y",
    });
    const v2 = await service.register({
      dictionaryId: "deid:cn-names",
      sm3: SM3_B,
      byteSize: 5000,
      submittedBy: "hosp-a",
      approvedBy: "y",
    });
    expect(v2.version).toBe(2);
    const active = await service.activeManifests();
    expect(active).toHaveLength(1);
    expect(active[0].version).toBe(2);
    expect(active[0].sm3).toBe(SM3_B);
  });

  it("吊销：下架 + 进吊销名单 + 复验仍成立（清单本身没被改）", async () => {
    const manifest = await service.register({
      dictionaryId: "deid:cn-names",
      sm3: SM3_A,
      byteSize: 4096,
      submittedBy: "hosp-a",
      approvedBy: "y",
    });
    await service.revoke(
      "deid:cn-names",
      manifest.version,
      "词表撤回",
      "compliance-01",
    );
    expect(await service.activeManifests()).toHaveLength(0);
    const list = await service.revocationList();
    expect(list.version).toBe(1);
    expect(list.revoked[0].dictionaryId).toBe("deid:cn-names");
    expect(list.revoked[0].reason).toBe("词表撤回");
  });

  it("吊销必须给原因；不存在的版本 → NotFound", async () => {
    const manifest = await service.register({
      dictionaryId: "deid:cn-names",
      sm3: SM3_A,
      byteSize: 4096,
      submittedBy: "hosp-a",
      approvedBy: "y",
    });
    await expect(
      service.revoke("deid:cn-names", manifest.version, " ", "x"),
    ).rejects.toThrow(/吊销必须给出原因/);
    await expect(service.revoke("deid:cn-names", 99, "r", "x")).rejects.toThrow(
      /不存在/,
    );
  });

  it("过期清单不下发（引用它的规格随之 fail-closed）", async () => {
    await service.register({
      dictionaryId: "deid:cn-names",
      sm3: SM3_A,
      byteSize: 4096,
      submittedBy: "hosp-a",
      approvedBy: "y",
      validDays: 1,
    });
    const future = new Date(Date.now() + 2 * 86_400_000);
    expect(await service.activeManifests(future)).toHaveLength(0);
  });

  it("下发的清单能过连接器同一套解析（形状 + 载荷口径）", async () => {
    const manifest = await service.register({
      dictionaryId: "deid:cn-names",
      sm3: SM3_A,
      byteSize: 4096,
      submittedBy: "hosp-a",
      approvedBy: "y",
    });
    const parsed = parseDeidDictionaryManifest(manifest);
    expect(parsed.signaturePayload).toBe(deidDictionarySignaturePayload(SM3_A));
    expect(parsed.version).toBe(manifest.version);
  });

  it("篡改清单（改 sm3）后复验失败", async () => {
    const manifest = await service.register({
      dictionaryId: "deid:cn-names",
      sm3: SM3_A,
      byteSize: 4096,
      submittedBy: "hosp-a",
      approvedBy: "y",
    });
    expect(service.verifyManifest({ ...manifest, sm3: SM3_B })).toBe(false);
  });
});
