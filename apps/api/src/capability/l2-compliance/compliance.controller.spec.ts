import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ComplianceController } from "./compliance.controller";
import { ComplianceService } from "./compliance.service";

describe("ComplianceController", () => {
  const svc = {
    createComposition: jest.fn(),
    getComposition: jest.fn(),
    evaluate: jest.fn(),
    getEvaluation: jest.fn(),
  };
  let ctrl: ComplianceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ComplianceController],
      providers: [{ provide: ComplianceService, useValue: svc }],
    }).compile();
    ctrl = module.get(ComplianceController);
    jest.clearAllMocks();
  });

  it("POST /composition delegates to createComposition with owner", async () => {
    svc.createComposition.mockResolvedValue({ id: "c1" });
    await expect(
      ctrl.create({ scenarioKey: "cdss" } as any, "p-meddata"),
    ).resolves.toEqual({ id: "c1" });
    expect(svc.createComposition).toHaveBeenCalledWith(
      { scenarioKey: "cdss" },
      "p-meddata",
    );
  });

  it("POST /compliance/evaluate/:id delegates to evaluate", async () => {
    svc.evaluate.mockResolvedValue({ autoVerdict: "auto_approve" });
    await expect(ctrl.evaluate("c1")).resolves.toEqual({
      autoVerdict: "auto_approve",
    });
    expect(svc.evaluate).toHaveBeenCalledWith("c1");
  });

  it("GET evaluation throws NotFound when none", async () => {
    svc.getEvaluation.mockResolvedValue(null);
    await expect(ctrl.evaluation("c1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
