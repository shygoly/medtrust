import { ConfigService } from "@nestjs/config";
import {
  AlibabaCloudSgxAdapter,
  AttestationReport,
} from "./alibaba-cloud-sgx.adapter";

/**
 * T2 负例（CTL-09 / P-CTL-8）：API 侧 SGX 适配器未接入真实证明校验，
 * verifyAttestation 必须 fail-closed。不得因 mock quote 形状完整而放行。
 */
describe("AlibabaCloudSgxAdapter.verifyAttestation — 未接入真实校验则恒失败", () => {
  let adapter: AlibabaCloudSgxAdapter;

  const mockReport = (): AttestationReport => ({
    quote: Buffer.from("mock-sgx-quote").toString("base64"),
    report_data: Buffer.from("mock-report-data").toString("base64"),
    signature: Buffer.from("mock-signature").toString("base64"),
    timestamp: new Date(),
  });

  beforeEach(() => {
    const config = {
      get: jest.fn((_key: string, fallback?: string) => fallback),
    };
    adapter = new AlibabaCloudSgxAdapter(config as unknown as ConfigService);
  });

  it("未接真实实现时校验必须失败（返回 false）", async () => {
    await expect(adapter.verifyAttestation(mockReport())).resolves.toBe(false);
  });

  it("任意形状的报告都不得放行（不得因字段齐全而 return true）", async () => {
    const reports: AttestationReport[] = [
      mockReport(),
      {
        quote: "",
        report_data: "",
        signature: "",
        timestamp: new Date(0),
      },
      {
        quote: "a".repeat(256),
        report_data: "b".repeat(256),
        signature: "c".repeat(256),
        timestamp: new Date(),
      },
    ];
    for (const report of reports) {
      await expect(adapter.verifyAttestation(report)).resolves.toBe(false);
    }
  });
});
