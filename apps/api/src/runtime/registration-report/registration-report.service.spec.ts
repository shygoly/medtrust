import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MdopJobsService } from "../../mdop/mdop-jobs.service";
import { RegistrationReportService } from "./registration-report.service";

function fixture(): Record<string, any> {
  for (const path of [
    resolve(
      process.cwd(),
      "scripts/test/fixtures/registration-report/input.json",
    ),
    resolve(
      process.cwd(),
      "../../scripts/test/fixtures/registration-report/input.json",
    ),
  ]) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
    } catch {
      // Try the next cwd shape.
    }
  }
  throw new Error("registration report fixture not found");
}

function service(input = fixture(), planHash = input.execution.planHash) {
  const jobs = {
    get: jest.fn().mockResolvedValue({
      job: {
        id: input.execution.jobId,
        planHash,
        logicalPlan: {
          stages: [
            {
              id: "registration",
              op: "rws.external-control-registration@1.0.0",
            },
          ],
        },
        contractBindings: input.sources.map((source: any) => ({
          contractId: source.contractId,
          participantId: source.participantId,
          dataProductId: source.dataProductId,
          role: source.role,
        })),
      },
    }),
  } as unknown as MdopJobsService;
  const gm = {
    sm3Hash: (value: string) =>
      `sm3:${value.length.toString(16).padStart(64, "0")}`,
  };
  return new RegistrationReportService(jobs, gm as any);
}

describe("注册研究报告 API 服务", () => {
  it("构建带指纹的 JSON/Markdown/HTML/DOCX 与离线证据包", async () => {
    const input = fixture();
    const api = service(input);
    const built = await api.build(input.execution.jobId, input);
    expect(built.reportFingerprint).toMatch(/^sm3:[0-9a-f]{64}$/);
    expect(built.files).toEqual(
      expect.objectContaining({
        json: expect.any(String),
        markdown: expect.any(String),
        html: expect.any(String),
        docx: expect.any(String),
        evidenceZip: expect.stringContaining("format=evidence-zip"),
      }),
    );

    for (const format of [
      "json",
      "markdown",
      "html",
      "docx",
      "evidence-zip",
    ] as const) {
      const artifact = await api.artifact(input.execution.jobId, format);
      expect(artifact.fingerprint).toBeTruthy();
      expect(artifact.data.length).toBeGreaterThan(20);
    }
    const zip = await api.artifact(input.execution.jobId, "evidence-zip");
    expect(zip.data.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(zip.data.toString("utf8")).toContain("registration-report.json");
    expect(zip.data.toString("utf8")).toContain("OFFLINE-VERIFICATION.txt");
  });

  it("拒绝非注册作业和计划哈希漂移", async () => {
    const input = fixture();
    const wrong = new RegistrationReportService(
      {
        get: jest.fn().mockResolvedValue({
          job: { logicalPlan: { stages: [{ op: "other@1.0.0" }] } },
        }),
      } as any,
      { sm3Hash: () => "sm3:" + "a".repeat(64) } as any,
    );
    await expect(wrong.build("job-1", input)).rejects.toThrow(
      /external-control-registration/,
    );
    await expect(
      service(input, `sm3:${"e".repeat(64)}`).build(
        input.execution.jobId,
        input,
      ),
    ).rejects.toThrow(/plan hash|哈希/);
  });
});
