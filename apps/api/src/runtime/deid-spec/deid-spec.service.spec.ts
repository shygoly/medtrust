// 平台签发脱敏规格：schema → 规范化 → SM3 → 注册中心用途密钥签名 → 版本/吊销/下发。
//
// 用**真实** CaService（真 SM2 签名）+ 真 GMCryptoService：签出来的包必须能被
// 连接器那套判据（`verifySignedDeidSpec`）验过，否则两边口径已经漂移。
import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  DEID_SPEC_SIGNATURE_PAYLOAD_PREFIX,
  deidSpecSignaturePayload,
  sm2Verify,
} from "@medtrust/mdop";
import { CaKeypair, Certificate, DeidSpecEntity } from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CaService } from "../participant-identity/ca.service";
import { mockRepo } from "../test-utils/mock-repo";
import { DeidSpecService } from "./deid-spec.service";

const SPEC = {
  version: 1,
  id: "deid.ckd.v3",
  scope: { product: "urn:tds:sp:ckd-cohort", level: "C0_internal" },
  transforms: [
    {
      field: "patientId",
      op: "hmac_pseudonym",
      params: { saltRef: "hosp-kms:ckd-2026", outLen: 32 },
    },
    { field: "name", op: "drop" },
    { field: "phone", op: "drop" },
    { field: "idCard", op: "drop" },
    { field: "birthDate", op: "generalize", params: { to: "age_band_10" } },
    {
      field: "noteText",
      op: "text_rules",
      params: {
        rules: ["phone", "id_card", "address", "person_name"],
        dictionaryRef: "deid:cn-names:v2",
      },
    },
    { field: "labValue", op: "keep" },
  ],
  quasiIdentifierPolicy: {
    k: 5,
    suppressIfBelow: true,
    columns: ["ageBand", "sex", "region"],
  },
  denyIfTransformMissing: ["patientId", "name", "phone", "idCard"],
};

/** mockRepo 不会像 TypeORM 那样分配主键；save 依靠 id 判定插入还是更新，这里补上。 */
function deidRepo() {
  const repo = mockRepo<DeidSpecEntity>();
  const create = repo.create.bind(repo);
  let seq = 0;
  repo.create = (x: unknown) => {
    const rows = create(x as never) as DeidSpecEntity | DeidSpecEntity[];
    for (const row of Array.isArray(rows) ? rows : [rows])
      row.id = row.id ?? `row-${++seq}`;
    return rows as never;
  };
  return repo;
}

describe("DeidSpecService —— 签发 / 版本 / 吊销 / 下发", () => {
  let specs: ReturnType<typeof deidRepo>;
  let ca: CaService;
  let gm: GMCryptoService;
  let service: DeidSpecService;

  beforeEach(async () => {
    specs = deidRepo();
    gm = new GMCryptoService();
    ca = new CaService(
      gm,
      mockRepo<CaKeypair>(),
      mockRepo<Certificate>(),
      "sh-med",
    );
    await ca.onModuleInit();
    service = new DeidSpecService(specs, ca, gm);
  });

  it("签发：SM3 + 注册中心密钥签名，且签名可独立复验", async () => {
    const pkg = await service.issue({ spec: SPEC, issuedBy: "platform-admin" });
    expect(pkg.specId).toBe("deid.ckd.v3");
    expect(pkg.version).toBe(1);
    expect(pkg.specSm3).toBe(gm.sm3Hash(pkg.specJson));
    expect(
      pkg.signaturePayload.startsWith(DEID_SPEC_SIGNATURE_PAYLOAD_PREFIX),
    ).toBe(true);
    expect(
      sm2Verify(
        deidSpecSignaturePayload(pkg.specSm3),
        pkg.signature,
        ca.publicKeyFor("registry"),
      ),
    ).toBe(true);
    // 用**平台节点密钥**验同样一段签名必须失败（用途分离）
    expect(
      sm2Verify(
        deidSpecSignaturePayload(pkg.specSm3),
        pkg.signature,
        ca.publicKeyFor("platform-node"),
      ),
    ).toBe(false);
    expect(service.verifyPackage(pkg)).toBe(true);
  });

  it("规范化 JSON 与连接器同口径（键排序、无空白）", async () => {
    const pkg = await service.issue({ spec: SPEC, issuedBy: "platform-admin" });
    expect(pkg.specJson).not.toMatch(/\s/);
    expect(JSON.parse(pkg.specJson)).toMatchObject({ id: "deid.ckd.v3" });
  });

  it("越界参数（k<5 / maxDays>30 / 未知算子）在签发就拒，不进库", async () => {
    await expect(
      service.issue({
        spec: {
          ...SPEC,
          quasiIdentifierPolicy: { k: 1, suppressIfBelow: true, columns: [] },
        },
        issuedBy: "x",
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.issue({
        spec: {
          ...SPEC,
          transforms: [
            ...SPEC.transforms,
            {
              field: "visitDate",
              op: "date_shift",
              params: { saltRef: "k", maxDays: 31 },
            },
          ],
        },
        issuedBy: "x",
      }),
    ).rejects.toThrow(/maxDays/);
    await expect(
      service.issue({
        spec: {
          ...SPEC,
          transforms: [{ field: "x", op: "python", params: {} }],
        },
        issuedBy: "x",
      }),
    ).rejects.toThrow(BadRequestException);
    expect(await service.list()).toHaveLength(0);
  });

  it("强制字段没有变换 → 拒（防「漏掉姓名当成脱敏过」）", async () => {
    await expect(
      service.issue({
        spec: {
          ...SPEC,
          transforms: SPEC.transforms.filter((t) => t.field !== "name"),
        },
        issuedBy: "x",
      }),
    ).rejects.toThrow(/没有脱敏变换/);
  });

  it("同内容重复签发 → Conflict（换签名不产生新口径）", async () => {
    await service.issue({ spec: SPEC, issuedBy: "x" });
    await expect(service.issue({ spec: SPEC, issuedBy: "x" })).rejects.toThrow(
      ConflictException,
    );
  });

  it("版本单调：改口径后新签版本 +1", async () => {
    const v1 = await service.issue({ spec: SPEC, issuedBy: "x" });
    const v2 = await service.issue({
      spec: {
        ...SPEC,
        quasiIdentifierPolicy: {
          k: 10,
          suppressIfBelow: true,
          columns: ["ageBand"],
        },
      },
      issuedBy: "x",
    });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(
      (await service.history("deid.ckd.v3")).map((r) => r.version),
    ).toEqual([2, 1]);
  });

  it("有效期越界 → 拒", async () => {
    await expect(
      service.issue({ spec: SPEC, issuedBy: "x", validDays: 0 }),
    ).rejects.toThrow(/validDays/);
    await expect(
      service.issue({ spec: SPEC, issuedBy: "x", validDays: 400 }),
    ).rejects.toThrow(/validDays/);
  });

  it("下发面只给每个 specId 的当前有效版本", async () => {
    await service.issue({ spec: SPEC, issuedBy: "x" });
    await service.issue({
      spec: {
        ...SPEC,
        quasiIdentifierPolicy: {
          k: 10,
          suppressIfBelow: true,
          columns: ["ageBand"],
        },
      },
      issuedBy: "x",
    });
    const active = await service.activePackages();
    expect(active).toHaveLength(1);
    expect(active[0].version).toBe(2);
  });

  it("吊销：下架 + 进吊销名单（版本 = 已吊销条数）", async () => {
    const pkg = await service.issue({ spec: SPEC, issuedBy: "x" });
    await service.revoke(
      "deid.ckd.v3",
      pkg.version,
      "口径撤回",
      "compliance-01",
    );
    expect(await service.activePackages()).toHaveLength(0);
    const list = await service.revocationList();
    expect(list.version).toBe(1);
    expect(list.revoked[0].specSm3).toBe(pkg.specSm3);
    expect(list.revoked[0].reason).toBe("口径撤回");
  });

  it("吊销必须给原因；不存在的版本 → NotFound", async () => {
    const pkg = await service.issue({ spec: SPEC, issuedBy: "x" });
    await expect(
      service.revoke("deid.ckd.v3", pkg.version, "  ", "x"),
    ).rejects.toThrow(/吊销必须给出原因/);
    await expect(service.revoke("deid.ckd.v3", 99, "r", "x")).rejects.toThrow(
      /不存在/,
    );
  });

  it("过期规格不下发（连接器拿不到即无法执行）", async () => {
    await service.issue({ spec: SPEC, issuedBy: "x", validDays: 1 });
    const future = new Date(Date.now() + 2 * 86_400_000);
    expect(await service.activePackages(future)).toHaveLength(0);
  });

  it("connectorBatchPayload 一次给全规格与吊销名单", async () => {
    const pkg = await service.issue({ spec: SPEC, issuedBy: "x" });
    const old = await service.issue({
      spec: {
        ...SPEC,
        quasiIdentifierPolicy: {
          k: 10,
          suppressIfBelow: true,
          columns: ["ageBand"],
        },
      },
      issuedBy: "x",
    });
    await service.revoke("deid.ckd.v3", old.version, "撤回", "x");
    const payload = await service.connectorBatchPayload();
    expect(payload.deidSpecs.map((p) => p.version)).toEqual([pkg.version]);
    expect(payload.deidRevocations.version).toBe(1);
  });
});
