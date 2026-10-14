import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PlanInputError } from "@medtrust/mdop";
import type { SpiContext } from "@medtrust/space-kernel-spi";
import { resolveTemplateOrThrow } from "./template-registry";
import { keyForTemplate } from "../runtime/orchestration/orchestration.channels";

/**
 * 单臂试验外部对照的模板入口（external-control-arm tasks 6.2）：
 * 此前该场景只在演示脚本里经执行器直驱 —— 本用例钉住「提交到编译」这一段真的在。
 */

const INPUT = {
  purpose: "外部对照 RWS",
  applicant: { org: "sponsor-a", project: "p-1" },
  contracts: ["ct-1"],
  trial: { participantId: "p-sponsor", dataProductId: "dp-trial" },
  controls: { participantId: "p-hosp-a", dataProductId: "dp-controls" },
  teeNode: "urn:tds:sh-med:participant:tee-node-a",
  strataKeys: ["<40|M", "40+|F"],
  caliperDays: 30,
  ratioK: 2,
  minCell: 5,
  notBefore: "2026-01-01T00:00:00Z",
  notAfter: "2026-12-31T00:00:00Z",
};

const CTX = { spaceId: "sh-med" } as SpiContext;

function build(over: Record<string, unknown> = {}) {
  const t = resolveTemplateOrThrow("rws.external-control");
  return t.build({ ...INPUT, ...over }, CTX) as {
    stages: Array<{ id: string; op: string; params?: Record<string, unknown>; at?: string }>;
  };
}

describe("外部对照的 MDOP 模板入口（6.2）", () => {
  it("阶段链：两方各 source到seal（各自投影）到节点内匹配到节点内降密", () => {
    const plan = build();
    expect(plan.stages.map((s) => s.id)).toEqual([
      "src_psponsor",
      "seal_psponsor",
      "src_phospa",
      "seal_phospa",
      "extCtl",
      "decTee",
    ]);
    const byId = Object.fromEntries(plan.stages.map((s) => [s.id, s]));
    expect(byId.seal_psponsor.params).toMatchObject({
      contractId: "ct-1",
      projection: "sponsor-trial",
    });
    // 第二侧的投影名**不从基座目录里写死**（该名字是行业包的地盘，基座纯度守护禁行业词）：
    // 这里只钉「两侧用不同投影」，具体名字由包内模板与其自己的用例保证。
    expect(byId.seal_phospa.params).toMatchObject({ contractId: "ct-1" });
    expect(byId.seal_phospa.params?.projection).not.toBe(byId.seal_psponsor.params?.projection);
    expect(byId.extCtl.op).toBe("rws.external-control@1.0.0");
    expect(byId.extCtl.params).toMatchObject({
      roles: {
        trial: "urn:tds:sh-med:participant:p-sponsor",
        controls: "urn:tds:sh-med:participant:p-hosp-a",
      },
      strataKeys: ["<40|M", "40+|F"],
      caliperDays: 30,
      ratioK: 2,
    });
    expect(byId.extCtl.at).toBe(INPUT.teeNode);
    expect(byId.decTee.op).toBe("declassify.small_cell@1.0.0");
    expect(byId.decTee.at).toBe(INPUT.teeNode);
    expect(byId.decTee.params).toMatchObject({ minCell: 5, contractId: "ct-1" });
  });

  it("入参校验：缺 strataKeys / 两方同一参与方 一律在包内拒（PlanInputError）", () => {
    expect(() => build({ strataKeys: [] })).toThrow(PlanInputError);
    expect(() =>
      build({ controls: { participantId: "p-sponsor", dataProductId: "dp-c" } }),
    ).toThrow(PlanInputError);
  });

  it("台账归属：模板映射到 mdop.external-control，且是 mdop 通道的 mdop-native 条目", () => {
    expect(keyForTemplate("rws.external-control")).toBe("mdop.external-control");
    const ledger = JSON.parse(
      readFileSync(
        join(__dirname, "../runtime/orchestration/orchestration.migration.json"),
        "utf8",
      ),
    ) as { channels: Array<Record<string, unknown>> };
    const entry = (ledger.channels ?? []).find((e) => e.key === "mdop.external-control");
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      kind: "mdop-native",
      channel: "mdop",
      state: "migrated",
      mdopTemplate: "rws.external-control",
    });
  });
});
