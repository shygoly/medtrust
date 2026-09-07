import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { createHash } from "crypto";
import { AuthCaptcha } from "@medtrust/database";
import { CaptchaService } from "./captcha.service";

describe("CaptchaService", () => {
  let service: CaptchaService;
  const repo = {
    delete: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
    update: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaptchaService,
        { provide: getRepositoryToken(AuthCaptcha), useValue: repo },
      ],
    }).compile();
    service = module.get(CaptchaService);
  });

  const hash = (s: string) => createHash("sha256").update(s).digest("hex");

  it("generate persists only the answer hash and returns a data-url image", async () => {
    repo.delete.mockResolvedValue(undefined);
    repo.save.mockResolvedValue(undefined);
    const out = await service.generate();
    expect(out.captchaId).toBeTruthy();
    expect(out.image).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(out.expiresInSeconds).toBeGreaterThan(0);
    const saved = repo.save.mock.calls[0][0];
    expect(saved.answerHash).not.toMatch(/^[0-9A-Za-z]{4}$/); // 不存明文
    expect(saved.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("verify accepts the correct code exactly once", async () => {
    const id = "cap-1";
    const code = "Ab3D";
    repo.findOne.mockResolvedValue({
      id,
      answerHash: hash(code.toLowerCase()),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });
    repo.update.mockResolvedValue({ affected: 1 });
    await expect(service.verify(id, code)).resolves.toBe(true);
    expect(repo.update).toHaveBeenCalledTimes(1);
    const [criteria, patch] = repo.update.mock.calls[0];
    expect(criteria.id).toBe(id);
    expect(criteria.usedAt).toBeTruthy(); // IsNull FindOperator
    expect(criteria.expiresAt).toBeTruthy(); // MoreThan FindOperator
    expect(patch.usedAt).toBeInstanceOf(Date);
  });

  it("verify rejects a wrong code without burning the captcha", async () => {
    repo.findOne.mockResolvedValue({
      id: "cap-2",
      answerHash: hash("ab3d"),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });
    await expect(service.verify("cap-2", "zzzz")).resolves.toBe(false);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("verify rejects expired or already-used captchas", async () => {
    repo.findOne.mockResolvedValue({
      id: "cap-3",
      answerHash: hash("ab3d"),
      expiresAt: new Date(Date.now() - 1_000),
      usedAt: null,
    });
    await expect(service.verify("cap-3", "ab3d")).resolves.toBe(false);

    repo.findOne.mockResolvedValue({
      id: "cap-4",
      answerHash: hash("ab3d"),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(),
    });
    await expect(service.verify("cap-4", "ab3d")).resolves.toBe(false);
  });
});
