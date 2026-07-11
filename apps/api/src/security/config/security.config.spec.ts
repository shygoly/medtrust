import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule, ConfigService } from "@nestjs/config";
import securityConfig from "./security.config";

describe("Security Configuration", () => {
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [securityConfig],
          ignoreEnvFile: true,
        }),
      ],
    }).compile();

    configService = module.get<ConfigService>(ConfigService);
  });

  describe("Vault Configuration", () => {
    it("should load vault address with default", () => {
      const vaultAddr = configService.get("security.vault.address");
      expect(vaultAddr).toBeDefined();
      expect(vaultAddr).toBe("http://localhost:8200");
    });

    it("should load vault token", () => {
      const vaultToken = configService.get("security.vault.token");
      expect(vaultToken).toBeDefined();
    });

    it("should load cache TTL with default", () => {
      const cacheTTL = configService.get("security.vault.cacheTTLSeconds");
      expect(cacheTTL).toBeDefined();
      expect(typeof cacheTTL).toBe("number");
      expect(cacheTTL).toBe(300);
    });
  });

  describe("Audit Configuration", () => {
    it("should load audit logging flag", () => {
      const auditEnabled = configService.get(
        "security.audit.logUnmaskedAccess",
      );
      expect(typeof auditEnabled).toBe("boolean");
    });
  });

  describe("Configuration Validation", () => {
    it("should have valid vault address format", () => {
      const vaultAddr = configService.get("security.vault.address");
      expect(vaultAddr).toMatch(/^https?:\/\/.+/);
    });

    it("should have positive cache TTL", () => {
      const cacheTTL = configService.get("security.vault.cacheTTLSeconds");
      expect(cacheTTL).toBeGreaterThan(0);
    });
  });
});

describe("Security Configuration with Environment Variables", () => {
  beforeEach(() => {
    process.env.VAULT_ADDR = "https://vault.production.com:8200";
    process.env.VAULT_TOKEN = "prod-token-xyz";
    process.env.KEY_CACHE_TTL_SECONDS = "600";
    process.env.AUDIT_LOG_UNMASKED_ACCESS = "true";
  });

  afterEach(() => {
    delete process.env.VAULT_ADDR;
    delete process.env.VAULT_TOKEN;
    delete process.env.KEY_CACHE_TTL_SECONDS;
    delete process.env.AUDIT_LOG_UNMASKED_ACCESS;
  });

  it("should load configuration from environment variables", async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [securityConfig],
        }),
      ],
    }).compile();

    const configService = module.get<ConfigService>(ConfigService);

    expect(configService.get("security.vault.address")).toBe(
      "https://vault.production.com:8200",
    );
    expect(configService.get("security.vault.token")).toBe("prod-token-xyz");
    expect(configService.get("security.vault.cacheTTLSeconds")).toBe(600);
    expect(configService.get("security.audit.logUnmaskedAccess")).toBe(true);
  });
});
