import { createHash } from "crypto";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  buildRegistrationReport,
  renderRegistrationReportHtml,
  renderRegistrationReportMarkdown,
  type RegistrationReport,
  type RegistrationReportInput,
} from "@medtrust/domain-med";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { buildZip } from "../../audit/zip.util";
import { MdopJobsService } from "../../mdop/mdop-jobs.service";

export type RegistrationReportFormat =
  "json" | "markdown" | "html" | "docx" | "evidence-zip";

interface StoredRegistrationReport {
  report: RegistrationReport;
  json: Buffer;
  markdown: Buffer;
  html: Buffer;
  docx: Buffer;
}

@Injectable()
export class RegistrationReportService {
  private readonly reports = new Map<string, StoredRegistrationReport>();

  constructor(
    private readonly jobs: MdopJobsService,
    private readonly gm: GMCryptoService,
  ) {}

  async build(
    jobId: string,
    givenInput?: unknown,
  ): Promise<{
    jobId: string;
    reportFingerprint: string;
    syntheticOnly: boolean;
    files: {
      json: string;
      markdown: string;
      html: string;
      docx: string;
      evidenceZip: string;
    };
  }> {
    const { job } = await this.jobs.get(jobId);
    this.assertRegistrationJob(job.logicalPlan);
    if (!givenInput || typeof givenInput !== "object")
      throw new BadRequestException({
        code: "E_REGISTRATION_REPORT_INPUT",
        message:
          "注册研究报告缺少 canonical report input；必须由作业证据和截图清单确定性组装。",
      });

    const input = givenInput as RegistrationReportInput;
    this.assertExecutionBinding(
      job.planHash ?? null,
      job.contractBindings ?? [],
      input,
    );
    const report = buildRegistrationReport(input);
    const json = Buffer.from(JSON.stringify(report, null, 2) + "\n", "utf8");
    const markdown = Buffer.from(
      renderRegistrationReportMarkdown(report),
      "utf8",
    );
    const html = Buffer.from(renderRegistrationReportHtml(report), "utf8");
    const docx = buildRegistrationDocx(report);
    this.reports.set(jobId, { report, json, markdown, html, docx });

    const base = `/mdop/jobs/${encodeURIComponent(jobId)}/registration-report`;
    return {
      jobId,
      reportFingerprint: report.reportFingerprint,
      syntheticOnly: report.metadata.syntheticOnly,
      files: {
        json: `${base}?format=json`,
        markdown: `${base}?format=markdown`,
        html: `${base}?format=html`,
        docx: `${base}?format=docx`,
        evidenceZip: `${base}?format=evidence-zip`,
      },
    };
  }

  async artifact(
    jobId: string,
    format: RegistrationReportFormat,
  ): Promise<{
    data: Buffer;
    contentType: string;
    filename: string;
    fingerprint: string;
  }> {
    const stored = this.reports.get(jobId);
    if (!stored) throw new NotFoundException("注册研究报告尚未构建");
    const synthetic = stored.report.metadata.syntheticOnly;
    const prefix = synthetic ? "SIMULATION-ONLY-" : "";
    const baseName = `${prefix}registration-report-${jobId}`;
    if (format === "evidence-zip")
      return this.evidenceZip(jobId, stored, baseName);
    if (format === "json")
      return {
        data: stored.json,
        contentType: "application/json; charset=utf-8",
        filename: `${baseName}.json`,
        fingerprint: stored.report.reportFingerprint,
      };
    if (format === "markdown")
      return {
        data: stored.markdown,
        contentType: "text/markdown; charset=utf-8",
        filename: `${baseName}.md`,
        fingerprint: stored.report.reportFingerprint,
      };
    if (format === "html")
      return {
        data: stored.html,
        contentType: "text/html; charset=utf-8",
        filename: `${baseName}.html`,
        fingerprint: stored.report.reportFingerprint,
      };
    return {
      data: stored.docx,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: `${baseName}.docx`,
      fingerprint: stored.report.reportFingerprint,
    };
  }

  private assertRegistrationJob(plan: Record<string, unknown>): void {
    const stages = Array.isArray(plan.stages) ? plan.stages : [];
    if (
      !stages.some(
        (stage) =>
          typeof stage === "object" &&
          stage !== null &&
          (stage as { op?: unknown }).op ===
            "rws.external-control-registration@1.0.0",
      )
    )
      throw new BadRequestException({
        code: "E_REGISTRATION_REPORT_JOB_TYPE",
        message: "该作业不是 external-control-registration 类型",
      });
  }

  private assertExecutionBinding(
    planHash: string | null,
    bindings: Array<{ contractId: string }>,
    input: RegistrationReportInput,
  ): void {
    if (!input?.execution || input.execution.jobId.length === 0)
      throw new BadRequestException("报告执行证据缺少 jobId");
    if (planHash && stripSm3(input.execution.planHash) !== stripSm3(planHash))
      throw new BadRequestException("报告计划哈希与作业记录不一致");
    const expectedContracts = new Set(bindings.map((row) => row.contractId));
    for (const source of input.sources ?? [])
      if (!expectedContracts.has(source.contractId))
        throw new BadRequestException(
          `报告数据源合约 ${source.contractId} 不属于该作业`,
        );
  }

  private evidenceZip(
    jobId: string,
    stored: StoredRegistrationReport,
    baseName: string,
  ): {
    data: Buffer;
    contentType: string;
    filename: string;
    fingerprint: string;
  } {
    const evidence = {
      jobId,
      reportFingerprint: stored.report.reportFingerprint,
      protocol: {
        version: stored.report.protocol.protocolVersion,
        digest: stored.report.protocol.protocolDigest,
        sapVersion: stored.report.protocol.sapVersion,
        sapDigest: stored.report.protocol.sapDigest,
      },
      contracts: stored.report.sources,
      teePolicy: stored.report.execution.teePolicy,
      operator: {
        ref: stored.report.execution.operatorRef,
        sm3: stored.report.execution.operatorSm3,
      },
      receipts: stored.report.execution.receipts,
      chainsValid: stored.report.execution.chainsValid,
      screenshots: stored.report.assistantSession.screenshots,
      independentReview: stored.report.independentReview,
    };
    const offlineVerification = [
      "1. 解压 ZIP，不执行其中任何程序。",
      "2. 按 manifest.json 对每个文件独立计算 SM3 与 SHA-256。",
      "3. 校验 registration-report.json 的 reportFingerprint。",
      "4. 确认 syntheticOnly=true 时所有产物均显示 SIMULATION ONLY。",
      "5. 核对 protocol/SAP、合约、回执和截图摘要与报告一致。",
    ].join("\n");
    const files: Array<{ name: string; data: Buffer }> = [
      { name: "registration-report.json", data: stored.json },
      { name: "report.md", data: stored.markdown },
      { name: "report.html", data: stored.html },
      { name: "report.docx", data: stored.docx },
      {
        name: "evidence-summary.json",
        data: Buffer.from(JSON.stringify(evidence, null, 2) + "\n", "utf8"),
      },
      {
        name: "OFFLINE-VERIFICATION.txt",
        data: Buffer.from(offlineVerification + "\n", "utf8"),
      },
    ];
    const manifestFiles = files.map((file) => ({
      name: file.name,
      bytes: file.data.length,
      sm3: this.gm.sm3Hash(file.data.toString("utf8")),
      sha256: createHash("sha256").update(file.data).digest("hex"),
    }));
    const packageFingerprint = this.gm.sm3Hash(JSON.stringify(manifestFiles));
    files.push({
      name: "manifest.json",
      data: Buffer.from(
        JSON.stringify(
          {
            schema: "medtrust.rwd-registration-evidence/v1",
            jobId,
            reportFingerprint: stored.report.reportFingerprint,
            packageFingerprint,
            syntheticOnly: stored.report.metadata.syntheticOnly,
            files: manifestFiles,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      ),
    });
    return {
      data: buildZip(files),
      contentType: "application/zip",
      filename: `${baseName}-evidence.zip`,
      fingerprint: packageFingerprint,
    };
  }
}

function stripSm3(value: string): string {
  return value.replace(/^sm3:/i, "").toLowerCase();
}

function xml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Minimal standards-compliant DOCX fallback used by the API. The print-QA
 * artifact can replace it without changing the download contract.
 */
function buildRegistrationDocx(report: RegistrationReport): Buffer {
  const paragraphs = [
    "RWD 单臂外部对照注册研究报告（模拟）",
    "SIMULATION ONLY — NOT CLINICAL OR REGULATORY EVIDENCE",
    `Study: ${report.study.studyId}`,
    `Report fingerprint: ${report.reportFingerprint}`,
    `Primary ${report.estimand.summaryMeasure}: ${report.result.riskRatio}`,
    `Independent review: ${report.independentReview.verdict}`,
  ]
    .map(
      (value) =>
        `<w:p><w:r><w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`,
    )
    .join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  return buildZip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(relationships, "utf8") },
    { name: "word/document.xml", data: Buffer.from(document, "utf8") },
  ]);
}
