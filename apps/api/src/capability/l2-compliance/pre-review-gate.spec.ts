import { ForbiddenException } from "@nestjs/common";
import { PreReviewGate } from "./pre-review-gate";

function contract(preReview: unknown, preReviewAck?: unknown) {
  return { id: "c1", preReview, preReviewAck } as never;
}

const snap = { compositionId: "comp-1", verdict: "auto_approve" };

describe("PreReviewGate (D-CMP-2)", () => {
  const composition = {
    id: "comp-1",
    modelKeys: ["mantel-haenszel-or"],
    algorithmKeys: [] as string[],
  };
  let compliance: {
    getComposition: jest.Mock;
    evaluate: jest.Mock;
  };
  let registry: { get: jest.Mock };
  let gate: PreReviewGate;

  beforeEach(() => {
    compliance = {
      getComposition: jest.fn(async () => composition),
      evaluate: jest.fn(async () => ({
        id: "e1",
        autoVerdict: "auto_approve",
        blockingRulesMatched: [],
      })),
    };
    registry = {
      get: jest.fn(async (_layer: unknown, key: string) =>
        key === "mantel-haenszel-or"
          ? { key, metadata: { analysisTypes: ["comparative-effect"] } }
          : null,
      ),
    };
    gate = new PreReviewGate(compliance as never, registry as never);
  });

  it("无快照 → 拒（旧合约 fail-closed）", async () => {
    await expect(
      gate.check(contract(undefined), {
        analysisType: "comparative-effect",
        participantCount: 2,
      }),
    ).rejects.toThrow(/无合规预审快照/);
  });

  it("预审组合缺失 → 拒", async () => {
    compliance.getComposition.mockResolvedValue(null);
    await expect(
      gate.check(contract(snap), {
        analysisType: "comparative-effect",
        participantCount: 2,
      }),
    ).rejects.toThrow(/组合.*缺失/);
  });

  it("分析类型超出预审范围 → 拒", async () => {
    await expect(
      gate.check(contract(snap), {
        analysisType: "fl-prediction",
        participantCount: 2,
      }),
    ).rejects.toThrow(/未覆盖分析类型/);
  });

  it("未登记能力映射的分析类型 → 拒（fail-closed）", async () => {
    registry.get.mockResolvedValue({ key: "x", metadata: {} });
    await expect(
      gate.check(contract(snap), {
        analysisType: "comparative-effect",
        participantCount: 2,
      }),
    ).rejects.toThrow(/未覆盖分析类型/);
  });

  it("范围内 + 复评通过 → 放行，按任务层参与机构数复评", async () => {
    await expect(
      gate.check(contract(snap), {
        analysisType: "comparative-effect",
        participantCount: 2,
      }),
    ).resolves.toBeUndefined();
    expect(compliance.evaluate).toHaveBeenCalledWith("comp-1", {
      participantCount: 2,
    });
  });

  it("复评驳回（如三院升 high、保障级不足）→ 拒", async () => {
    compliance.evaluate.mockResolvedValue({
      id: "e2",
      autoVerdict: "block",
      blockingRulesMatched: ["block-security-below-required"],
    });
    await expect(
      gate.check(contract(snap), {
        analysisType: "comparative-effect",
        participantCount: 3,
      }),
    ).rejects.toThrow(/驳回/);
  });

  it("复评需审批：无医院确认 → 拒；有确认 → 放行", async () => {
    compliance.evaluate.mockResolvedValue({
      id: "e3",
      autoVerdict: "manual_review",
      blockingRulesMatched: [],
    });
    await expect(
      gate.check(contract(snap), {
        analysisType: "comparative-effect",
        participantCount: 2,
      }),
    ).rejects.toThrow(/需审批/);
    await expect(
      gate.check(contract(snap, { by: "p-demohospa", reason: "x", at: "t" }), {
        analysisType: "comparative-effect",
        participantCount: 2,
      }),
    ).resolves.toBeUndefined();
  });
});
