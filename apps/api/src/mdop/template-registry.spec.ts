import { BadRequestException } from "@nestjs/common";
import { PlanInputError } from "@medtrust/mdop";
import { buildPairedCohortPlan } from "@medtrust/domain-med";

import {
  kernelTemplateRegistry,
  registeredTemplateIds,
  resolveTemplateOrThrow,
  buildPlanWithInputMapping,
} from "./template-registry";

/** 注册表与「领域错误 -> HTTP 400」的接缝（change `pack-med-templates` tasks 4.2）。 */
describe("计划模板注册表与领域错误映射", () => {
  const space = "sh-med";
  const valid = {
    purpose: "RWS.EFFECTIVENESS",
    applicant: { org: "sponsor", project: "p1" },
    contracts: ["ctr-1"],
    holders: [
      {
        participantId: "urn:tds:sh-med:participant:hosp-a",
        dataProductId: "dp-1",
      },
      {
        participantId: "urn:tds:sh-med:participant:hosp-b",
        dataProductId: "dp-2",
      },
    ],
    teeNode: "urn:tds:sh-med:participant:tee-1",
    notBefore: "2026-01-01T00:00:00Z",
    notAfter: "2026-03-01T00:00:00Z",
  };

  it("注册表里能解析到医疗包声明的模板（组装根注册已生效）", () => {
    expect(registeredTemplateIds()).toContain("rws.paired-cohort");
    expect(resolveTemplateOrThrow("rws.paired-cohort").id).toBe(
      "rws.paired-cohort",
    );
  });

  it("未注册的模板 id fail-closed（错误里含已注册清单）", () => {
    expect(() => resolveTemplateOrThrow("rws.nope")).toThrow(/没有注册的实现/);
    expect(() => resolveTemplateOrThrow("rws.nope")).toThrow(
      /rws.paired-cohort/,
    );
  });

  it("入参不合法：领域错误映射成 HTTP 400，且文案原样", () => {
    const bad = { ...valid, holders: [valid.holders[0]] };
    expect(() => buildPairedCohortPlan(bad, space)).toThrow(PlanInputError);
    try {
      buildPlanWithInputMapping("rws.paired-cohort", bad, space);
      throw new Error("应当抛错");
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).message).toBe(
        "跨院配对至少需要两家持有方",
      );
    }
  });

  it("入参合法：经注册表构建的计划与直接调包内 builder 逐字段相等", () => {
    const viaRegistry = buildPlanWithInputMapping(
      "rws.paired-cohort",
      valid,
      space,
    );
    const direct = buildPairedCohortPlan(valid, space);
    expect(viaRegistry).toEqual(direct);
  });

  it("注册面可被复用（幂等注册不炸）", () => {
    expect(() =>
      kernelTemplateRegistry.register(
        resolveTemplateOrThrow("rws.paired-cohort"),
      ),
    ).not.toThrow();
  });
});
