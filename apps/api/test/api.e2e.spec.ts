import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("API E2E: Auth + Blockchain", () => {
  let app: INestApplication;
  let token: string;
  let attestationId: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // 与 main.ts 对齐：控制面所有路由挂在 /api/v1 前缀下，漏设会让每个请求 404。
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    // @nestjs/typeorm 10.0.2 的关闭钩子在命名连接上取不到 DataSource 令牌：
    // TypeOrmCoreModule.onApplicationShutdown 用 `getDataSourceToken(this.options)` 去 moduleRef 里取
    // `controlplaneDataSource`，据不到就抛 "Nest could not find DataSource element"。
    // 这是上游缺陷（与本例的 PG 无关，生产 enableShutdownHooks() 的 SIGTERM 路径同样会打到），
    // 先保证套件能干净收尾；升级 @nestjs/typeorm 后应撤掉这里的兜底。
    await app.close().catch((err) => {
      console.warn(
        `[e2e] app.close() 报错（上游 @nestjs/typeorm 命名连接关闭缺陷，可忽略）：${err?.message}`,
      );
    });
  });

  describe("Auth", () => {
    it("POST /api/v1/auth/login — returns access_token", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({
          account: "admin@demohospa-hospital.com",
          password: "demo123456",
        })
        .expect(200);

      expect(res.body.access_token).toBeDefined();
      expect(typeof res.body.access_token).toBe("string");
      token = res.body.access_token;
    });

    it("GET /api/v1/auth/profile — returns user identity", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/auth/profile")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.email).toBe("admin@demohospa-hospital.com");
    });
  });

  describe("Blockchain Attestation", () => {
    const ts = Date.now();
    const data = `e2e-test-data-${ts}`;

    it("POST /api/v1/blockchain/attest — creates attestation", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/blockchain/attest")
        .set("Authorization", `Bearer ${token}`)
        .send({
          attestation_type: "custom",
          data_id: `e2e-${ts}`,
          data,
          metadata: { source: "e2e-test" },
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.data_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.status).toBe("pending");
      attestationId = res.body.id;
    });

    it("POST /api/v1/blockchain/attest — rejects duplicate", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/blockchain/attest")
        .set("Authorization", `Bearer ${token}`)
        .send({
          attestation_type: "custom",
          data_id: `e2e-dup-${ts}`,
          data, // same data as previous test
        })
        .expect(409);
    });

    it("GET /api/v1/blockchain/attestations/:id — retrieves attestation", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/blockchain/attestations/${attestationId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.id).toBe(attestationId);
      expect(res.body.data_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("GET /api/v1/blockchain/attestations — lists attestations", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/blockchain/attestations")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it("POST /api/v1/blockchain/verify — verifies valid attestation", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/blockchain/verify")
        .set("Authorization", `Bearer ${token}`)
        .send({ data, attestation_id: attestationId })
        .expect(201);

      expect(res.body.valid).toBeDefined();
    });

    it("POST /api/v1/blockchain/verify — detects tampered data", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/blockchain/verify")
        .set("Authorization", `Bearer ${token}`)
        .send({ data: "tampered-data", attestation_id: attestationId })
        .expect(201);

      expect(res.body.valid).toBe(false);
      expect(res.body.message).toMatch(/tampered|mismatch|not found/i);
    });
  });

  describe("Health", () => {
    it("GET /api/v1/health — returns service statuses", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/health")
        .expect(200);

      expect(res.body.status).toBeDefined();
      expect(Array.isArray(res.body.services)).toBe(true);
      const labels = res.body.services.map((s: any) => s.service);
      expect(labels).toContain("blockchain");
    });

    it("GET /api/v1/health/blockchain — blockchain service health", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/health/blockchain")
        .expect(200);

      expect(res.body.service).toBe("blockchain");
    });
  });
});
