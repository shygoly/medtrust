// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import { PlanInputError } from "@medtrust/mdop";

import { buildTheftDetectionPlan } from "./theft-detection";

const validInput = () => ({
  purpose: "跨区窃电联查",
  applicant: { org: "grid", project: "theft-2026" },
  contracts: ["c1"],
  participants: [
    { participantId: "bureau-a", dataProductId: "dp-a" },
    { participantId: "bureau-b", dataProductId: "dp-b" },
  ],
  spec: { detectionPeriod: 90, anomalyThreshold: 0.6, topK: 20 },
  notBefore: "2026-10-01T00:00:00Z",
  notAfter: "2026-12-31T00:00:00Z",
});

function expectInputError(mutate: (input: Record<string, unknown>) => void, message: string) {
  const input = validInput() as Record<string, unknown>;
  mutate(input);
  expect(() => buildTheftDetectionPlan(input)).toThrow(PlanInputError);
  expect(() => buildTheftDetectionPlan(input)).toThrow(message);
}

describe("窃电检测计划模板", () => {
  it("参与方不足时拒绝", () => {
    expectInputError((i) => {
      i.participants = [validInput().participants[0]];
    }, "窃电检测至少需要 2 个供电局参与");
  });

  it("检测周期 < 30 时拒绝", () => {
    expectInputError((i) => {
      i.spec = { ...validInput().spec, detectionPeriod: 29 };
    }, "检测周期至少需要 30 天");
  });

  it("异常阈值越界时拒绝", () => {
    expectInputError((i) => {
      i.spec = { ...validInput().spec, anomalyThreshold: 1.5 };
    }, "异常阈值应在 0-1 之间");
  });

  it("topK 非法时拒绝", () => {
    expectInputError((i) => {
      i.spec = { ...validInput().spec, topK: 0 };
    }, "topK 必须为正整数");
  });

  it("阶段链：各方 anomaly-detection + 平台 theft-merge", () => {
    const plan = buildTheftDetectionPlan(validInput());
    const a = plan.stages.filter((s) => s.id.startsWith("bureau-a."));
    expect(a.map((s) => s.op)).toEqual([
      "source.dataset@1.0.0",
      "power.anomaly-detection@1.0.0",
      "declassify.small_cell@1.0.0",
    ]);
    // 节点侧只放行超阈值、至多 topK 块表计
    expect(a[2]!.params).toEqual(
      expect.objectContaining({
        anomalyThreshold: validInput().spec.anomalyThreshold,
        topK: validInput().spec.topK,
      }),
    );
    expect(typeof a[2]!.params.contractId).toBe("string");
    const merge = plan.stages.find((s) => s.op === "power.theft-merge@1.0.0");
    expect(merge?.at).toBe("platform");
    expect(merge?.inputs).toEqual([
      { from: "bureau-a.declassify" },
      { from: "bureau-b.declassify" },
    ]);
  });
});
