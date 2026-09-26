import { Logger } from "@nestjs/common";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { mockRepo } from "../test-utils/mock-repo";
import {
  CaService,
  moduleSignaturePayload,
  taskSignaturePayload,
} from "./ca.service";
import {
  DEV_KEK_FALLBACK,
  ENCRYPTED_PREFIX,
  assertKekAvailable,
  encryptStoredKey,
  isEncryptedStoredKey,
  looksLikePlaintextPrivateKey,
  migratePlaintextKey,
  normalizeKek,
  readPrivateKey,
} from "./platform-key-store";

const silentLogger = { warn: jest.fn() } as unknown as Pick<Logger, "warn">;

describe("平台密钥加密落库（D-MDOP-3 / 规格「平台密钥按用途分离」）", () => {
  const gm = new GMCryptoService();

  describe("KEK 门禁", () => {
    const env = (over: Record<string, string | undefined>): NodeJS.ProcessEnv =>
      ({ ...over }) as NodeJS.ProcessEnv;

    it("生产环境没有 KEK → 拒绝启动", () => {
      expect(() =>
        assertKekAvailable(env({ NODE_ENV: "production" }), silentLogger),
      ).toThrow(/PLATFORM_KEK/);
    });

    it("生产环境有 KEK → 通过", () => {
      expect(
        assertKekAvailable(
          env({ NODE_ENV: "production", PLATFORM_KEK: "a".repeat(32) }),
          silentLogger,
        ),
      ).toBe("a".repeat(32));
    });

    it("开发环境缺 KEK → 回落并显式告警（不静默假装加密）", () => {
      const logger = { warn: jest.fn() } as unknown as Pick<Logger, "warn">;
      expect(assertKekAvailable(env({ NODE_ENV: "development" }), logger)).toBe(
        normalizeKek(DEV_KEK_FALLBACK),
      );
      expect(logger.warn).toHaveBeenCalled();
    });

    it("非 32 hex 的口令按 SM3 派生为 16 字节密钥", () => {
      expect(normalizeKek("a-passphrase")).toMatch(/^[0-9a-f]{32}$/);
      expect(normalizeKek("a-passphrase")).toBe(normalizeKek("a-passphrase"));
      expect(normalizeKek("A".repeat(32))).toBe("a".repeat(32));
    });
  });

  describe("信封加密", () => {
    const kek = normalizeKek("unit-test-kek");
    const pair = gm.generateSM2KeyPair();

    it("落库值是 enc:v1: 密文，读得回来且不是明文", () => {
      const stored = encryptStoredKey(pair.privateKey, kek, gm);
      expect(stored.startsWith(ENCRYPTED_PREFIX)).toBe(true);
      expect(isEncryptedStoredKey(stored)).toBe(true);
      // 明确：直接读这一列拿不到能用的私钥
      expect(stored).not.toContain(pair.privateKey);
      expect(readPrivateKey(stored, kek, gm)).toBe(pair.privateKey);
    });

    it("用错 KEK 读不出来（不会静默返回垃圾私钥）", () => {
      const stored = encryptStoredKey(pair.privateKey, kek, gm);
      expect(() =>
        readPrivateKey(stored, normalizeKek("other-kek"), gm),
      ).toThrow();
    });

    it("明文列一律拒绝按私钥使用；只允许经显式迁移转密文", () => {
      expect(looksLikePlaintextPrivateKey(pair.privateKey)).toBe(true);
      expect(() => readPrivateKey(pair.privateKey, kek, gm)).toThrow(/明文/);
      const migrated = migratePlaintextKey(pair.privateKey, kek, gm)!;
      expect(isEncryptedStoredKey(migrated)).toBe(true);
      expect(readPrivateKey(migrated, kek, gm)).toBe(pair.privateKey);
    });

    it("形态既非密文也非 64 hex 明文 → 拒绝猜测", () => {
      expect(() => migratePlaintextKey("garbage", kek, gm)).toThrow(/拒绝猜测/);
    });
  });

  describe("CaService 三钥分离", () => {
    let gmService: GMCryptoService;
    let ca: CaService;
    let keysRepo: ReturnType<typeof mockRepo>;

    beforeEach(async () => {
      delete process.env.NODE_ENV;
      delete process.env.PLATFORM_KEK;
      gmService = new GMCryptoService();
      keysRepo = mockRepo();
      ca = new CaService(gmService, keysRepo, mockRepo());
      await ca.onModuleInit();
    });

    afterEach(() => {
      delete process.env.NODE_ENV;
      delete process.env.PLATFORM_KEK;
    });

    it("三把私钥在库里全是密文，三把公钥互不相同", async () => {
      const report = await ca.keyStorageReport();
      expect(report).toEqual({
        certificate: "encrypted",
        "platform-node": "encrypted",
        registry: "encrypted",
      });
      const publics = [
        ca.caPublicKey,
        ca.platformNodePublicKey,
        ca.registryPublicKey,
      ];
      expect(new Set(publics).size).toBe(3);

      // 直接读库：任何一列都不该是 64 hex 明文私钥
      const row = await keysRepo.findOne({ where: { spaceId: ca.spaceId } });
      for (const column of [
        "privateKey",
        "platformNodePrivateKey",
        "registryPrivateKey",
      ]) {
        expect(isEncryptedStoredKey(row[column])).toBe(true);
        expect(row[column]).not.toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it("历史明文 CA 私钥在启动时原地迁移为密文，且证书链照常可用", async () => {
      const legacy = new GMCryptoService().generateSM2KeyPair();
      const repo = mockRepo();
      await repo.save(
        repo.create({
          spaceId: "sh-med",
          publicKey: legacy.publicKey,
          // 迁移前的形态：明文 text 列
          privateKey: legacy.privateKey,
        }),
      );
      const migratedCa = new CaService(new GMCryptoService(), repo, mockRepo());
      await migratedCa.onModuleInit();

      const row = await repo.findOne({ where: { spaceId: "sh-med" } });
      expect(isEncryptedStoredKey(row.privateKey)).toBe(true);
      expect(row.privateKey).not.toContain(legacy.privateKey);
      // 迁移不改用途：CA 根钥公钥保持原样，证书仍可签发/核验
      expect(migratedCa.caPublicKey).toBe(legacy.publicKey);
      const cert = await migratedCa.issue(
        "cn-x",
        "p-x",
        "04" + "a".repeat(128),
      );
      expect((await migratedCa.verify(cert)).valid).toBe(true);
    });

    it("用途互斥：任务签名用平台节点钥、模块签名用注册中心钥，都不能用 CA 根钥验", () => {
      const sm3 = "b".repeat(64);

      const taskSig = ca.signTaskDigest(sm3);
      expect(
        gmService.sm2Verify(
          taskSignaturePayload(sm3),
          taskSig,
          ca.platformNodePublicKey,
        ),
      ).toBe(true);
      expect(
        gmService.sm2Verify(taskSignaturePayload(sm3), taskSig, ca.caPublicKey),
      ).toBe(false);
      expect(
        gmService.sm2Verify(
          taskSignaturePayload(sm3),
          taskSig,
          ca.registryPublicKey,
        ),
      ).toBe(false);

      const moduleSig = ca.signModuleDigest(sm3);
      expect(
        gmService.sm2Verify(
          moduleSignaturePayload(sm3),
          moduleSig,
          ca.registryPublicKey,
        ),
      ).toBe(true);
      expect(
        gmService.sm2Verify(
          moduleSignaturePayload(sm3),
          moduleSig,
          ca.caPublicKey,
        ),
      ).toBe(false);
      expect(
        gmService.sm2Verify(
          moduleSignaturePayload(sm3),
          moduleSig,
          ca.platformNodePublicKey,
        ),
      ).toBe(false);
    });

    it("用 CA 根钥签的信封被拒（按用途验签）", () => {
      // 场景：拿 CA 根钥（而不是平台节点密钥）去签一条信封载荷。
      const payload = "medtrust.envelope.v1:fake";
      const caSigned = ca.signWith("certificate", payload);
      // 它能被 CA 根钥验过 —— 说明签名本身是有效的，只是**用错了密钥**。
      expect(gmService.sm2Verify(payload, caSigned, ca.caPublicKey)).toBe(true);
      // 按用途用平台节点公钥验：必须拒（连接器侧正是这么做的）。
      expect(
        gmService.sm2Verify(payload, caSigned, ca.platformNodePublicKey),
      ).toBe(false);
      expect(gmService.sm2Verify(payload, caSigned, ca.registryPublicKey)).toBe(
        false,
      );
    });

    it("生产环境缺 KEK 时 CaService 也拒绝启动", async () => {
      process.env.NODE_ENV = "production";
      const prodCa = new CaService(
        new GMCryptoService(),
        mockRepo(),
        mockRepo(),
      );
      await expect(prodCa.onModuleInit()).rejects.toThrow(/PLATFORM_KEK/);
    });
  });
});
