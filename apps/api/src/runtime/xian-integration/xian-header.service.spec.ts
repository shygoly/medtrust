import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { XianHeaderService, XIAN_NONCE_TTL_MS } from "./xian-header.service";
import { XianNonceStore } from "./xian-nonce.store";
import { XianApiError } from "./xian-api-error";

describe("XianHeaderService", () => {
  let service: XianHeaderService;
  const config = {
    get: jest.fn((key: string) => {
      if (key === "XIAN_APP_KEY") return "app-key-001";
      if (key === "XIAN_TIMESTAMP_TZ_OFFSET") return "+08:00";
      if (key === "XIAN_TIMESTAMP_WINDOW_MS") return "300000";
      return undefined;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XianHeaderService,
        XianNonceStore,
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(XianHeaderService);
  });

  const validHeaders = () => {
    const now = new Date(Date.now() + 8 * 3600_000);
    const ts = now.toISOString().slice(0, 19).replace("T", " ");
    return {
      "x-app-key": "app-key-001",
      "x-timestamp": ts,
      "x-nonce": Math.random().toString(36).slice(2),
      "x-trace-id": "trace-1",
    };
  };

  it("accepts valid headers", () => {
    expect(service.validate(validHeaders()).traceId).toBe("trace-1");
  });

  it("claims nonce with dedicated 300000 TTL independent of timestamp window", async () => {
    const claim = jest.fn(() => true);
    const module = await Test.createTestingModule({
      providers: [
        XianHeaderService,
        { provide: XianNonceStore, useValue: { claim } },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === "XIAN_APP_KEY") return "app-key-001";
              if (key === "XIAN_TIMESTAMP_TZ_OFFSET") return "+08:00";
              if (key === "XIAN_TIMESTAMP_WINDOW_MS") return "999999999";
              return undefined;
            }),
          },
        },
      ],
    }).compile();
    const svc = module.get(XianHeaderService);
    const h = validHeaders();
    h["x-nonce"] = "nonce-001";

    expect(svc.validate(h).traceId).toBe("trace-1");
    expect(claim).toHaveBeenCalledWith("nonce-001", XIAN_NONCE_TTL_MS);
  });

  it("rejects duplicate nonce as INVALID_NONCE", () => {
    const h = validHeaders();
    service.validate(h);
    expect(() => service.validate(h)).toThrow(XianApiError);
    try {
      service.validate(h);
    } catch (e) {
      expect((e as XianApiError).code).toBe("INVALID_NONCE");
    }
  });

  it("rejects expired timestamp as LOGIN_EXPIRED", () => {
    const h = validHeaders();
    const old = new Date(Date.now() - 10 * 60_000);
    h["x-timestamp"] = old.toISOString().slice(0, 19).replace("T", " ");
    try {
      service.validate(h);
    } catch (e) {
      expect((e as XianApiError).code).toBe("LOGIN_EXPIRED");
    }
  });

  it("throws SYSTEM_ERROR when XIAN_TIMESTAMP_WINDOW_MS is invalid", async () => {
    const module = await Test.createTestingModule({
      providers: [
        XianHeaderService,
        { provide: XianNonceStore, useValue: { claim: jest.fn(() => true) } },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === "XIAN_APP_KEY") return "app-key-001";
              if (key === "XIAN_TIMESTAMP_TZ_OFFSET") return "+08:00";
              if (key === "XIAN_TIMESTAMP_WINDOW_MS") return "not-a-number";
              return undefined;
            }),
          },
        },
      ],
    }).compile();
    const svc = module.get(XianHeaderService);

    expect(() => svc.validate(validHeaders())).toThrow(XianApiError);
    try {
      svc.validate(validHeaders());
    } catch (e) {
      expect((e as XianApiError).code).toBe("SYSTEM_ERROR");
    }
  });
});
